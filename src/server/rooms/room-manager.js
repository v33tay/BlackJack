"use strict";

const { randomBytes, randomUUID } = require("node:crypto");
const { BlackjackTable } = require("../game/blackjack-table");
const { GameError } = require("../game/errors");
const { chooseBotAction } = require("../game/bot-strategies");
const {
  BETTING_TIME_MS,
  EMPTY_TABLE_TTL_MS,
  MAX_ROOMS,
  MAX_SESSIONS,
  MAX_PLAYERS,
  MAX_NAME_LENGTH,
  RECONNECT_GRACE_MS,
  ROUND_PAUSE_MS,
  TURN_TIMEOUT_MS
} = require("../game/constants");

const CODE_PATTERN = /^[A-F0-9]{6}$/;

class RoomManager {
  constructor({
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onUpdate = () => {},
    deckFactory,
    reconnectGraceMs = RECONNECT_GRACE_MS,
    turnTimeoutMs = TURN_TIMEOUT_MS,
    bettingMs = BETTING_TIME_MS,
    roundPauseMs = ROUND_PAUSE_MS,
    emptyTableTtlMs = EMPTY_TABLE_TTL_MS,
    maxRooms = MAX_ROOMS,
    maxSessions = MAX_SESSIONS,
    logger = console
  } = {}) {
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.onUpdate = onUpdate;
    this.deckFactory = deckFactory;
    this.reconnectGraceMs = reconnectGraceMs;
    this.turnTimeoutMs = turnTimeoutMs;
    this.bettingMs = bettingMs;
    this.roundPauseMs = roundPauseMs;
    this.emptyTableTtlMs = emptyTableTtlMs;
    this.maxRooms = maxRooms;
    this.maxSessions = maxSessions;
    this.logger = logger;
    this.rooms = new Map();
    this.sessions = new Map();
    this.playerSessions = new Map();
    this.reservations = new Map();
    this.phaseTimers = new Map();
    this.dealerTimers = new Map();
    this.emptyTableTimers = new Map();
    this.pendingJoins = new Map();
  }

  connect(send) {
    if (this.sessions.size >= this.maxSessions) {
      throw new GameError("TOO_MANY_SESSIONS", "Слишком много подключений, попробуйте позже.");
    }
    const id = randomUUID();
    this.sessions.set(id, { id, send, roomCode: null, playerId: null, token: null });
    return id;
  }

  handle(sessionId, command) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new GameError("SESSION_NOT_FOUND", "Подключение не найдено.");
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw new GameError("COMMAND_INVALID", "Некорректная команда.");
    }

    switch (command.type) {
      case "create":
        this.createTable(session, command.name);
        return;
      case "join":
        this.joinTable(session, command);
        return;
      case "resume":
        this.resumeTable(session, command.token);
        return;
      case "leave":
        this.leaveTable(session);
        return;
      default:
        break;
    }

    const table = this.getSessionTable(session);
    switch (command.type) {
      case "bet":
        table.setBet(session.playerId, command.amount);
        break;
      case "ready":
        table.setReady(session.playerId, command.ready !== false);
        break;
      case "hit":
        table.hit(session.playerId);
        break;
      case "stand":
        table.stand(session.playerId);
        break;
      case "double":
        table.doubleDown(session.playerId);
        break;
      case "split":
        table.split(session.playerId);
        break;
      case "rebuy":
        table.rebuy(session.playerId);
        break;
      case "addBot":
        this.requireBotManager(table, session);
        table.addBot(randomUUID(), command.botType);
        break;
      case "removeBot":
        this.requireBotManager(table, session);
        table.removeBot(command.playerId);
        break;
      default:
        throw new GameError("UNKNOWN_COMMAND", "Неизвестное действие.");
    }
    this.afterCommand(table);
  }

  createTable(session, name) {
    if (session.roomCode) throw new GameError("ALREADY_SEATED", "Вы уже за столом.");
    if (this.rooms.size >= this.maxRooms) {
      throw new GameError("TOO_MANY_ROOMS", "Сейчас слишком много столов, попробуйте позже.");
    }
    const code = this.createCode();
    const table = new BlackjackTable(code, { deckFactory: this.deckFactory });
    const player = table.addPlayer(randomUUID(), name, randomUUID());
    table.creatorId = player.id;
    this.rooms.set(code, table);
    this.bindSession(session, table, player);
    this.afterCommand(table);
  }

  joinTable(session, command) {
    if (session.roomCode) throw new GameError("ALREADY_SEATED", "Вы уже за столом.");
    if (typeof command.code !== "string" || !CODE_PATTERN.test(command.code.toUpperCase())) {
      throw new GameError("CODE_INVALID", "Введите шестизначный код стола.");
    }
    const code = command.code.toUpperCase();
    const table = this.rooms.get(code);
    if (!table) throw new GameError("ROOM_NOT_FOUND", "Стол не найден.");
    if (typeof command.name !== "string") throw new GameError("NAME_INVALID", "Введите имя игрока.");
    const name = command.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > MAX_NAME_LENGTH) {
      throw new GameError("NAME_INVALID", `Имя должно содержать от 1 до ${MAX_NAME_LENGTH} символов.`);
    }
    const queued = this.pendingJoins.get(code) ?? [];
    if (queued.some((request) => request.session.id === session.id)) {
      throw new GameError("JOIN_PENDING", "Ваш запрос на место уже ожидает окончания раунда.");
    }
    const availableBot = table.players.find((player) => player.isBot);
    if (table.players.length >= MAX_PLAYERS && availableBot) {
      if (table.phase === "waiting" || table.phase === "over") {
        const player = table.replaceBotWithPlayer(availableBot.id, randomUUID(), name, randomUUID());
        this.bindSession(session, table, player);
        this.afterCommand(table);
        return;
      }
      if (queued.length >= table.players.filter((player) => player.isBot).length) {
        throw new GameError("TABLE_FULL", "За столом уже ожидают другие игроки.");
      }
      queued.push({ session, name });
      this.pendingJoins.set(code, queued);
      session.send({ type: "queued", message: "Стол заполнен ботами. Вы займёте место после окончания раунда." });
      return;
    }
    if (table.players.length >= MAX_PLAYERS) {
      throw new GameError("TABLE_FULL", "За столом уже шесть игроков.");
    }
    const player = table.addPlayer(randomUUID(), name, randomUUID());
    this.bindSession(session, table, player);
    this.afterCommand(table);
  }

  processPendingJoins(table) {
    if (!["waiting", "betting", "over"].includes(table.phase)) return;
    const queued = this.pendingJoins.get(table.code);
    if (!queued?.length) return;

    while (queued.length) {
      const request = queued[0];
      if (!this.sessions.has(request.session.id)) {
        queued.shift();
        continue;
      }
      const bot = table.players.length >= MAX_PLAYERS
        ? table.players.find((player) => player.isBot)
        : null;
      if (table.players.length >= MAX_PLAYERS && !bot) break;
      const player = bot
        ? table.replaceBotWithPlayer(bot.id, randomUUID(), request.name, randomUUID())
        : table.addPlayer(randomUUID(), request.name, randomUUID());
      this.bindSession(request.session, table, player);
      queued.shift();
    }
    if (!queued.length) this.pendingJoins.delete(table.code);
  }

  resumeTable(session, token) {
    if (session.roomCode) throw new GameError("ALREADY_SEATED", "Вы уже за столом.");
    if (typeof token !== "string" || !token) {
      throw new GameError("RESUME_FAILED", "Не удалось восстановить место за столом.");
    }
    const reservation = this.reservations.get(token);
    const table = reservation ? this.rooms.get(reservation.code) : null;
    const player = table?.players.find((entry) => entry.id === reservation.playerId);
    if (!reservation || !table || !player || player.token !== token) {
      this.clearReservation(token);
      throw new GameError("RESUME_FAILED", "Место за столом больше не сохранено.");
    }
    this.clearReservation(token);
    this.bindSession(session, table, player);
    player.connected = true;
    this.afterCommand(table);
  }

  leaveTable(session) {
    const table = this.getSessionTable(session);
    const playerId = session.playerId;
    this.releaseSession(session);
    table.removePlayer(playerId);
    session.send({ type: "left" });
    this.afterCommand(table);
  }

  disconnect(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    const table = session.roomCode ? this.rooms.get(session.roomCode) : null;
    const player = table?.players.find((entry) => entry.id === session.playerId);
    if (!table || !player) {
      this.releaseSession(session);
      for (const [code, queued] of this.pendingJoins) {
        const remaining = queued.filter((request) => request.session.id !== sessionId);
        if (remaining.length) this.pendingJoins.set(code, remaining);
        else this.pendingJoins.delete(code);
      }
      this.onUpdate();
      return;
    }

    this.playerSessions.delete(player.id);
    player.connected = false;
    player.ready = false;
    table.standAll(player.id);

    if (player.token && this.reconnectGraceMs > 0) {
      const timer = this.setTimeoutFn(() => {
        this.reservations.delete(player.token);
        this.finalizeDisconnect(table.code, player.id);
      }, this.reconnectGraceMs);
      this.reservations.set(player.token, { code: table.code, playerId: player.id, timer });
    } else {
      this.finalizeDisconnect(table.code, player.id);
      return;
    }
    this.afterCommand(table);
    this.onUpdate();
  }

  finalizeDisconnect(code, playerId) {
    const table = this.rooms.get(code);
    if (!table) return;
    const player = table.players.find((entry) => entry.id === playerId);
    if (!player || player.connected) return;
    table.removePlayer(playerId);
    this.afterCommand(table);
  }

  bindSession(session, table, player) {
    session.roomCode = table.code;
    session.playerId = player.id;
    session.token = player.token;
    this.playerSessions.set(player.id, session);
  }

  releaseSession(session) {
    if (session.playerId) this.playerSessions.delete(session.playerId);
    if (session.token) this.clearReservation(session.token);
    session.roomCode = null;
    session.playerId = null;
    session.token = null;
  }

  requireBotManager(table, session) {
    if (session.playerId !== table.creatorId) {
      throw new GameError("BOT_PERMISSION_DENIED", "Только создатель стола может управлять ботами.");
    }
  }

  createCode() {
    let code;
    let attempts = 0;
    do {
      code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
      attempts += 1;
    } while (this.rooms.has(code) && attempts < 100);
    if (this.rooms.has(code)) throw new GameError("CODE_EXHAUSTED", "Не удалось создать стол, попробуйте позже.");
    return code;
  }

  getSessionTable(session) {
    if (!session.roomCode || !session.playerId) {
      throw new GameError("NOT_SEATED", "Сначала создайте стол или подключитесь к нему.");
    }
    const table = this.rooms.get(session.roomCode);
    if (!table) throw new GameError("ROOM_NOT_FOUND", "Стол больше не существует.");
    return table;
  }

  broadcast(table) {
    for (const player of table.players) {
      const session = this.playerSessions.get(player.id);
      if (!session) continue;
      session.send({ type: "state", state: table.snapshot(player.id) });
    }
  }

  afterCommand(table) {
    this.processPendingJoins(table);
    if (table.phase === "betting" && table.allReady()) {
      this.finishBetting(table);
      return;
    }
    this.advance(table);
  }

  advance(table) {
    this.processPendingJoins(table);
    this.clearEmptyTableCleanup(table);
    const hasConnected = table.players.some((player) => player.connected);
    if (!hasConnected) {
      this.clearPhaseTimer(table);
      this.clearDealerTimer(table);
      if (table.phase !== "waiting") table.resetToWaiting();
      if (!table.players.length) this.scheduleEmptyTableCleanup(table);
      this.broadcast(table);
      this.onUpdate();
      return;
    }

    if (table.phase === "waiting") table.openBetting();
    // Сначала взводим таймеры: клиент должен увидеть deadline уже в этом снапшоте.
    this.syncTimers(table);
    this.broadcast(table);
    this.onUpdate();
  }

  syncTimers(table) {
    switch (table.phase) {
      case "dealer":
        this.clearPhaseTimer(table);
        this.scheduleDealerStep(table);
        break;
      case "player":
        this.scheduleTurnTimeout(table);
        break;
      case "betting":
        this.ensureBettingDeadline(table);
        break;
      case "over":
        this.ensureRoundPause(table);
        break;
      default:
        this.clearPhaseTimer(table);
        this.clearDealerTimer(table);
        break;
    }
  }

  finishBetting(table) {
    if (table.phase !== "betting") return;
    if (!table.hasActivePlayers()) {
      this.processPendingJoins(table);
      // Никто не поставил: открываем следующее окно ставок.
      this.advance(table);
      return;
    }
    table.beginRound();
    this.advance(table);
  }

  ensureBettingDeadline(table) {
    if (this.phaseTimers.has(table.code)) return;
    const delay = Math.max(1, this.bettingMs);
    table.phaseEndsAt = Date.now() + delay;
    const handle = this.setTimeoutFn(() => {
      this.phaseTimers.delete(table.code);
      table.phaseEndsAt = null;
      if (this.rooms.get(table.code) !== table) return;
      try {
        this.finishBetting(table);
      } catch (error) {
        this.logger.error(`Unable to start a round in room ${table.code}:`, error);
        this.advance(table);
      }
    }, delay);
    this.phaseTimers.set(table.code, handle);
  }

  ensureRoundPause(table) {
    if (this.phaseTimers.has(table.code)) return;
    const delay = Math.max(1, this.roundPauseMs);
    table.phaseEndsAt = Date.now() + delay;
    const handle = this.setTimeoutFn(() => {
      this.phaseTimers.delete(table.code);
      table.phaseEndsAt = null;
      if (this.rooms.get(table.code) !== table || table.phase !== "over") return;
      table.openBetting();
      this.advance(table);
    }, delay);
    this.phaseTimers.set(table.code, handle);
  }

  scheduleTurnTimeout(table) {
    this.clearPhaseTimer(table);
    if (table.phase !== "player" || !table.currentTurn) return;
    const currentPlayer = table.currentPlayer;
    if (currentPlayer?.isBot) {
      const handle = this.setTimeoutFn(() => {
        this.phaseTimers.delete(table.code);
        table.phaseEndsAt = null;
        if (this.rooms.get(table.code) !== table || table.phase !== "player"
          || table.currentPlayer?.id !== currentPlayer.id) return;
        this.playBotTurn(table, currentPlayer);
        this.advance(table);
      }, 350);
      this.phaseTimers.set(table.code, handle);
      return;
    }
    if (!this.turnTimeoutMs) return;
    const playerId = table.currentTurn.playerId;
    table.phaseEndsAt = Date.now() + this.turnTimeoutMs;
    const handle = this.setTimeoutFn(() => {
      this.phaseTimers.delete(table.code);
      table.phaseEndsAt = null;
      if (this.rooms.get(table.code) !== table || table.phase !== "player") return;
      if (table.currentPlayer?.id !== playerId) return;
      try {
        table.stand(playerId);
      } catch (error) {
        this.logger.error(`Auto-stand failed in room ${table.code}:`, error);
        return;
      }
      this.advance(table);
    }, this.turnTimeoutMs);
    this.phaseTimers.set(table.code, handle);
  }

  playBotTurn(table, player) {
    let actions = 0;
    while (table.phase === "player" && table.currentPlayer?.id === player.id && actions < 12) {
      const hand = player.hands[table.currentTurn.handIndex];
      if (!hand || hand.finished) break;
      const action = chooseBotAction(player.botType, player, hand);
      if (action === "hit") table.hit(player.id);
      else if (action === "double") table.doubleDown(player.id);
      else if (action === "split") table.split(player.id);
      else table.stand(player.id);
      actions += 1;
    }
  }

  scheduleDealerStep(table) {
    this.clearDealerTimer(table);
    if (table.phase !== "dealer") return;
    const handle = this.setTimeoutFn(() => {
      this.dealerTimers.delete(table.code);
      if (this.rooms.get(table.code) !== table || table.phase !== "dealer") return;
      try {
        table.advanceDealerStep();
      } catch (error) {
        this.logger.error(`Dealer step failed in room ${table.code}:`, error);
        table.forceSettle();
      }
      this.advance(table);
    }, table.dealerDelay());
    this.dealerTimers.set(table.code, handle);
  }

  scheduleEmptyTableCleanup(table) {
    if (this.emptyTableTimers.has(table.code) || this.emptyTableTtlMs <= 0) return;
    const handle = this.setTimeoutFn(() => {
      this.emptyTableTimers.delete(table.code);
      const current = this.rooms.get(table.code);
      if (!current || current.players.length) return;
      this.removeRoom(current);
    }, this.emptyTableTtlMs);
    this.emptyTableTimers.set(table.code, handle);
  }

  clearEmptyTableCleanup(table) {
    const handle = this.emptyTableTimers.get(table.code);
    if (handle === undefined) return;
    this.clearTimeoutFn(handle);
    this.emptyTableTimers.delete(table.code);
  }

  clearPhaseTimer(table) {
    const handle = this.phaseTimers.get(table.code);
    if (handle !== undefined) {
      this.clearTimeoutFn(handle);
      this.phaseTimers.delete(table.code);
    }
    table.phaseEndsAt = null;
  }

  clearDealerTimer(table) {
    const handle = this.dealerTimers.get(table.code);
    if (handle === undefined) return;
    this.clearTimeoutFn(handle);
    this.dealerTimers.delete(table.code);
  }

  clearReservation(token) {
    const reservation = this.reservations.get(token);
    if (!reservation) return;
    this.clearTimeoutFn(reservation.timer);
    this.reservations.delete(token);
  }

  removeRoom(table) {
    this.clearPhaseTimer(table);
    this.clearDealerTimer(table);
    this.clearEmptyTableCleanup(table);
    this.rooms.delete(table.code);
    for (const player of table.players) {
      this.playerSessions.delete(player.id);
      if (player.token) this.clearReservation(player.token);
    }
    this.onUpdate();
  }

  stats() {
    let players = 0;
    for (const table of this.rooms.values()) players += table.players.length;
    return { rooms: this.rooms.size, sessions: this.sessions.size, players };
  }

  close() {
    for (const handle of this.phaseTimers.values()) this.clearTimeoutFn(handle);
    for (const handle of this.dealerTimers.values()) this.clearTimeoutFn(handle);
    for (const handle of this.emptyTableTimers.values()) this.clearTimeoutFn(handle);
    for (const reservation of this.reservations.values()) this.clearTimeoutFn(reservation.timer);
    this.phaseTimers.clear();
    this.dealerTimers.clear();
    this.emptyTableTimers.clear();
    this.reservations.clear();
    this.playerSessions.clear();
    this.sessions.clear();
    this.rooms.clear();
  }
}

module.exports = { RoomManager };
