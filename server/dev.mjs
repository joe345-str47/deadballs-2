// Local development server: serves public/ and runs the same RoomCore the
// Cloudflare Durable Object uses, over a small RFC 6455 WebSocket implementation
// so the project needs no runtime dependencies.
//
//   npm run dev   ->  http://127.0.0.1:8787

import http from "node:http";
import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { RoomCore, PROTOCOL, SNAPSHOT_EVERY } from "../shared/room.js";

const ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const TICK_MS = 1000 / 30;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const rooms = new Map(); // code -> { core, sockets, timer, snaps }

function getRoom(code) {
  let room = rooms.get(code);
  if (room) return room;
  const mode = createdRooms.get(code) || "coop";
  const core = new RoomCore(code, mode);
  const sockets = new Map();
  const entry = { core, sockets, snaps: 0, timer: null };
  entry.timer = setInterval(() => {
    if (core.playerCount === 0) {
      clearInterval(entry.timer);
      rooms.delete(code);
      return;
    }
    core.update(TICK_MS / 1000);
    if (++entry.snaps % SNAPSHOT_EVERY === 0) core.sendSnapshot();
  }, TICK_MS);
  room = entry;
  rooms.set(code, room);
  return room;
}

const createdRooms = new Map(); // code -> mode, so a join after a restart keeps the mode

const makeCode = () => {
  const bytes = crypto.randomBytes(4);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
};

const json = (res, body, status = 200) => {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 4096) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });

// ---------- minimal websocket server ----------
function encodeFrame(op, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | op;
  return Buffer.concat([header, data]);
}

function attachSocket(socket, head) {
  let buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
  let closed = false;
  const state = {
    socket,
    send: (obj) => {
      if (closed || socket.destroyed) return;
      try {
        socket.write(encodeFrame(0x1, JSON.stringify(obj)));
      } catch {
        closed = true;
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      try {
        socket.end(encodeFrame(0x8, Buffer.alloc(0)));
      } catch {
        socket.destroy();
      }
    },
    onMessage: null,
    onClose: null,
  };

  const finish = () => {
    if (closed) return;
    closed = true;
    state.onClose?.();
  };

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0;
      const op = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let len = buffer[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        len = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (len > 1 << 20) {
        socket.destroy();
        return;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (buffer.length < offset + len) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + len));
      if (masked) {
        const mask = buffer.subarray(maskOffset, maskOffset + 4);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buffer = buffer.subarray(offset + len);

      if (!fin) {
        // Browsers do not fragment these small messages; drop if it ever happens.
        continue;
      }
      if (op === 0x1 || op === 0x2) {
        try {
          state.onMessage?.(payload.toString("utf8"));
        } catch {
          // a bad message must not kill the socket
        }
      } else if (op === 0x9) {
        socket.write(encodeFrame(0xa, payload));
      } else if (op === 0x8) {
        finish();
        try {
          socket.end(encodeFrame(0x8, Buffer.alloc(0)));
        } catch {
          socket.destroy();
        }
        return;
      }
    }
  });

  socket.on("close", finish);
  socket.on("error", finish);
  return state;
}

// ---------- static files ----------
async function serveStatic(req, res, pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(ROOT, clean);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    let info = await stat(file);
    if (info.isDirectory()) {
      file = join(file, "index.html");
      info = await stat(file);
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end("not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === "/api/health") return json(res, { ok: true, protocol: PROTOCOL });

  if (path === "/api/room" && req.method === "POST") {
    const body = await readBody(req);
    const mode = body.mode === "pvp" ? "pvp" : "coop";
    for (let i = 0; i < 20; i++) {
      const code = makeCode();
      if (!createdRooms.has(code)) {
        createdRooms.set(code, mode);
        return json(res, { code, mode });
      }
    }
    return json(res, { error: "no_free_room_code" }, 503);
  }

  if (path.startsWith("/api/room/") && req.method === "GET") {
    const code = path.slice("/api/room/".length).toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) return json(res, { exists: false }, 400);
    const room = rooms.get(code);
    return json(res, { exists: createdRooms.has(code), mode: createdRooms.get(code) || "coop", players: room ? room.core.playerCount : 0 });
  }

  if (path === "/ws") {
    return json(res, { error: "expected websocket" }, 426);
  }

  if (req.method !== "GET" && req.method !== "HEAD") return json(res, { error: "method_not_allowed" }, 405);
  return serveStatic(req, res, path === "/" ? "/index.html" : path);
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const code = (url.searchParams.get("room") || "").toUpperCase();
  const key = req.headers["sec-websocket-key"];

  const reject = (status, text) => {
    const body = text + "\n";
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };

  if (url.pathname !== "/ws" || !key || req.headers.upgrade?.toLowerCase() !== "websocket") {
    return reject(426, "expected websocket");
  }
  if (!/^[A-Z0-9]{4}$/.test(code)) return reject(400, "bad_room_code");

  const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);
  const state = attachSocket(socket, head);
  const room = getRoom(code);
  const id = room.core.join(state.send, url.searchParams.get("name"));
  if (id == null) {
    state.close();
    return;
  }
  state.onMessage = (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    room.core.message(id, msg);
  };
  state.onClose = () => {
    room.core.leave(id);
  };
});

server.listen(PORT, HOST, () => {
  console.log(`DEADBALLS 2 dev server: http://${HOST}:${PORT} (rooms via ws://${HOST}:${PORT}/ws)`);
});
