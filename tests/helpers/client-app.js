"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { TestElement, createDom, createTimers, createStorage } = require("./dom");

const CLIENT_SOURCE = fs.readFileSync(
  path.join(__dirname, "../../src/client/scripts/main.js"),
  "utf8"
);

const ELEMENT_IDS = [
  "connection-status", "balance-box", "balance", "lobby", "lobby-message",
  "player-name", "room-code", "create-button", "join-button", "game-view",
  "room-code-display", "seat-count", "phase-timer", "seats", "bet", "bet-clear",
  "chip-10", "chip-25", "chip-50", "ready-button", "hit-button", "stand-button",
  "double-button", "split-button", "leave-button", "rebuy-button",
  "dealer-cards", "dealer-score", "player-hands", "message", "round-result", "app-error"
];

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.listeners = {};
    this.sent = [];
    MockWebSocket.instances.push(this);
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.listeners.open?.();
  }

  receive(message) {
    this.listeners.message?.({ data: JSON.stringify(message) });
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.listeners.close?.();
  }
}

function createClientApp() {
  MockWebSocket.instances = [];
  const elements = Object.fromEntries(ELEMENT_IDS.map((id) => [id, new TestElement()]));
  const document = createDom(elements);
  const timers = createTimers();
  const { storage, localStorage } = createStorage();

  vm.runInNewContext(CLIENT_SOURCE, {
    window: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout },
    document,
    localStorage,
    WebSocket: MockWebSocket,
    location: { protocol: "http:", host: "localhost:3000" }
  });

  return {
    elements,
    timers: timers.timers,
    storage,
    document,
    socket: () => MockWebSocket.instances[0],
    lastSocket: () => MockWebSocket.instances[MockWebSocket.instances.length - 1]
  };
}

const RULES = { maxPlayers: 6, minBet: 1, betStep: 1, startingBalance: 1000 };

function createViewerState(id, overrides = {}) {
  return {
    id,
    token: `token-${id}`,
    balance: 950,
    bet: 50,
    ready: false,
    connected: true,
    handIndex: 0,
    canBet: false,
    canReady: false,
    canUnready: false,
    canHit: true,
    canStand: true,
    canDouble: true,
    canSplit: false,
    canRebuy: false,
    sittingOut: false,
    ...overrides
  };
}

function createBettingState(viewerId, code = "ABC123", players = [], viewerOverrides = {}) {
  const viewer = createViewerState(viewerId, {
    bet: 0,
    handIndex: -1,
    canBet: true,
    canReady: true,
    canHit: false,
    canStand: false,
    canDouble: false,
    ...viewerOverrides
  });
  // Как на сервере: ставка 0, пустой баланс и обрыв связи означают пропуск раунда.
  if (viewerOverrides.sittingOut === undefined) {
    viewer.sittingOut = viewer.connected === false
      || viewer.bet < RULES.minBet
      || viewer.balance < viewer.bet;
  }
  return {
    code,
    round: 0,
    phase: "betting",
    viewerId,
    currentPlayerId: null,
    currentHandIndex: -1,
    timer: { remainingMs: 10_000 },
    dealer: { cards: [], value: null, hidden: false },
    rules: RULES,
    viewer,
    players
  };
}

function createPlayerState(viewerId, { phase = "player", players = null, dealerCards = null, viewerOverrides = {} } = {}) {
  const playerCards = [{ rank: "10", suit: "♠" }, { rank: "7", suit: "♥" }];
  const seatedPlayers = players || [{
    id: viewerId,
    name: "Игрок",
    balance: 950,
    bet: 50,
    ready: false,
    connected: true,
    hands: [{
      cards: playerCards,
      value: 17,
      isBust: false,
      isBlackjack: false,
      finished: false,
      result: null,
      bet: 50
    }]
  }];
  return {
    code: "ABC123",
    round: 1,
    phase,
    viewerId,
    currentPlayerId: phase === "player" ? viewerId : null,
    currentHandIndex: phase === "player" ? 0 : -1,
    timer: null,
    dealer: {
      cards: dealerCards || [{ rank: "6", suit: "♦" }, { hidden: true }],
      value: 6,
      hidden: true
    },
    rules: RULES,
    viewer: createViewerState(viewerId, viewerOverrides),
    players: seatedPlayers
  };
}

// Длительности совпадают с константами клиента: анимация раздачи — (игроки * 2 + 1) шагов + карта.
const DEAL_STEP_MS = 300;
const CARD_ANIMATION_MS = 260;

function finishDealAnimation(app, playersWithHands = 1) {
  const delay = (playersWithHands * 2 + 1) * DEAL_STEP_MS + CARD_ANIMATION_MS;
  const timer = app.timers.find((entry) => !entry.cleared && entry.delay === delay);
  if (!timer) throw new Error(`Deal animation timer (${delay} ms) was not scheduled.`);
  timer.callback();
}

function handsIn(app) {
  return app.elements["player-hands"].children;
}

function cardsInHand(hand) {
  return hand.children[1].children;
}

module.exports = {
  createClientApp,
  createBettingState,
  createPlayerState,
  createViewerState,
  handsIn,
  cardsInHand,
  finishDealAnimation,
  MockWebSocket,
  RULES
};
