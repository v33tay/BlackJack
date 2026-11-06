"use strict";

const {
  BETTING_TIME_MS,
  EMPTY_TABLE_TTL_MS,
  RECONNECT_GRACE_MS,
  ROUND_PAUSE_MS,
  TURN_TIMEOUT_MS
} = require("./game/constants");

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "0.0.0.0";
const MIN_BETTING_TIME_MS = 1000;

function readInteger(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function parseOrigins(raw) {
  if (!raw) return null;
  const origins = raw.split(",").map((origin) => origin.trim()).filter(Boolean);
  return origins.length ? origins : null;
}

function loadConfig(env = process.env) {
  const port = Number.parseInt(env.PORT ?? String(DEFAULT_PORT), 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError(`Invalid PORT value: ${env.PORT}`);
  }

  return {
    port,
    host: env.HOST || DEFAULT_HOST,
    managerOptions: {
      turnTimeoutMs: readInteger(env, "TURN_TIMEOUT_MS", TURN_TIMEOUT_MS),
      reconnectGraceMs: readInteger(env, "RECONNECT_GRACE_MS", RECONNECT_GRACE_MS),
      bettingMs: Math.max(MIN_BETTING_TIME_MS, readInteger(env, "BETTING_TIME_MS", BETTING_TIME_MS)),
      roundPauseMs: readInteger(env, "ROUND_PAUSE_MS", ROUND_PAUSE_MS),
      emptyTableTtlMs: readInteger(env, "EMPTY_TABLE_TTL_MS", EMPTY_TABLE_TTL_MS)
    },
    webSocketOptions: {
      allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS)
    }
  };
}

module.exports = { loadConfig, parseOrigins, readInteger, DEFAULT_PORT, DEFAULT_HOST, MIN_BETTING_TIME_MS };
