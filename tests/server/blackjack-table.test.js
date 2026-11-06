"use strict";

const { createExactDeck } = require("../helpers/deck");
const { GameError } = require("../../src/server/game/errors");
const { BlackjackTable } = require("../../src/server/game/blackjack-table");

function createTable(ranks, { players = 1, balance = 1000, deckFactory } = {}) {
  const table = new BlackjackTable("ABC123", {
    deckFactory: deckFactory ?? (() => createExactDeck(ranks))
  });
  const seated = [];
  for (let index = 1; index <= players; index += 1) {
    const player = table.addPlayer(`p${index}`, `Игрок ${index}`, `token-${index}`);
    player.balance = balance;
    seated.push(player);
  }
  table.openBetting();
  return { table, seated };
}

describe("Blackjack table lifecycle", () => {
  test("waits for players and opens a betting window for them", () => {
    const table = new BlackjackTable("ABC123", { deckFactory: () => createExactDeck([]) });
    expect(table.phase).toBe("waiting");

    table.addPlayer("p1", "Первый", "token-1");
    expect(table.phase).toBe("waiting");

    table.openBetting();
    expect(table.phase).toBe("betting");
    expect(table.players[0].bet).toBe(0);
    expect(table.players[0].ready).toBe(false);
  });

  test("does not deal a round while every bet is zero", () => {
    const { table } = createTable(["10", "6", "7", "10"]);

    expect(table.hasActivePlayers()).toBe(false);
    expect(table.allReady()).toBe(false);
    expect(() => table.beginRound()).toThrow("Нет игроков с доступной ставкой.");
  });

  test("deals a round once a bet is placed", () => {
    const { table } = createTable(["10", "6", "7", "10"]);

    table.setBet("p1", 50);
    const activePlayers = table.beginRound();

    expect(activePlayers.map((player) => player.id)).toEqual(["p1"]);
    expect(table.phase).toBe("player");
    expect(table.players[0].hands[0].cards.map((card) => card.rank)).toEqual(["10", "7"]);
    expect(table.players[0].balance).toBe(950);
  });

  test("validates bets and resets readiness when the bet changes", () => {
    const { table } = createTable(["10", "6", "7", "10"]);

    expect(() => table.setBet("p1", -1)).toThrow("Ставка должна быть целым числом от 0.");
    expect(() => table.setBet("p1", 1.5)).toThrow("Ставка должна быть целым числом от 0.");
    expect(() => table.setBet("p1", 1001)).toThrow("Ставка не может превышать ваш баланс.");

    table.setBet("p1", 25);
    table.setReady("p1", true);
    expect(table.players[0].ready).toBe(true);

    table.setBet("p1", 35);
    expect(table.players[0].bet).toBe(35);
    expect(table.players[0].ready).toBe(false);
  });

  test("considers only connected players when checking readiness", () => {
    const { table } = createTable(["10", "9", "6", "7", "8", "10"], { players: 2 });

    table.setReady("p1", true);
    expect(table.allReady()).toBe(false);

    table.setReady("p2", true);
    expect(table.allReady()).toBe(true);

    table.setConnected("p2", false);
    expect(table.allReady()).toBe(true);
  });

  test("deals only to players who placed a bet", () => {
    const { table } = createTable(["10", "6", "7", "10"], { players: 2 });

    table.setBet("p1", 50);
    table.setBet("p2", 0);
    table.beginRound();

    expect(table.players[0].hands).toHaveLength(1);
    expect(table.players[1].hands).toHaveLength(0);
    expect(table.snapshot("p2").viewer.sittingOut).toBe(true);
    expect(table.snapshot("p2").viewer.canHit).toBe(false);
  });

  test("starts a fresh betting window with zero bets between rounds", () => {
    const { table } = createTable(["10", "6", "7", "10"]);
    table.setBet("p1", 50);
    table.beginRound();
    table.stand("p1");
    while (table.phase === "dealer") table.advanceDealerStep();
    expect(table.phase).toBe("over");

    table.openBetting();

    expect(table.phase).toBe("betting");
    expect(table.players[0].bet).toBe(0);
    expect(table.players[0].ready).toBe(false);
    expect(table.players[0].hands).toHaveLength(0);
    expect(table.dealer.cards).toHaveLength(0);
  });

  test("pays a natural blackjack with integer chips", () => {
    const { table } = createTable(["A", "9", "K", "7", "2"]);
    table.setBet("p1", 25);
    table.beginRound();
    while (table.phase === "dealer") table.advanceDealerStep();

    const player = table.players[0];
    expect(player.hands[0].result).toBe("blackjack");
    expect(player.balance).toBe(1012);
    expect(Number.isInteger(player.balance)).toBe(true);
  });

  test("keeps the table consistent when the deck cannot supply a split", () => {
    let created = 0;
    const deckFactory = () => {
      created += 1;
      if (created > 1) throw new GameError("DECK_EMPTY", "Колода пуста.");
      return createExactDeck(["8", "6", "8", "10"]);
    };
    const { table } = createTable([], { deckFactory });
    table.setBet("p1", 50);
    table.beginRound();

    expect(() => table.split("p1")).toThrow("Колода пуста.");

    const player = table.players[0];
    expect(player.hands).toHaveLength(1);
    expect(player.hands[0].cards.map((card) => card.rank)).toEqual(["8", "8"]);
    expect(player.balance).toBe(950);
    expect(table.phase).toBe("player");
  });

  test("reshuffles instead of failing when the shoe runs out mid-round", () => {
    const { table } = createTable(["8", "6", "8", "10"]);
    table.setBet("p1", 50);
    table.beginRound();

    expect(() => table.split("p1")).not.toThrow();

    const player = table.players[0];
    expect(player.hands).toHaveLength(2);
    expect(player.hands.every((hand) => hand.cards.length === 2)).toBe(true);
    expect(player.balance).toBe(900);
  });

  test("auto-stands a disconnected player and passes the turn", () => {
    const { table } = createTable(["10", "9", "6", "7", "8", "10"], { players: 2 });
    table.setBet("p1", 50);
    table.setBet("p2", 50);
    table.beginRound();
    expect(table.currentPlayer.id).toBe("p1");

    table.setConnected("p1", false);

    expect(table.players[0].connected).toBe(false);
    expect(table.players[0].hands[0].finished).toBe(true);
    expect(table.currentPlayer.id).toBe("p2");
  });

  test("moves the turn to the next player when the current one leaves", () => {
    const { table } = createTable(["10", "9", "6", "7", "8", "10"], { players: 2 });
    table.setBet("p1", 50);
    table.setBet("p2", 50);
    table.beginRound();

    table.removePlayer("p1");

    expect(table.players).toHaveLength(1);
    expect(table.currentPlayer.id).toBe("p2");
  });

  test("rebuy restores chips only when the balance is below the minimum bet", () => {
    const { table } = createTable(["10", "6", "7", "10"], { balance: 0 });
    const player = table.players[0];

    table.setBet("p1", 0);
    table.rebuy("p1");
    expect(player.balance).toBe(1000);

    expect(() => table.rebuy("p1")).toThrow("Докупить фишки можно, только если на балансе меньше 1.");
  });

  test("refunds unfinished hands when the round has to be force-settled", () => {
    const { table } = createTable(["10", "6", "7", "10"]);
    table.setBet("p1", 50);
    table.beginRound();

    table.forceSettle();

    const player = table.players[0];
    expect(table.phase).toBe("over");
    expect(player.hands[0].result).toBe("push");
    expect(player.balance).toBe(1000);
  });

  test("exposes viewer actions for the betting and playing phases", () => {
    const { table } = createTable(["10", "6", "7", "10"], { players: 2 });

    const bettingView = table.snapshot("p1");
    expect(bettingView.viewer.canBet).toBe(true);
    expect(bettingView.viewer.canReady).toBe(true);
    expect(bettingView.viewer.canUnready).toBe(false);
    expect(bettingView.viewer.sittingOut).toBe(true);

    table.setBet("p1", 50);
    expect(table.snapshot("p1").viewer.sittingOut).toBe(false);

    table.setReady("p1", true);
    const readyView = table.snapshot("p1");
    expect(readyView.viewer.canReady).toBe(false);
    expect(readyView.viewer.canUnready).toBe(true);

    table.beginRound();
    const playingView = table.snapshot("p1");
    expect(playingView.viewer.canBet).toBe(false);
    expect(playingView.viewer.canHit).toBe(true);
    expect(table.snapshot("p2").viewer.canHit).toBe(false);
    expect(() => table.setBet("p1", 10)).toThrow("Ставки принимаются только между раундами.");
  });
});
