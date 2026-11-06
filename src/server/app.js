"use strict";

const { RoomManager } = require("./rooms/room-manager");
const { createHttpServer } = require("./http/http-server");
const { attachWebSocketServer, closeWebSocketServer } = require("./websocket/websocket-server");

function createBlackjackServer({
  port = Number.parseInt(process.env.PORT || "3000", 10),
  host = process.env.HOST || "0.0.0.0",
  managerOptions = {},
  webSocketOptions = {}
} = {}) {
  const manager = new RoomManager(managerOptions);
  const server = createHttpServer({ statusProvider: () => manager.stats() });
  const webSocketServer = attachWebSocketServer(server, manager, webSocketOptions);
  let closing = null;

  return {
    manager,
    server,
    webSocketServer,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.removeListener("error", reject);
          resolve(server.address());
        });
      });
    },
    close() {
      if (closing) return closing;
      closing = new Promise((resolve, reject) => {
        manager.close();
        closeWebSocketServer(webSocketServer)
          .then(() => {
            if (!server.listening) {
              resolve();
              return;
            }
            server.close((error) => (error ? reject(error) : resolve()));
          })
          .catch(reject);
      });
      return closing;
    }
  };
}

module.exports = { createBlackjackServer };
