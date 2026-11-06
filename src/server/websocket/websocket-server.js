"use strict";

const { WebSocketServer, WebSocket } = require("ws");

const HEARTBEAT_INTERVAL_MS = 30_000;
const ERROR_CODES_WITH_MESSAGE = true;

function attachWebSocketServer(server, manager, {
  heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
  allowedOrigins = null,
  maxPayload = 4096,
  logger = console
} = {}) {
  const webSocketServer = new WebSocketServer({
    server,
    maxPayload,
    verifyClient: allowedOrigins ? ({ origin }) => allowedOrigins.includes(origin) : undefined
  });

  const heartbeat = setInterval(() => {
    for (const client of webSocketServer.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, heartbeatIntervalMs);
  if (typeof heartbeat.unref === "function") heartbeat.unref();
  webSocketServer.on("close", () => clearInterval(heartbeat));

  webSocketServer.on("connection", (client) => {
    client.isAlive = true;
    client.on("pong", () => { client.isAlive = true; });

    const send = (message) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
    };

    let sessionId;
    try {
      sessionId = manager.connect(send);
    } catch (error) {
      sendError(send, error, logger);
      client.close(1013, "Server is busy");
      return;
    }

    client.on("message", (payload) => {
      let command;
      try {
        command = JSON.parse(payload.toString());
      } catch {
        send({ type: "error", code: "COMMAND_INVALID", message: "Получена некорректная команда." });
        return;
      }
      try {
        manager.handle(sessionId, command);
      } catch (error) {
        sendError(send, error, logger);
      }
    });

    client.on("close", () => manager.disconnect(sessionId));
    client.on("error", (error) => logger.error("WebSocket client error:", error.message));
  });

  return webSocketServer;
}

function sendError(send, error, logger = console) {
  const isGameError = Boolean(error) && ERROR_CODES_WITH_MESSAGE && typeof error.code === "string";
  if (!isGameError) logger.error("Unexpected command failure:", error);
  send({
    type: "error",
    code: isGameError ? error.code : "INTERNAL",
    message: isGameError ? error.message : "Внутренняя ошибка сервера."
  });
}

function closeWebSocketServer(webSocketServer) {
  for (const client of webSocketServer.clients) client.terminate();
  return new Promise((resolve) => webSocketServer.close(() => resolve()));
}

module.exports = { attachWebSocketServer, closeWebSocketServer };
