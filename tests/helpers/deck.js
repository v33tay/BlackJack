"use strict";

const { Card, Deck, RANKS, SUITS } = require("../../src/server/game/cards");

function buildCards(ranks) {
  const used = new Set();
  return ranks.map((rank) => {
    const suit = SUITS.find((candidate) => !used.has(`${rank}${candidate}`));
    if (!suit) throw new Error(`Too many copies of ${rank} in the test deck.`);
    used.add(`${rank}${suit}`);
    return new Card(suit, rank);
  });
}

function createExactDeck(ranks) {
  return new Deck(buildCards(ranks), { shuffle: false });
}

function createFullDeck(ranks) {
  const cards = buildCards(ranks);
  const used = new Set(cards.map((card) => `${card.rank}${card.suit}`));
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      if (!used.has(`${rank}${suit}`)) cards.push(new Card(suit, rank));
    }
  }
  return new Deck(cards, { shuffle: false });
}

module.exports = { buildCards, createExactDeck, createFullDeck };
