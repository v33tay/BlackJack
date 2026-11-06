"use strict";

const { chooseBotAction, createBotProfile, getBotBet } = require("../../src/server/game/bot-strategies");
const { Hand } = require("../../src/server/game/cards");

function player(balance = 1000) {
  return { balance };
}

describe("bot strategies", () => {
  test("assigns a distinct random name from each strategy's name pool", () => {
    const bot = createBotProfile("thoughtful", ["Стратег", "Профессор", "Счётчик", "Аналитик"]);

    expect(bot).toEqual({ type: "thoughtful", name: "Шахматист" });
  });

  test("rejects an unknown strategy", () => {
    expect(() => createBotProfile("unknown")).toThrow("Выберите один из доступных типов бота.");
  });

  test("calculates bets from bot strategy and current balance", () => {
    expect(getBotBet("risky", 1000)).toBe(200);
    expect(getBotBet("thoughtful", 1000)).toBe(100);
    expect(getBotBet("timid", 1000)).toBe(50);
    expect(getBotBet("risky", 7)).toBe(1);
    expect(getBotBet("thoughtful", 0)).toBe(0);
  });

  test("uses distinct hit and stand thresholds", () => {
    const hand = new Hand();
    hand.cards = [{ value: 0 }, { value: 0 }];
    Object.defineProperty(hand, "value", { value: 15 });
    Object.defineProperty(hand, "canDouble", { value: false });
    Object.defineProperty(hand, "canSplit", { value: false });

    expect(chooseBotAction("risky", player(), hand)).toBe("hit");
    expect(chooseBotAction("thoughtful", player(), hand)).toBe("hit");
    expect(chooseBotAction("timid", player(), hand)).toBe("stand");
  });
});
