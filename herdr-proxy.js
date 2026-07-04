#!/usr/bin/env node
"use strict";
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");

const debug = process.env.HERDR_PROXY_DEBUG === "1";
const log = debug ? (...a) => console.error("[herdr-proxy]", ...a) : () => {};

function start({ upstreamSocket }) {
  const proxyPath = path.join(os.tmpdir(), `herdr-proxy-${process.pid}.sock`);
  try { fs.unlinkSync(proxyPath); } catch {}

  const server = net.createServer((client) => {
    log("client connected");
    const upstream = net.createConnection(upstreamSocket);

    client.pipe(upstream);
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
