"use strict";

const { WebSocket } = require("ws");

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForClose(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for close.")), 3000);
    socket.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function waitForMessage(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeListener("message", onMessage);
      reject(new Error("Timed out waiting for a server message."));
    }, 3000);
    function onMessage(payload) {
      const message = JSON.parse(payload.toString());
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.removeListener("message", onMessage);
      resolve(message);
    }
    socket.on("message", onMessage);
  });
}

async function waitFor(predicate) {
  const started = Date.now();
  while (Date.now() - started < 3000) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition was not met in time.");
}

async function openClient(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await waitForOpen(socket);
  return socket;
}

module.exports = { WebSocket, waitForOpen, waitForClose, waitForMessage, waitFor, openClient };
