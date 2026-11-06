"use strict";

const { Card } = require("../../src/server/game/cards");
const { blackjackPayout, handValue, settleHand } = require("../../src/server/game/rules");

describe("Payout rules", () => {
  const base = { dealerValue: 18, dealerBlackjack: false, dealerBust: false };

  test("pays 3:2 with integer chips only", () => {
    expect(blackjackPayout(50)).toBe(75);
    expect(blackjackPayout(2)).toBe(3);
    expect(blackjackPayout(25)).toBe(37);
    expect(Number.isInteger(blackjackPayout(25))).toBe(true);
    expect(Number.isInteger(blackjackPayout(26))).toBe(true);
  });

  test("pays a natural blackjack", () => {
    expect(settleHand({ ...base, value: 21, isBust: false, isBlackjack: true, bet: 50 }))
      .toEqual({ result: "blackjack", payout: 75 });
  });

  test("returns the stake on a push, including two naturals", () => {
    expect(settleHand({ ...base, value: 18, isBust: false, isBlackjack: false, bet: 50 }))
      .toEqual({ result: "push", payout: 50 });
    expect(settleHand({ ...base, dealerBlackjack: true, value: 21, isBust: false, isBlackjack: true, bet: 50 }))
      .toEqual({ result: "push", payout: 50 });
  });

  test("loses the stake on a bust even when the dealer busts", () => {
    expect(settleHand({ ...base, dealerBust: true, value: 22, isBust: true, isBlackjack: false, bet: 50 }))
      .toEqual({ result: "lose", payout: 0 });
  });

  test("loses the stake against a dealer blackjack", () => {
    expect(settleHand({ ...base, dealerBlackjack: true, value: 20, isBust: false, isBlackjack: false, bet: 50 }))
      .toEqual({ result: "lose", payout: 0 });
  });

  test("wins against a busted or lower dealer hand", () => {
    expect(settleHand({ ...base, dealerBust: true, value: 12, isBust: false, isBlackjack: false, bet: 50 }))
      .toEqual({ result: "win", payout: 100 });
    expect(settleHand({ ...base, value: 20, isBust: false, isBlackjack: false, bet: 50 }))
      .toEqual({ result: "win", payout: 100 });
    expect(settleHand({ ...base, value: 17, isBust: false, isBlackjack: false, bet: 50 }))
      .toEqual({ result: "lose", payout: 0 });
  });

  test("computes a soft hand value from cards", () => {
    expect(handValue([new Card("♠", "A"), new Card("♥", "6")])).toBe(17);
    expect(handValue([])).toBe(0);
  });
});
