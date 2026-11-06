"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const CLIENT_DIRECTORY = path.resolve(__dirname, "../../client");
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles/main.css", ["styles/main.css", "text/css; charset=utf-8"]],
  ["/scripts/main.js", ["scripts/main.js", "text/javascript; charset=utf-8"]]
]);

function createHttpServer({ statusProvider = null } = {}) {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;

    if (pathname === "/health") {
      sendText(response, request, 200, "ok");
      return;
    }

    if (pathname === "/status") {
      const status = statusProvider ? statusProvider() : {};
      sendJson(response, request, 200, { ...status, uptime: Math.round(process.uptime()) });
      return;
    }

    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    const file = PUBLIC_FILES.get(pathname);
    if (!file) {
      sendText(response, request, 404, "Not found");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
      response.end("Method not allowed");
      return;
    }

    fs.readFile(path.join(CLIENT_DIRECTORY, file[0]), (error, content) => {
      if (error) {
        sendText(response, request, 500, "Unable to load game files.");
        return;
      }
      response.writeHead(200, {
        "content-type": file[1],
        "content-length": Buffer.byteLength(content),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      response.end(request.method === "HEAD" ? undefined : content);
    });
  });
}

function sendText(response, request, status, body) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

function sendJson(response, request, status, body) {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(request.method === "HEAD" ? undefined : json);
}

module.exports = { createHttpServer };
