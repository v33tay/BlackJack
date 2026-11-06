"use strict";

const { createExactDeck, createFullDeck } = require("../helpers/deck");
const { RoomManager } = require("../../src/server/rooms/room-manager");
const { MAX_PLAYERS } = require("../../src/server/game/constants");

function createRoom(ranks, options = {}) {
  const timers = [];
  const manager = new RoomManager({
    deckFactory: () => createFullDeck(ranks),
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: (timer) => {
      if (timer) timer.cleared = true;
    },
    turnTimeoutMs: 0,
    bettingMs: 10_000,
    roundPauseMs: 5_000,
    emptyTableTtlMs: 300_000,
    logger: { error() {} },
    ...options
  });
  const messages = new Map();
  function connect(name, type = "join", code = null) {
    const received = [];
    const sessionId = manager.connect((message) => received.push(message));
    manager.handle(sessionId, type === "create" ? { type, name } : { type, name, code });
    const state = received.at(-1).state;
    messages.set(sessionId, received);
    return { sessionId, playerId: state.viewer.id, token: state.viewer.token, received };
  }
  const host = connect("Хозяин", "create");
  return { manager, timers, messages, connect, host, code: host.received[0].state.code };
}

function pendingTimer(room, delay) {
  return room.timers.find((timer) => !timer.cleared && timer.delay === delay);
}

function fireTimer(room, delay) {
  const index = room.timers.findIndex((timer) => !timer.cleared && timer.delay === delay);
  if (index === -1) throw new Error(`No pending timer with delay ${delay}`);
  const [timer] = room.timers.splice(index, 1);
  timer.callback();
  return timer;
}

function betAndReady(room, seat, amount = 50) {
  room.manager.handle(seat.sessionId, { type: "bet", amount });
  room.manager.handle(seat.sessionId, { type: "ready" });
}

function playDealerSteps(room, table) {
  let guard = 0;
  while (table.phase === "dealer" && guard < 12) {
    fireTimer(room, table.dealerDelay());
    guard += 1;
  }
  return table.phase;
}

describe("Self-running blackjack tables", () => {
  test("seats the creator and opens a ten-second betting window", () => {
    const room = createRoom([]);
    const state = room.host.received.at(-1).state;

    expect(state.phase).toBe("betting");
    expect(state.viewer.bet).toBe(0);
    expect(state.viewer.canBet).toBe(true);
    expect(state.viewer.canReady).toBe(true);
    expect(state.timer.remainingMs).toBeGreaterThan(0);
    expect(pendingTimer(room, 10_000)).toBeDefined();
  });

  test("starts the round as soon as every player is ready", () => {
    const room = createRoom(["10", "9", "6", "7", "8", "10"]);
    const guest = room.connect("Второй", "join", room.code);

    room.manager.handle(room.host.sessionId, { type: "bet", amount: 50 });
    room.manager.handle(room.host.sessionId, { type: "ready" });
    let table = room.manager.rooms.get(room.code);
    expect(table.phase).toBe("betting");

    betAndReady(room, guest, 50);
    table = room.manager.rooms.get(room.code);

    expect(table.phase).toBe("player");
    expect(table.players.map((player) => player.hands[0].cards.map((card) => card.rank)))
      .toEqual([["10", "7"], ["9", "8"]]);
    expect(pendingTimer(room, 10_000)).toBeUndefined();
  });

  test("starts the round when the betting window expires", () => {
    const room = createRoom([]);
    room.manager.handle(room.host.sessionId, { type: "bet", amount: 50 });

    fireTimer(room, 10_000);

    expect(room.manager.rooms.get(room.code).phase).toBe("player");
  });

  test("reopens the betting window when nobody placed a bet", () => {
    const room = createRoom([]);

    fireTimer(room, 10_000);

    const table = room.manager.rooms.get(room.code);
    expect(table.phase).toBe("betting");
    expect(pendingTimer(room, 10_000)).toBeDefined();
  });

  test("opens the next betting window after the result pause", () => {
    const room = createRoom(["10", "6", "7", "10"]);
    betAndReady(room, room.host, 50);

    const table = room.manager.rooms.get(room.code);
    expect(table.phase).toBe("player");

    room.manager.handle(room.host.sessionId, { type: "stand" });
    expect(table.phase).toBe("dealer");
    expect(playDealerSteps(room, table)).toBe("over");
    expect(table.players[0].hands[0].result).toBe("push");
    expect(pendingTimer(room, 5_000)).toBeDefined();

    fireTimer(room, 5_000);

    expect(table.phase).toBe("betting");
    expect(table.players[0].bet).toBe(0);
    expect(table.players[0].ready).toBe(false);
  });

  test("keeps serving the room when the dealer timer throws", () => {
    let created = 0;
    const deckFactory = () => {
      created += 1;
      if (created > 1) throw new Error("deck exploded");
      return createExactDeck(["10", "6", "7", "9"]);
    };
    const room = createRoom([], { deckFactory });
    betAndReady(room, room.host, 50);
    room.manager.handle(room.host.sessionId, { type: "stand" });

    const table = room.manager.rooms.get(room.code);
    expect(table.phase).toBe("dealer");
    expect(() => playDealerSteps(room, table)).not.toThrow();

    expect(table.phase).toBe("over");
    expect(table.players[0].hands[0].result).toBe("push");
    expect(table.players[0].balance).toBe(1000);
  });

  test("auto-stands the player who did not act in time", () => {
    const room = createRoom(["10", "9", "6", "7", "8", "10"], { turnTimeoutMs: 3000 });
    const guest = room.connect("Второй", "join", room.code);
    betAndReady(room, room.host, 50);
    betAndReady(room, guest, 50);

    const table = room.manager.rooms.get(room.code);
    expect(table.currentPlayer.id).toBe(room.host.playerId);

    fireTimer(room, 3000);

    expect(table.players[0].hands[0].finished).toBe(true);
    expect(table.currentPlayer.id).toBe(guest.playerId);
  });

  test("keeps the seat during the grace period and frees it afterwards", () => {
    const room = createRoom([]);
    room.connect("Второй", "join", room.code);

    room.manager.disconnect(room.host.sessionId);

    let table = room.manager.rooms.get(room.code);
    expect(table.players).toHaveLength(2);
    expect(table.players.find((player) => player.id === room.host.playerId).connected).toBe(false);

    fireTimer(room, 60_000);

    table = room.manager.rooms.get(room.code);
    expect(table.players).toHaveLength(1);
  });

  test("resumes a seat with the saved token after a reconnect", () => {
    const room = createRoom([]);
    room.manager.disconnect(room.host.sessionId);

    const received = [];
    const newSession = room.manager.connect((message) => received.push(message));
    room.manager.handle(newSession, { type: "resume", token: room.host.token });

    const state = received.at(-1).state;
    expect(state.viewer.id).toBe(room.host.playerId);
    expect(state.viewer.connected).toBe(true);
    expect(room.manager.reservations.size).toBe(0);
    expect(room.timers.find((timer) => timer.delay === 60_000).cleared).toBe(true);
  });

  test("deletes an empty table after five minutes", () => {
    const room = createRoom([]);
    room.manager.handle(room.host.sessionId, { type: "leave" });

    let table = room.manager.rooms.get(room.code);
    expect(table.phase).toBe("waiting");
    expect(pendingTimer(room, 300_000)).toBeDefined();

    fireTimer(room, 300_000);

    expect(room.manager.rooms.size).toBe(0);
  });

  test("cancels the cleanup when someone joins an empty table", () => {
    const room = createRoom([]);
    room.manager.handle(room.host.sessionId, { type: "leave" });

    const guest = room.connect("Новый", "join", room.code);

    const table = room.manager.rooms.get(room.code);
    expect(table.phase).toBe("betting");
    expect(table.players).toHaveLength(1);
    expect(room.timers.find((timer) => timer.delay === 300_000).cleared).toBe(true);
    expect(guest.received.at(-1).state.viewer.canBet).toBe(true);
  });

  test("admits six players and rejects a seventh", () => {
    const room = createRoom([]);
    for (let index = 1; index < MAX_PLAYERS; index += 1) room.connect(`Игрок ${index}`, "join", room.code);
    const seventh = room.manager.connect(() => {});

    expect(room.manager.rooms.get(room.code).players).toHaveLength(6);
    expect(() => room.manager.handle(seventh, {
      type: "join",
      name: "Седьмой",
      code: room.code
    })).toThrow("За столом уже шесть игроков.");
  });

  test("caps the number of tables", () => {
    const room = createRoom([], { maxRooms: 1 });
    const other = room.manager.connect(() => {});

    expect(() => room.manager.handle(other, { type: "create", name: "Второй" }))
      .toThrow("Сейчас слишком много столов, попробуйте позже.");
  });

  test("validates commands, bets and names", () => {
    const room = createRoom([]);
    const unseated = room.manager.connect(() => {});

    expect(() => room.manager.handle(unseated, null)).toThrow("Некорректная команда.");
    expect(() => room.manager.handle("missing", { type: "create", name: "Кто-то" }))
      .toThrow("Подключение не найдено.");
    expect(() => room.manager.handle(unseated, { type: "hit" }))
      .toThrow("Сначала создайте стол или подключитесь к нему.");
    expect(() => room.manager.handle(room.host.sessionId, { type: "start" }))
      .toThrow("Неизвестное действие.");
    expect(() => room.manager.handle(unseated, { type: "join", code: "ZZZZZZ", name: "Гость" }))
      .toThrow("Введите шестизначный код стола.");
    expect(() => room.manager.handle(unseated, { type: "join", code: "AAAAAA", name: "Гость" }))
      .toThrow("Стол не найден.");

    expect(() => room.manager.handle(room.host.sessionId, { type: "bet", amount: -1 }))
      .toThrow("Ставка должна быть целым числом от 0.");
    expect(() => room.manager.handle(room.host.sessionId, { type: "bet", amount: 1002 }))
      .toThrow("Ставка не может превышать ваш баланс.");
    expect(() => room.manager.handle(unseated, { type: "create", name: " ".repeat(4) }))
      .toThrow("Имя должно содержать от 1 до 20 символов.");
  });

  test("lets a player leave the table and create a new one", () => {
    const room = createRoom([]);
    room.manager.handle(room.host.sessionId, { type: "leave" });

    expect(room.messages.get(room.host.sessionId).at(-1)).toEqual({ type: "left" });
    expect(room.manager.rooms.get(room.code).players).toHaveLength(0);

    room.manager.handle(room.host.sessionId, { type: "create", name: "Снова" });
    expect(room.manager.rooms.size).toBe(2);
  });
});
