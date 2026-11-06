"use strict";

const { Card, Deck, Hand, createDeckCards } = require("../../src/server/game/cards");

describe("Cards, deck and hands", () => {
  test("rejects invalid cards", () => {
    expect(() => new Card("X", "1")).toThrow("Некорректная масть или ранг карты.");
  });

  test("counts aces as 11 or 1 to avoid busting", () => {
    const hand = new Hand([
      new Card("♠", "A"),
      new Card("♥", "A"),
      new Card("♦", "9")
    ]);

    expect(hand.value).toBe(21);
    expect(hand.isBust).toBe(false);
  });

  test("creates and shuffles a standard 52-card deck", () => {
    const deck = new Deck(null, { random: () => 0.5 });
    const identities = new Set(deck.cards.map((card) => `${card.rank}${card.suit}`));

    expect(deck.remaining).toBe(52);
    expect(identities.size).toBe(52);
  });

  test("builds a multi-deck shoe", () => {
    expect(createDeckCards(6)).toHaveLength(312);
    expect(new Deck(null, { decks: 3, shuffle: false }).remaining).toBe(156);
  });

  test("rejects values that are not cards", () => {
    expect(() => new Deck([{ rank: "A", suit: "♠" }])).toThrow("Колода может содержать только карты.");
  });

  test("reports an exhausted deck as a game error", () => {
    const deck = new Deck([new Card("♠", "A")], { shuffle: false });
    deck.draw();

    expect(() => deck.draw()).toThrow("Колода пуста.");
  });

  test("detects blackjack and split options", () => {
    const natural = new Hand([new Card("♠", "A"), new Card("♥", "K")]);
    const pair = new Hand([new Card("♠", "8"), new Card("♥", "8")]);
    const afterSplit = new Hand([new Card("♠", "A"), new Card("♥", "K")], 50, { isSplit: true });

    expect(natural.isBlackjack).toBe(true);
    expect(afterSplit.isBlackjack).toBe(false);
    expect(pair.canSplit).toBe(true);
    expect(natural.canSplit).toBe(false);
    expect(natural.canDouble).toBe(true);
  });
});
