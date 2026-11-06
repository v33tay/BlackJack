"use strict";

const { GameError } = require("./errors");
const { handValue } = require("./rules");

const SUITS = ["\u2660", "\u2665", "\u2666", "\u2663"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

class Card {
  constructor(suit, rank) {
    if (!SUITS.includes(suit) || !RANKS.includes(String(rank))) {
      throw new GameError("CARD_INVALID", "Некорректная масть или ранг карты.");
    }
    this.suit = suit;
    this.rank = String(rank);
  }

  get value() {
    if (this.rank === "A") return 11;
    if (["J", "Q", "K"].includes(this.rank)) return 10;
    return Number(this.rank);
  }
}

function createDeckCards(decks = 1) {
  const cards = [];
  for (let deck = 0; deck < decks; deck += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push(new Card(suit, rank));
    }
  }
  return cards;
}

class Deck {
  constructor(cards = null, { shuffle = true, random = Math.random, decks = 1 } = {}) {
    if (cards) {
      this.cards = [...cards];
      if (this.cards.some((card) => !(card instanceof Card))) {
        throw new GameError("DECK_INVALID", "Колода может содержать только карты.");
      }
    } else {
      this.cards = createDeckCards(decks);
    }
    if (shuffle) this.shuffle(random);
  }

  get remaining() {
    return this.cards.length;
  }

  shuffle(random = Math.random) {
    for (let index = this.cards.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [this.cards[index], this.cards[swapIndex]] = [this.cards[swapIndex], this.cards[index]];
    }
    return this;
  }

  draw() {
    if (this.cards.length === 0) {
      throw new GameError("DECK_EMPTY", "Колода пуста.");
    }
    return this.cards.shift();
  }
}

class Hand {
  constructor(cards = [], bet = 0, { isSplit = false } = {}) {
    this.cards = [...cards];
    this.bet = bet;
    this.isSplit = isSplit;
    this.doubled = false;
    this.finished = false;
    this.result = null;
  }

  get value() {
    return handValue(this.cards);
  }

  get isBust() {
    return this.value > 21;
  }

  get isBlackjack() {
    return !this.isSplit && this.cards.length === 2 && this.value === 21;
  }

  get canSplit() {
    return !this.isSplit
      && this.cards.length === 2
      && this.cards[0].rank === this.cards[1].rank;
  }

  get canDouble() {
    return this.cards.length === 2 && !this.doubled;
  }
}

module.exports = { Card, Deck, Hand, createDeckCards, SUITS, RANKS };
