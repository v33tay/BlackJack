"use strict";

const { createBlackjackServer } = require("../../src/server/app");
const {
  WebSocket,
  openClient,
  waitFor,
  waitForClose,
  waitForMessage
} = require("../helpers/websocket");

describe("Blackjack client-server", () => {
  let application;
  let clients;
  let address;

  beforeEach(async () => {
    clients = [];
    const silent = { error() {}, log() {} };
    application = createBlackjackServer({
      port: 0,
      host: "127.0.0.1",
      managerOptions: { logger: silent },
      webSocketOptions: { logger: silent }
    });
    address = await application.listen();
  });

  afterEach(async () => {
    for (const client of clients) {
      if (client.readyState !== WebSocket.CLOSED) client.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    await application.close();
  });

  async function connect() {
    const socket = await openClient(address.port);
    clients.push(socket);
    return socket;
  }

  test("serves the client, health and status endpoints", async () => {
    const page = await fetch(`http://127.0.0.1:${address.port}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("Создать стол");
    expect(html).toContain("/styles/main.css");
    expect(html).toContain("/scripts/main.js");
    expect(html).toContain("chip-10");
    expect(html).toContain("ready-button");
    expect(html).toContain("app-error");
    expect(html).not.toContain("start-button");

    const [stylesheet, client] = await Promise.all([
      fetch(`http://127.0.0.1:${address.port}/styles/main.css`),
      fetch(`http://127.0.0.1:${address.port}/scripts/main.js`)
    ]);
    expect(stylesheet.status).toBe(200);
    expect(client.status).toBe(200);

    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");

    const status = await fetch(`http://127.0.0.1:${address.port}/status`);
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody).toMatchObject({ rooms: 0, sessions: 0, players: 0 });
    expect(typeof statusBody.uptime).toBe("number");

    const favicon = await fetch(`http://127.0.0.1:${address.port}/favicon.ico`);
    expect(favicon.status).toBe(204);

    const missing = await fetch(`http://127.0.0.1:${address.port}/nope.txt`);
    expect(missing.status).toBe(404);

    const wrongMethod = await fetch(`http://127.0.0.1:${address.port}/scripts/main.js`, { method: "POST" });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toContain("GET");

    const head = await fetch(`http://127.0.0.1:${address.port}/scripts/main.js`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("opens a betting window for the creator and seats a joining player", async () => {
    const host = await connect();
    const created = waitForMessage(host, (message) => message.type === "state");
    host.send(JSON.stringify({ type: "create", name: "Хозяин" }));
    const hostState = await created;

    expect(hostState.state.code).toMatch(/^[A-F0-9]{6}$/);
    expect(hostState.state.phase).toBe("betting");
    expect(hostState.state.players).toHaveLength(1);
    expect(hostState.state.viewer.bet).toBe(0);
    expect(hostState.state.viewer.canBet).toBe(true);
    expect(hostState.state.viewer.canReady).toBe(true);
    expect(hostState.state.timer.remainingMs).toBeGreaterThan(0);
    expect(hostState.state.rules.betStep).toBe(1);

    const guest = await connect();
    const joined = waitForMessage(guest, (message) => message.type === "state");
    guest.send(JSON.stringify({ type: "join", code: hostState.state.code, name: "Гость" }));
    const guestState = await joined;

    expect(guestState.state.players.map((player) => player.name)).toEqual(["Хозяин", "Гость"]);
    expect(guestState.state.viewer.id).not.toBe(hostState.state.viewer.id);
    expect(guestState.state.phase).toBe("betting");
  });

  test("starts the round when every player is ready", async () => {
    const host = await connect();
    const created = waitForMessage(host, (message) => message.type === "state");
    host.send(JSON.stringify({ type: "create", name: "Хозяин" }));
    const hostState = await created;

    const started = waitForMessage(host, (message) =>
      message.type === "state" && message.state.phase === "player");
    host.send(JSON.stringify({ type: "bet", amount: 50 }));
    host.send(JSON.stringify({ type: "ready" }));
    const playingState = await started;

    expect(playingState.state.currentPlayerId).toBe(hostState.state.viewer.id);
    expect(playingState.state.viewer.canHit).toBe(true);
    expect(playingState.state.players[0].hands[0].bet).toBe(50);
    expect(playingState.state.timer.remainingMs).toBeGreaterThan(0);
  });

  test("reports malformed commands and unknown room codes instead of disconnecting", async () => {
    const client = await connect();

    const malformed = waitForMessage(client, (message) => message.type === "error");
    client.send("{invalid json");
    const malformedError = await malformed;
    expect(malformedError.code).toBe("COMMAND_INVALID");
    expect(malformedError.message).toContain("некорректная команда");

    const unknownRoom = waitForMessage(client, (message) => message.type === "error");
    client.send(JSON.stringify({ type: "join", code: "AABBCC", name: "Гость" }));
    const roomError = await unknownRoom;
    expect(roomError.code).toBe("ROOM_NOT_FOUND");
    expect(roomError.message).toBe("Стол не найден.");
    expect(client.readyState).toBe(WebSocket.OPEN);
  });

  test("restores a seat after the socket drops", async () => {
    const host = await connect();
    const created = waitForMessage(host, (message) => message.type === "state");
    host.send(JSON.stringify({ type: "create", name: "Хозяин" }));
    const hostState = await created;
    const { token, id } = hostState.state.viewer;

    host.close();
    await waitFor(() => application.manager.reservations.size === 1);

    const resumed = await connect();
    const stateMessage = waitForMessage(resumed, (message) => message.type === "state");
    resumed.send(JSON.stringify({ type: "resume", token }));
    const resumedState = await stateMessage;

    expect(resumedState.state.viewer.id).toBe(id);
    expect(resumedState.state.viewer.connected).toBe(true);
    expect(resumedState.state.viewer.canBet).toBe(true);
  });

  test("keeps the table after the last player leaves and lets them create a new one", async () => {
    const host = await connect();
    const created = waitForMessage(host, (message) => message.type === "state");
    host.send(JSON.stringify({ type: "create", name: "Хозяин" }));
    const hostState = await created;
    const code = hostState.state.code;

    const left = waitForMessage(host, (message) => message.type === "left");
    host.send(JSON.stringify({ type: "leave" }));
    await left;
    await waitFor(() => application.manager.rooms.get(code).players.length === 0);
    expect(application.manager.rooms.get(code).phase).toBe("waiting");

    const recreated = waitForMessage(host, (message) => message.type === "state");
    host.send(JSON.stringify({ type: "create", name: "Хозяин" }));
    const newState = await recreated;
    expect(newState.state.players).toHaveLength(1);
    expect(newState.state.code).not.toBe(code);
  });

  test("closes the socket when a payload is too large", async () => {
    const client = await connect();

    const closed = waitForClose(client);
    client.send(JSON.stringify({ type: "create", name: "x".repeat(5000) }));
    await closed;
    expect(client.readyState).toBe(WebSocket.CLOSED);
  });
});
