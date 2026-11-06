"use strict";

const { DEFAULT_HOST, DEFAULT_PORT, MIN_BETTING_TIME_MS, loadConfig, parseOrigins, readInteger } = require("../../src/server/config");
const { BETTING_TIME_MS, EMPTY_TABLE_TTL_MS, RECONNECT_GRACE_MS, ROUND_PAUSE_MS, TURN_TIMEOUT_MS } = require("../../src/server/game/constants");

describe("Server configuration", () => {
  test("uses sensible defaults", () => {
    const config = loadConfig({});

    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.host).toBe(DEFAULT_HOST);
    expect(config.managerOptions).toEqual({
      turnTimeoutMs: TURN_TIMEOUT_MS,
      reconnectGraceMs: RECONNECT_GRACE_MS,
      bettingMs: BETTING_TIME_MS,
      roundPauseMs: ROUND_PAUSE_MS,
      emptyTableTtlMs: EMPTY_TABLE_TTL_MS
    });
    expect(config.webSocketOptions.allowedOrigins).toBeNull();
  });

  test("reads port, host and timers from the environment", () => {
    const config = loadConfig({
      PORT: "0",
      HOST: "127.0.0.1",
      TURN_TIMEOUT_MS: "1000",
      RECONNECT_GRACE_MS: "0",
      BETTING_TIME_MS: "15000",
      ROUND_PAUSE_MS: "2500",
      EMPTY_TABLE_TTL_MS: "60000"
    });

    expect(config).toMatchObject({
      port: 0,
      host: "127.0.0.1",
      managerOptions: {
        turnTimeoutMs: 1000,
        reconnectGraceMs: 0,
        bettingMs: 15000,
        roundPauseMs: 2500,
        emptyTableTtlMs: 60000
      }
    });
    expect(loadConfig({ BETTING_TIME_MS: "10" }).managerOptions.bettingMs).toBe(MIN_BETTING_TIME_MS);
  });

  test("rejects an invalid port", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow("Invalid PORT value: abc");
    expect(() => loadConfig({ PORT: "70000" })).toThrow(RangeError);
  });

  test("parses the origin allow-list", () => {
    expect(parseOrigins("http://a.local, http://b.local")).toEqual(["http://a.local", "http://b.local"]);
    expect(parseOrigins("")).toBeNull();
    expect(parseOrigins(" , ")).toBeNull();
    expect(parseOrigins(undefined)).toBeNull();
  });

  test("falls back for invalid timer values", () => {
    expect(readInteger({}, "TURN_TIMEOUT_MS", 42)).toBe(42);
    expect(readInteger({ TURN_TIMEOUT_MS: "abc" }, "TURN_TIMEOUT_MS", 42)).toBe(42);
    expect(readInteger({ TURN_TIMEOUT_MS: "-5" }, "TURN_TIMEOUT_MS", 42)).toBe(42);
    expect(readInteger({ TURN_TIMEOUT_MS: "0" }, "TURN_TIMEOUT_MS", 42)).toBe(0);
  });
});
