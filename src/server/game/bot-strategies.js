"use strict";

const { randomInt } = require("node:crypto");
const { GameError } = require("./errors");

const BOT_TYPES = Object.freeze({
  risky: "Рискованный",
  thoughtful: "Продуманный",
  timid: "Трусливый"
});

const BOT_NAMES = Object.freeze({
  risky: ["Фортуна", "Ва-Банк", "Джокер", "КазиноКот", "Смельчак"],
  thoughtful: ["Стратег", "Профессор", "Счётчик", "Аналитик", "Шахматист"],
  timid: ["Осторожный", "Тихоня", "Подстрахуй", "Черепаха", "БезРиска"]
});

function createBotProfile(type, existingNames = []) {
  if (!Object.hasOwn(BOT_TYPES, type)) {
    throw new GameError("BOT_TYPE_INVALID", "Выберите один из доступных типов бота.");
  }
  const availableNames = BOT_NAMES[type].filter((name) => !existingNames.includes(name));
  const pool = availableNames.length ? availableNames : BOT_NAMES[type];
  const baseName = pool[randomInt(pool.length)];
  let name = baseName;
  let suffix = 2;
  while (existingNames.includes(name)) {
    name = `${baseName} ${suffix}`;
    suffix += 1;
  }
  return { type, name };
}

function chooseBotAction(type, player, hand) {
  const value = hand.value;
  const canDouble = hand.canDouble && player.balance >= hand.bet;

  if (type === "risky") {
    if (canDouble && value <= 12) return "double";
    if (hand.canSplit && player.balance >= hand.bet) return "split";
    return value < 19 ? "hit" : "stand";
  }

  if (type === "thoughtful") {
    if (canDouble && value >= 9 && value <= 11) return "double";
    if (hand.canSplit && player.balance >= hand.bet) return "split";
    return value < 17 ? "hit" : "stand";
  }

  return value < 12 ? "hit" : "stand";
}

module.exports = { BOT_TYPES, createBotProfile, chooseBotAction };
