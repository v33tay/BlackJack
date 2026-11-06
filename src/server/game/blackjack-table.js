"use strict";

const { Deck, Hand, createDeckCards } = require("./cards");
const { GameError } = require("./errors");
const { handValue, settleHand } = require("./rules");
const {
  BET_STEP,
  DECKS_PER_SHOE,
  DEFAULT_BET,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_BET,
  STARTING_BALANCE
} = require("./constants");

function normalizeName(value) {
  if (typeof value !== "string") throw new GameError("NAME_INVALID", "Введите имя игрока.");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new GameError("NAME_INVALID", `Имя должно содержать от 1 до ${MAX_NAME_LENGTH} символов.`);
  }
  return name;
}

function createShoe(decks = DECKS_PER_SHOE) {
  return new Deck(createDeckCards(decks));
}

function createPlayer(id, name, { token = null, balance = STARTING_BALANCE } = {}) {
  return {
    id,
    name: normalizeName(name),
    token,
    balance,
    bet: DEFAULT_BET,
    ready: false,
    hands: [],
    connected: true
  };
}

function validateBet(amount, balance) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount % BET_STEP !== 0) {
    throw new GameError("BET_INVALID", "Ставка должна быть целым числом от 0.");
  }
  if (amount > balance) {
    throw new GameError("BET_TOO_HIGH", "Ставка не может превышать ваш баланс.");
  }
}

class BlackjackTable {
  constructor(code, { deckFactory = () => createShoe() } = {}) {
    this.code = code;
    this.players = [];
    this.phase = "waiting";
    this.round = 0;
    this.deckFactory = deckFactory;
    this.deck = null;
    this.dealer = new Hand();
    this.turnQueue = [];
    this.currentTurnIndex = -1;
    this.dealerVisibleCardCount = 0;
    this.phaseEndsAt = null;
  }

  get currentTurn() {
    return this.phase === "player" ? this.turnQueue[this.currentTurnIndex] ?? null : null;
  }

  get currentPlayer() {
    const turn = this.currentTurn;
    return turn ? this.players.find((player) => player.id === turn.playerId) ?? null : null;
  }

  addPlayer(id, name, token = null) {
    if (this.players.length >= MAX_PLAYERS) {
      throw new GameError("TABLE_FULL", "За столом уже шесть игроков.");
    }
    if (this.players.some((player) => player.id === id)) {
      throw new GameError("ALREADY_SEATED", "Вы уже за этим столом.");
    }
    const player = createPlayer(id, name, { token });
    this.players.push(player);
    return player;
  }

  isPlaying(player) {
    return player.connected && player.bet >= MIN_BET && player.balance >= player.bet;
  }

  activePlayers() {
    return this.players.filter((player) => this.isPlaying(player));
  }

  hasActivePlayers() {
    return this.activePlayers().length > 0;
  }

  allReady() {
    const connected = this.players.filter((player) => player.connected);
    return connected.length > 0 && connected.every((player) => player.ready);
  }

  openBetting() {
    this.phase = "betting";
    this.phaseEndsAt = null;
    this.turnQueue = [];
    this.currentTurnIndex = -1;
    this.dealer = new Hand();
    this.dealerVisibleCardCount = 0;
    for (const player of this.players) {
      player.bet = DEFAULT_BET;
      player.ready = false;
      player.hands = [];
    }
    return this;
  }

  resetToWaiting() {
    this.openBetting();
    this.phase = "waiting";
    return this;
  }

  setBet(playerId, amount) {
    const player = this.requirePlayer(playerId);
    this.requireBettingPhase();
    validateBet(amount, player.balance);
    player.bet = amount;
    player.ready = false;
    return player;
  }

  setReady(playerId, ready = true) {
    const player = this.requirePlayer(playerId);
    this.requireBettingPhase();
    player.ready = Boolean(ready);
    return player;
  }

  rebuy(playerId) {
    const player = this.requirePlayer(playerId);
    if (!["waiting", "betting", "over"].includes(this.phase)) {
      throw new GameError("ROUND_IN_PROGRESS", "Докупить фишки можно только между раундами.");
    }
    if (player.balance >= MIN_BET) {
      throw new GameError("REBUY_UNAVAILABLE", `Докупить фишки можно, только если на балансе меньше ${MIN_BET}.`);
    }
    player.balance = STARTING_BALANCE;
    player.bet = DEFAULT_BET;
    player.ready = false;
    return player;
  }

  beginRound() {
    if (this.phase !== "betting") {
      throw new GameError("ROUND_NOT_READY", "Сейчас нельзя начать раунд.");
    }
    const activePlayers = this.activePlayers();
    if (!activePlayers.length) {
      throw new GameError("NO_ACTIVE_PLAYERS", "Нет игроков с доступной ставкой.");
    }

    this.ensureDeck(activePlayers.length * 2 + 2);
    this.round += 1;
    this.phaseEndsAt = null;
    this.dealer = new Hand();
    this.dealerVisibleCardCount = 0;
    this.turnQueue = [];
    this.currentTurnIndex = -1;
    for (const player of this.players) player.hands = [];
    for (const player of activePlayers) {
      player.balance -= player.bet;
      player.hands = [new Hand([], player.bet)];
    }

    for (const player of activePlayers) player.hands[0].cards.push(this.drawCard());
    this.dealer.cards.push(this.drawCard());
    for (const player of activePlayers) player.hands[0].cards.push(this.drawCard());
    this.dealer.cards.push(this.drawCard());

    this.dealerVisibleCardCount = 1;
    if (this.dealer.isBlackjack) {
      this.dealerVisibleCardCount = this.dealer.cards.length;
      this.phase = "over";
      this.settleRound();
      return activePlayers;
    }

    for (const player of activePlayers) {
      if (player.hands[0].isBlackjack) player.hands[0].finished = true;
      else this.turnQueue.push({ playerId: player.id, handIndex: 0 });
    }
    this.phase = "player";
    this.advanceTurn();
    return activePlayers;
  }

  hit(playerId) {
    const hand = this.requireTurn(playerId);
    const card = this.drawCard();
    hand.cards.push(card);
    if (hand.isBust || hand.value === 21) {
      hand.finished = true;
      this.advanceTurn();
    }
  }

  stand(playerId) {
    this.requireTurn(playerId).finished = true;
    this.advanceTurn();
  }

  standAll(playerId) {
    const player = this.players.find((entry) => entry.id === playerId);
    if (!player) return false;
    for (const hand of player.hands) if (!hand.finished) hand.finished = true;
    if (this.phase === "player" && this.currentPlayer?.id === playerId) {
      this.advanceTurn();
      return true;
    }
    return false;
  }

  doubleDown(playerId) {
    const hand = this.requireTurn(playerId);
    const player = this.requirePlayer(playerId);
    if (!hand.canDouble || player.balance < hand.bet) {
      throw new GameError("DOUBLE_UNAVAILABLE", "Удвоение сейчас недоступно.");
    }
    const card = this.drawCard();
    player.balance -= hand.bet;
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(card);
    hand.finished = true;
    this.advanceTurn();
  }

  split(playerId) {
    const hand = this.requireTurn(playerId);
    const player = this.requirePlayer(playerId);
    if (!hand.canSplit || player.balance < hand.bet) {
      throw new GameError("SPLIT_UNAVAILABLE", "Сплит сейчас недоступен.");
    }
    const handIndex = this.currentTurn.handIndex;
    const [firstCard, secondCard] = hand.cards;
    // Сначала тянем карты, чтобы ошибка не оставила стол в полусобранном состоянии.
    const cardForHand = this.drawCard();
    const cardForSplit = this.drawCard();

    hand.cards = [firstCard, cardForHand];
    hand.isSplit = true;
    const splitHand = new Hand([secondCard, cardForSplit], hand.bet, { isSplit: true });
    player.hands.splice(handIndex + 1, 0, splitHand);
    player.balance -= hand.bet;

    this.turnQueue.forEach((turn) => {
      if (turn.playerId === playerId && turn.handIndex > handIndex) turn.handIndex += 1;
    });
    this.turnQueue.splice(this.currentTurnIndex + 1, 0, { playerId, handIndex: handIndex + 1 });

    if (hand.value === 21) hand.finished = true;
    if (splitHand.value === 21) splitHand.finished = true;
    if (hand.finished) this.advanceTurn();
  }

  advanceDealerStep() {
    if (this.phase !== "dealer") throw new GameError("DEALER_NOT_ACTIVE", "Ход дилера сейчас не активен.");
    if (this.dealerVisibleCardCount < this.dealer.cards.length) {
      this.dealerVisibleCardCount += 1;
      return;
    }
    if (this.dealer.value < 17 && this.players.some((player) => player.hands.some((hand) => !hand.isBust))) {
      this.dealer.cards.push(this.drawCard());
      this.dealerVisibleCardCount += 1;
      return;
    }
    this.settleRound();
  }

  dealerDelay() {
    if (this.dealerVisibleCardCount < 2) return 850;
    const value = this.dealer.value;
    if (value >= 21) return 1600;
    if (value >= 17) return 1200;
    if (value >= 16) return 1000;
    if (value >= 13) return 800;
    return 600;
  }

  setConnected(playerId, connected) {
    const player = this.requirePlayer(playerId);
    player.connected = Boolean(connected);
    if (!player.connected) {
      player.ready = false;
      this.standAll(playerId);
    }
    return player;
  }

  removePlayer(playerId) {
    const removedIndex = this.players.findIndex((player) => player.id === playerId);
    if (removedIndex === -1) return false;
    const removedPlayer = this.players[removedIndex];
    if (this.phase === "player") {
      const removedTurnIndex = this.turnQueue.findIndex((turn) => turn.playerId === playerId);
      const wasCurrent = removedTurnIndex === this.currentTurnIndex;
      this.turnQueue = this.turnQueue.filter((turn) => turn.playerId !== playerId);
      if (wasCurrent) {
        this.currentTurnIndex = removedTurnIndex - 1;
        this.advanceTurn();
      } else if (removedTurnIndex !== -1 && removedTurnIndex < this.currentTurnIndex) {
        this.currentTurnIndex -= 1;
      }
    }
    this.players.splice(removedIndex, 1);
    return removedPlayer;
  }

  forceSettle() {
    this.phase = "over";
    this.phaseEndsAt = null;
    this.dealerVisibleCardCount = this.dealer.cards.length;
    for (const player of this.players) {
      for (const hand of player.hands) {
        hand.finished = true;
        if (hand.result) continue;
        hand.result = "push";
        player.balance += hand.bet;
      }
    }
  }

  settleRound() {
    this.phase = "over";
    this.phaseEndsAt = null;
    this.dealerVisibleCardCount = this.dealer.cards.length;
    const dealerBust = this.dealer.isBust;
    const dealerBlackjack = this.dealer.isBlackjack;
    for (const player of this.players) {
      for (const hand of player.hands) {
        hand.finished = true;
        if (hand.result) continue;
        const { result, payout } = settleHand({
          value: hand.value,
          isBust: hand.isBust,
          isBlackjack: hand.isBlackjack,
          bet: hand.bet,
          dealerValue: this.dealer.value,
          dealerBlackjack,
          dealerBust
        });
        hand.result = result;
        player.balance += payout;
      }
    }
  }

  snapshot(viewerId) {
    const revealDealer = ["dealer", "over"].includes(this.phase);
    const visibleDealerCount = revealDealer
      ? (this.phase === "dealer" ? this.dealerVisibleCardCount : this.dealer.cards.length)
      : Math.min(this.dealer.cards.length, 1);
    const visibleDealerCards = this.dealer.cards.slice(0, visibleDealerCount).map(serializeCard);
    const hiddenHoleCard = this.dealer.cards.length > visibleDealerCount;
    if (hiddenHoleCard) visibleDealerCards.push({ hidden: true });

    const viewer = this.players.find((player) => player.id === viewerId) ?? null;
    const isTurn = Boolean(viewer && this.phase === "player" && this.currentPlayer?.id === viewer.id);
    const viewerHand = isTurn ? viewer.hands[this.currentTurn.handIndex] ?? null : null;
    const canBetNow = this.phase === "betting" && Boolean(viewer?.connected);
    const canRebuyNow = Boolean(viewer?.connected) && viewer.balance < MIN_BET
      && ["waiting", "betting", "over"].includes(this.phase);

    return {
      code: this.code,
      round: this.round,
      phase: this.phase,
      viewerId,
      currentPlayerId: this.currentPlayer?.id ?? null,
      currentHandIndex: this.currentTurn?.handIndex ?? -1,
      timer: this.phaseEndsAt === null
        ? null
        : { remainingMs: Math.max(0, this.phaseEndsAt - Date.now()) },
      dealer: {
        cards: visibleDealerCards,
        value: revealDealer
          ? handValue(this.dealer.cards.slice(0, visibleDealerCount))
          : this.dealer.cards[0]?.value ?? null,
        hidden: hiddenHoleCard
      },
      rules: {
        maxPlayers: MAX_PLAYERS,
        minBet: MIN_BET,
        betStep: BET_STEP,
        startingBalance: STARTING_BALANCE
      },
      viewer: viewer ? {
        id: viewer.id,
        token: viewer.token,
        balance: viewer.balance,
        bet: viewer.bet,
        ready: viewer.ready,
        connected: viewer.connected,
        handIndex: isTurn ? this.currentTurn.handIndex : -1,
        canBet: canBetNow,
        canReady: canBetNow && !viewer.ready,
        canUnready: canBetNow && viewer.ready,
        canHit: isTurn,
        canStand: isTurn,
        canDouble: isTurn && Boolean(viewerHand) && viewerHand.canDouble && viewer.balance >= viewerHand.bet,
        canSplit: isTurn && Boolean(viewerHand?.canSplit) && viewer.balance >= viewerHand.bet,
        canRebuy: canRebuyNow,
        sittingOut: !viewer.connected || viewer.bet < MIN_BET || viewer.balance < viewer.bet
      } : null,
      players: this.players.map((player) => ({
        id: player.id,
        name: player.name,
        balance: player.balance,
        bet: player.bet,
        ready: player.ready,
        connected: player.connected,
        hands: player.hands.map((hand) => ({
          cards: hand.cards.map(serializeCard),
          value: hand.value,
          isBust: hand.isBust,
          isBlackjack: hand.isBlackjack,
          finished: hand.finished,
          result: hand.result,
          bet: hand.bet
        }))
      }))
    };
  }

  advanceTurn() {
    for (let index = this.currentTurnIndex + 1; index < this.turnQueue.length; index += 1) {
      const turn = this.turnQueue[index];
      const player = this.players.find((entry) => entry.id === turn.playerId);
      if (player && player.hands[turn.handIndex] && !player.hands[turn.handIndex].finished) {
        this.currentTurnIndex = index;
        return;
      }
    }
    this.currentTurnIndex = -1;
    this.phase = "dealer";
    const canDealerDraw = this.players.some((player) => player.hands.some((hand) => !hand.isBust));
    if (!canDealerDraw) {
      this.dealerVisibleCardCount = this.dealer.cards.length;
      this.settleRound();
    }
  }

  ensureDeck(minimum = 1) {
    if (!this.deck || this.deck.remaining < minimum) this.deck = this.createDeck();
    return this.deck;
  }

  createDeck() {
    const deck = this.deckFactory();
    if (!(deck instanceof Deck)) {
      throw new GameError("DECK_INVALID", "Фабрика колоды вернула некорректную колоду.");
    }
    return deck;
  }

  drawCard() {
    if (!this.deck || !this.deck.remaining) this.deck = this.createDeck();
    return this.deck.draw();
  }

  requireBettingPhase() {
    if (this.phase !== "betting") {
      throw new GameError("ROUND_IN_PROGRESS", "Ставки принимаются только между раундами.");
    }
  }

  requirePlayer(playerId) {
    const player = this.players.find((entry) => entry.id === playerId);
    if (!player) throw new GameError("PLAYER_NOT_FOUND", "Игрок не найден за этим столом.");
    return player;
  }

  requireTurn(playerId) {
    if (this.phase !== "player" || this.currentPlayer?.id !== playerId) {
      throw new GameError("NOT_YOUR_TURN", "Сейчас ход другого игрока.");
    }
    return this.currentPlayer.hands[this.currentTurn.handIndex];
  }
}

function serializeCard(card) {
  return { rank: card.rank, suit: card.suit };
}

module.exports = { BlackjackTable, createPlayer, normalizeName };
