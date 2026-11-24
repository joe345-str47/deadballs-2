import { RoomCore, PROTOCOL, SNAPSHOT_EVERY } from "../../shared/room.js";

const TICK_HZ = 30;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.core = null;
    this.loop = null;
    this.sockets = new Map();
    this.last = 0;
    this.snapCounter = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/init") {
      const mode = url.searchParams.get("mode") === "pvp" ? "pvp" : "coop";
      await this.state.storage.put({ created: Date.now(), mode });
      return json({ ok: true, mode });
    }

    if (path === "/exists") {
      const created = await this.state.storage.get("created");
      const mode = (await this.state.storage.get("mode")) || "coop";
      return json({ exists: !!created, mode, players: this.core ? this.core.playerCount : 0 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ error: "expected websocket" }, 426);
    }

    const storedMode = await this.state.storage.get("mode");
    const mode = storedMode === "pvp" ? "pvp" : "coop";
    if (!this.core) this.core = new RoomCore(url.searchParams.get("code") || "", mode);

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    const send = (msg) => {
      try {
        server.send(JSON.stringify(msg));
      } catch {
        // socket already closing
      }
    };

    const id = this.core.join(send, url.searchParams.get("name"));
    if (id == null) {
      send({ t: "error", reason: "full", message: "Room is full (4 survivors max)." });
      server.close(1008, "room full");
      return new Response(null, { status: 101, webSocket: client });
    }

    this.sockets.set(server, id);
    server.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.core?.message(id, msg);
    });
    const gone = () => {
      if (!this.sockets.has(server)) return;
      this.sockets.delete(server);
      this.core?.leave(id);
      if (this.core?.playerCount === 0) this.stopLoop();
    };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);

    this.startLoop();
    return new Response(null, { status: 101, webSocket: client });
  }

  startLoop() {
    if (this.loop) return;
    this.last = Date.now();
    this.loop = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.2, (now - this.last) / 1000);
      this.last = now;
      if (!this.core) return;
      this.core.update(dt);
      if (++this.snapCounter % SNAPSHOT_EVERY === 0) this.core.sendSnapshot();
    }, 1000 / TICK_HZ);
  }

  stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.core = null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, protocol: PROTOCOL });
    }

    if (url.pathname === "/api/room" && request.method === "POST") {
      let mode = "coop";
      try {
        const body = await request.json();
        if (body && body.mode === "pvp") mode = "pvp";
      } catch {
        // default to co-op
      }
      for (let i = 0; i < 6; i++) {
        const code = makeCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch("https://room/" + code + "/exists");
        const data = await res.json().catch(() => ({ exists: false }));
        if (!data.exists) {
          await stub.fetch("https://room/" + code + "/init?mode=" + mode);
          return json({ code, mode });
        }
      }
      return json({ error: "no_free_room_code" }, 503);
    }

    if (url.pathname.startsWith("/api/room/") && request.method === "GET") {
      const code = url.pathname.slice("/api/room/".length).toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) return json({ exists: false }, 400);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const res = await stub.fetch("https://room/" + code + "/exists");
      return json(await res.json().catch(() => ({ exists: false })));
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "expected websocket" }, 426);
      const code = (url.searchParams.get("room") || "").toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) return json({ error: "bad_room_code" }, 400);
      url.searchParams.set("code", code);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(new Request("https://room/" + code + "/ws" + url.search, { headers: request.headers }));
    }

    return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: "not_found" }, 404);
  },
};
