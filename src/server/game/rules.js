"use strict";

function handValue(cards) {
  let total = cards.reduce((sum, card) => sum + card.value, 0);
  let aces = cards.filter((card) => card.rank === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

// Фишки целые: при нечётной ставке половина фишки округляется в пользу стола.
function blackjackPayout(bet) {
  return bet + Math.floor(bet / 2);
}

function settleHand({ value, isBust, isBlackjack, bet, dealerValue, dealerBlackjack, dealerBust }) {
  if (isBust) return { result: "lose", payout: 0 };
  if (isBlackjack) {
    if (dealerBlackjack) return { result: "push", payout: bet };
    return { result: "blackjack", payout: blackjackPayout(bet) };
  }
  if (dealerBlackjack) return { result: "lose", payout: 0 };
  if (dealerBust || value > dealerValue) return { result: "win", payout: bet * 2 };
  if (value === dealerValue) return { result: "push", payout: bet };
  return { result: "lose", payout: 0 };
}

module.exports = { handValue, settleHand, blackjackPayout };
