"use strict";

const { loadConfig } = require("./config");
const { createBlackjackServer } = require("./app");
const { getLocalNetworkAddresses } = require("./network/local-addresses");

let application;
try {
  application = createBlackjackServer(loadConfig());
} catch (error) {
  console.error("Unable to read configuration:", error.message);
  process.exit(1);
}

let shuttingDown = false;

application.listen().then((address) => {
  console.log("Blackjack server is running:");
  console.log(`  Local:   http://localhost:${address.port}`);

  const networkAddresses = getLocalNetworkAddresses();
  if (networkAddresses.length > 0) {
    console.log("  Network:");
    for (const networkAddress of networkAddresses) {
      console.log(`           http://${networkAddress}:${address.port}`);
    }
  } else {
    console.log("  Network: no local IPv4 address found");
  }
}).catch((error) => {
  console.error("Unable to start blackjack server:", error);
  process.exitCode = 1;
});

function shutdown(signal) {
  if (shuttingDown) return Promise.resolve();
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);
  return application.close().catch((error) => {
    console.error("Unable to stop blackjack server gracefully:", error);
    process.exitCode = 1;
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(signal).finally(() => process.exit(process.exitCode ?? 0));
  });
}

process.on("unhandledRejection", (reason) => console.error("Unhandled promise rejection:", reason));
process.on("uncaughtException", (error) => console.error("Uncaught exception:", error));
