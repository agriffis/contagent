#!/usr/bin/env node
"use strict";
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");

const debug = process.env.HERDR_PROXY_DEBUG === "1";
const log = debug ? (...a) => console.error("[herdr-proxy]", ...a) : () => {};

const BLOCKED = ["workspace.", "worktree.", "integration.", "plugin."];

function isBlocked(method) {
  return typeof method === "string" && BLOCKED.some((p) => method.startsWith(p));
}

function errorResponse(id, message) {
  return JSON.stringify({ id, error: { code: "bad_request", message } }) + "\n";
}

function start({ upstreamSocket }) {
  const proxyPath = path.join(os.tmpdir(), `herdr-proxy-${process.pid}.sock`);
  try { fs.unlinkSync(proxyPath); } catch {}

  const server = net.createServer((client) => {
    log("client connected");
    const upstream = net.createConnection(upstreamSocket);

    let buf = "";

    client.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl + 1);
        buf = buf.slice(nl + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { /* pass malformed lines through */ }
        if (msg && isBlocked(msg.method)) {
          log("blocked method", msg.method);
          client.write(errorResponse(msg.id, `method not available: ${msg.method}`));
        } else {
          upstream.write(line);
        }
      }
    });

    upstream.pipe(client);

    client.on("error", (e) => { log("client error", e.message); upstream.destroy(); });
    upstream.on("error", (e) => { log("upstream error", e.message); client.destroy(); });
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(proxyPath, () => {
      log(`listening at ${proxyPath}, proxying to ${upstreamSocket}`);
      resolve({
        socketPath: proxyPath,
        shutdown: () => new Promise((res) => {
          server.close(() => {
            try { fs.unlinkSync(proxyPath); } catch {}
            res();
          });
        }),
      });
    });
  });
}

module.exports = { start };
