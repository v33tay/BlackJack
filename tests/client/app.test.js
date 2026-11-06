"use strict";

const {
  createClientApp,
  createBettingState,
  createPlayerState,
  createViewerState,
  handsIn,
  cardsInHand,
  finishDealAnimation
} = require("../helpers/client-app");

function player(id, overrides = {}) {
  return {
    id,
    name: "Алексей",
    balance: 1000,
    bet: 0,
    ready: false,
    connected: true,
    hands: [],
    ...overrides
  };
}

function startAtTable(app, { id = "player-id", overrides = {} } = {}) {
  app.elements["player-name"].value = "Алексей";
  app.elements["create-button"].click();
  const socket = app.socket();
  socket.open();
  socket.receive({
    type: "state",
    state: createBettingState(id, "QW7R2K", [player(id)], overrides)
  });
  return socket;
}

describe("Multiplayer blackjack client", () => {
  test("creates a table and opens the betting phase", () => {
    const app = createClientApp();
    app.elements["player-name"].value = "Алексей";
    app.elements["create-button"].click();

    const socket = app.socket();
    expect(socket.url).toBe("ws://localhost:3000");
    socket.open();
    expect(socket.sent).toEqual([{ type: "create", name: "Алексей" }]);

    socket.receive({
      type: "state",
      state: createBettingState("host-id", "QW7R2K", [player("host-id")])
    });

    expect(app.elements.lobby.hidden).toBe(true);
    expect(app.elements["game-view"].hidden).toBe(false);
    expect(app.elements["room-code-display"].textContent).toBe("QW7R2K");
    expect(app.elements["seat-count"].textContent).toBe("1 / 6 игроков");
    expect(app.elements.bet.value).toBe("0");
    expect(app.elements["ready-button"].disabled).toBe(false);
    expect(app.elements["ready-button"].textContent).toBe("Готов");
    expect(app.elements["chip-10"].disabled).toBe(false);
    expect(app.elements["phase-timer"].textContent).toMatch(/^Ставки: \d+ с$/);
  });

  test("creator sees bot controls only between rounds", () => {
    const app = createClientApp();
    const socket = startAtTable(app, {
      overrides: { canManageBots: true, canManageBotsNow: true, isCreator: true }
    });

    expect(app.elements["bot-controls"].hidden).toBe(false);
    expect(app.elements["add-bot-button"].disabled).toBe(false);
    app.elements["bot-type"].value = "timid";
    app.elements["add-bot-button"].click();
    expect(socket.sent.at(-1)).toEqual({ type: "addBot", botType: "timid" });

    socket.receive({
      type: "state",
      state: createBettingState("player-id", "QW7R2K", [player("player-id")], { canManageBots: false })
    });
    expect(app.elements["bot-controls"].hidden).toBe(true);
  });

  test("joins a table using the entered code", () => {
    const app = createClientApp();
    app.elements["player-name"].value = "Гость";
    app.elements["room-code"].value = "abc123";
    app.elements["join-button"].click();
    app.socket().open();

    expect(app.socket().sent).toEqual([{ type: "join", name: "Гость", code: "ABC123" }]);
  });

  test("adds chips to the bet and clears it", () => {
    const app = createClientApp();
    const socket = startAtTable(app);

    app.elements["chip-10"].click();
    expect(socket.sent.at(-1)).toEqual({ type: "bet", amount: 10 });

    app.elements["chip-25"].click();
    expect(socket.sent.at(-1)).toEqual({ type: "bet", amount: 35 });

    app.elements["chip-50"].click();
    expect(socket.sent.at(-1)).toEqual({ type: "bet", amount: 85 });

    app.elements["bet-clear"].click();
    expect(socket.sent.at(-1)).toEqual({ type: "bet", amount: 0 });

    app.elements.bet.value = "5000";
    app.elements.bet.change();
    expect(socket.sent.at(-1)).toEqual({ type: "bet", amount: 950 });
  });

  test("toggles readiness and shows the ready state", () => {
    const app = createClientApp();
    const socket = startAtTable(app);

    app.elements["ready-button"].click();
    expect(socket.sent.at(-1)).toEqual({ type: "ready", ready: true });

    socket.receive({
      type: "state",
      state: createBettingState("player-id", "QW7R2K", [player("player-id", { ready: true })], {
        ready: true,
        canReady: false,
        canUnready: true
      })
    });
    expect(app.elements["ready-button"].textContent).toBe("Отменить готовность");

    app.elements["ready-button"].click();
    expect(socket.sent.at(-1)).toEqual({ type: "ready", ready: false });
  });

  test("enables game actions only for the current player", () => {
    const app = createClientApp();
    const socket = startAtTable(app);

    socket.receive({ type: "state", state: createPlayerState("player-id") });
    finishDealAnimation(app);

    expect(app.elements["hit-button"].disabled).toBe(false);
    expect(app.elements["stand-button"].disabled).toBe(false);
    expect(app.elements["double-button"].disabled).toBe(false);

    socket.receive({
      type: "state",
      state: {
        ...createPlayerState("player-id"),
        currentPlayerId: "other-player",
        viewer: createViewerState("player-id", { canHit: false, canStand: false, canDouble: false })
      }
    });
    expect(app.elements["hit-button"].disabled).toBe(true);
    expect(app.elements["stand-button"].disabled).toBe(true);
  });

  test("ignores a second action until the server answers", () => {
    const app = createClientApp();
    const socket = startAtTable(app);
    socket.receive({ type: "state", state: createPlayerState("player-id") });
    finishDealAnimation(app);

    app.elements["hit-button"].click();
    app.elements["hit-button"].click();

    expect(socket.sent.filter((command) => command.type === "hit")).toHaveLength(1);
    expect(app.elements["hit-button"].disabled).toBe(true);
  });

  test("preserves existing cards in place when a player draws another card", () => {
    const app = createClientApp();
    const socket = startAtTable(app);
    socket.receive({ type: "state", state: createPlayerState("player-id") });

    const hand = handsIn(app)[0];
    const originalCards = [...cardsInHand(hand)];
    const updatedPlayer = createPlayerState("player-id").players[0];
    updatedPlayer.hands[0].cards.push({ rank: "3", suit: "♣" });
    updatedPlayer.hands[0].value = 20;
    socket.receive({ type: "state", state: createPlayerState("player-id", { players: [updatedPlayer] }) });

    const updatedCards = cardsInHand(handsIn(app)[0]);
    expect(updatedCards).toHaveLength(3);
    expect(updatedCards.slice(0, 2)).toEqual(originalCards);
    expect(updatedCards.map((card) => card.attributes["aria-label"]))
      .toEqual(["10 ♠", "7 ♥", "3 ♣"]);
  });

  test("shows round results after server settlement and exposes them to assistive tech", () => {
    const app = createClientApp();
    const socket = startAtTable(app);
    const settledPlayer = createPlayerState("player-id", { phase: "over" }).players[0];
    settledPlayer.hands[0].result = "win";
    socket.receive({
      type: "state",
      state: createPlayerState("player-id", { phase: "over", players: [settledPlayer] })
    });

    expect(app.elements["round-result"].textContent).toBe("ПОБЕДА!");
    expect(app.elements["round-result"].className).toBe("round-result visible");
    expect(app.elements["round-result"].attributes["aria-hidden"]).toBe("false");

    const hideTimer = app.timers.filter((timer) => timer.delay === 4000).at(-1);
    hideTimer.callback();
    expect(app.elements["round-result"].className).toBe("round-result");
    expect(app.elements["round-result"].attributes["aria-hidden"]).toBe("true");
  });

  test("shows server errors while the table is open", () => {
    const app = createClientApp();
    const socket = startAtTable(app);

    expect(app.elements["app-error"].hidden).toBe(true);
    socket.receive({ type: "error", code: "NOT_YOUR_TURN", message: "Сейчас ход другого игрока." });

    expect(app.elements["app-error"].hidden).toBe(false);
    expect(app.elements["app-error"].textContent).toBe("Сейчас ход другого игрока.");
  });

  test("does not overwrite the bet input while it is focused", () => {
    const app = createClientApp();
    const socket = startAtTable(app);

    app.document.activeElement = app.elements.bet;
    app.elements.bet.value = "74";
    socket.receive({
      type: "state",
      state: createBettingState("player-id", "QW7R2K", [player("player-id")])
    });

    expect(app.elements.bet.value).toBe("74");
  });

  test("explains why the player sits out and offers a rebuy", () => {
    const app = createClientApp();
    const socket = startAtTable(app, {
      overrides: { sittingOut: true, balance: 0, bet: 0, canRebuy: false }
    });

    expect(app.elements.message.textContent).toContain("Ставка 0");
    expect(app.elements["rebuy-button"].hidden).toBe(true);

    socket.receive({
      type: "state",
      state: createBettingState("player-id", "QW7R2K", [player("player-id", { balance: 0 })], {
        sittingOut: true,
        balance: 0,
        bet: 0,
        canRebuy: true
      })
    });

    expect(app.elements.message.textContent).toContain("докупите");
    expect(app.elements["rebuy-button"].hidden).toBe(false);
    app.elements["rebuy-button"].click();
    expect(socket.sent.at(-1)).toEqual({ type: "rebuy" });
  });

  test("keeps the sit-out hint in the status line and updates it optimistically", () => {
    const app = createClientApp();
    const socket = startAtTable(app);

    expect(app.document.querySelector("#sit-out-notice")).toBeUndefined();
    expect(app.elements.message.textContent).toContain("Ставка 0");
    expect(app.elements.seats.children[0].children[2].textContent).toBe("ставка 0");

    // Ответ сервера ещё не пришёл: подсказка и место должны обновиться сразу.
    app.elements["chip-10"].click();
    expect(socket.sent.at(-1)).toEqual({ type: "bet", amount: 10 });
    expect(app.elements.message.textContent).not.toContain("Ставка 0");
    expect(app.elements.seats.children[0].children[2].textContent).toBe("ставка 10");
  });

  test("resumes the saved seat after the connection drops", () => {
    const app = createClientApp();
    const socket = startAtTable(app, { id: "host-id" });
    expect(app.storage.get("blackjack:seat-token")).toBe("token-host-id");

    socket.close();
    const reconnectTimer = app.timers.find((timer) => timer.delay === 1000 && !timer.cleared);
    expect(reconnectTimer).toBeDefined();
    reconnectTimer.callback();

    const resumedSocket = app.lastSocket();
    expect(resumedSocket).not.toBe(socket);
    resumedSocket.open();
    expect(resumedSocket.sent).toEqual([{ type: "resume", token: "token-host-id" }]);
  });

  test("leaves the table and forgets the saved seat", () => {
    const app = createClientApp();
    const socket = startAtTable(app);

    app.elements["leave-button"].click();
    expect(socket.sent.at(-1)).toEqual({ type: "leave" });

    socket.receive({ type: "left" });
    expect(app.elements.lobby.hidden).toBe(false);
    expect(app.elements["game-view"].hidden).toBe(true);
    expect(app.storage.has("blackjack:seat-token")).toBe(false);
  });
});
