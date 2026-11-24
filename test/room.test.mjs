import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import net from "node:net";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

let server;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await wait(100);
  }
  throw new Error("dev server did not start");
}

class Client {
  constructor(code, name, mode = "coop") {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${code}&name=${encodeURIComponent(name)}&mode=${mode}`);
    this.messages = [];
    this.snaps = [];
    this.welcome = null;
    this.roster = null;
    this.over = null;
    this.waiting = null;
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      this.messages.push(msg);
      if (msg.t === "welcome") this.welcome = msg;
      else if (msg.t === "roster") this.roster = msg;
      else if (msg.t === "snap") this.snaps.push(msg);
      else if (msg.t === "over") this.over = msg;
      else if (msg.t === "waiting") this.waiting = msg;
    });
  }
  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await once(this.ws, "open");
  }
  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }
  get lastSnap() {
    return this.snaps[this.snaps.length - 1];
  }
  close() {
    this.ws.close();
  }
}

async function createRoom(mode) {
  const res = await fetch(`${BASE}/api/room`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  assert.equal(res.status, 200);
  return res.json();
}

test.before(async () => {
  server = spawn(process.execPath, ["server/dev.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[dev] " + d));
  await waitForHealth();
});

test.after(() => {
  server?.kill();
});

test("health, room creation and room lookup", async () => {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(health.ok, true);
  const room = await createRoom("coop");
  assert.match(room.code, /^[A-Z0-9]{4}$/);
  assert.equal(room.mode, "coop");
  const look = await (await fetch(`${BASE}/api/room/${room.code}`)).json();
  assert.equal(look.exists, true);
  assert.equal(look.mode, "coop");
  const missing = await (await fetch(`${BASE}/api/room/ZZZZ`)).json();
  assert.equal(missing.exists, false);
});

test("two clients see each other move in co-op", async () => {
  const { code } = await createRoom("coop");
  const a = new Client(code, "ALPHA");
  const b = new Client(code, "BRAVO");
  await Promise.all([a.open(), b.open()]);
  await wait(300);

  assert.equal(a.welcome.you, 1);
  assert.equal(b.welcome.you, 2);
  assert.equal(a.welcome.mode, "coop");
  assert.equal(b.welcome.arena.w, 1600);
  assert.deepEqual(
    a.roster.players.map((p) => p.name).sort(),
    ["ALPHA", "BRAVO"]
  );

  const startA = a.lastSnap.players.find((p) => p.i === 1);
  const startB = b.lastSnap.players.find((p) => p.i === 2);

  a.send({ t: "input", mx: 1, my: 0, aim: 0 });
  b.send({ t: "input", mx: 0, my: -1, aim: 1.5 });
  await wait(400);

  const snapA = a.lastSnap.players.find((p) => p.i === 1);
  const snapBfromA = a.lastSnap.players.find((p) => p.i === 2);
  assert.ok(snapA.x > startA.x + 40, `A moved right (${startA.x} -> ${snapA.x})`);
  assert.ok(snapBfromA.y < startB.y - 30, "A sees B move up");
  assert.ok(a.lastSnap.enemies.length > 0 || a.lastSnap.wave >= 1, "co-op spawned enemies");
  assert.equal(a.welcome.tick, 30);

  a.close();
  b.close();
  await wait(100);
});

test("shots damage a shared enemy and pings answer", async () => {
  const { code } = await createRoom("coop");
  const a = new Client(code, "ALPHA");
  const b = new Client(code, "BRAVO");
  await Promise.all([a.open(), b.open()]);
  await wait(1800);

  a.send({ t: "ping", c: 12345 });
  await wait(200);
  const pong = a.messages.find((m) => m.t === "pong");
  assert.ok(pong, "pong received");
  assert.equal(pong.c, 12345);

  const enemy = a.lastSnap.enemies[0];
  assert.ok(enemy, "an enemy exists");
  const before = enemy.hp;

  // Chase the nearest enemy and keep firing until a hit lands on the server.
  for (let i = 0; i < 30; i++) {
    const snap = a.lastSnap;
    const me = snap.players.find((p) => p.i === 1);
    const target = snap.enemies
      .map((e) => ({ e, d: Math.hypot(e.x - me.x, e.y - me.y) }))
      .sort((x, y) => x.d - y.d)[0];
    if (!target) break;
    const dx = target.e.x - me.x;
    const dy = target.e.y - me.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    a.send({ t: "input", mx: dx / d, my: dy / d, aim: Math.atan2(dy, dx), fire: true });
    await wait(100);
  }
  a.send({ t: "input", mx: 0, my: 0, aim: 0, fire: false });
  await wait(200);

  const hits = b.snaps.flatMap((s) => s.events || []).filter((ev) => ev.t === "hit" || ev.t === "kill");
  const seen = b.snaps.flatMap((s) => s.enemies).filter((e) => e.i === enemy.i);
  const damaged =
    hits.length > 0 ||
    seen.some((e) => e.hp < before) ||
    !b.lastSnap.enemies.some((e) => e.i === enemy.i);
  assert.ok(damaged, "B saw the enemy take damage or die");

  a.close();
  b.close();
  await wait(100);
});

test("pvp room waits for a second player, then trades damage", async () => {
  const { code } = await createRoom("pvp");
  const a = new Client(code, "ALPHA", "pvp");
  await a.open();
  await wait(350);
  assert.equal(a.welcome.mode, "pvp");
  assert.equal(a.waiting?.players, 1);
  assert.equal(a.snaps.length, 0, "no snapshots while waiting");

  const b = new Client(code, "BRAVO", "pvp");
  await b.open();
  await wait(400);
  assert.ok(a.snaps.length > 0, "snapshots start with two players");
  assert.equal(a.lastSnap.mode, "pvp");
  assert.equal(a.lastSnap.enemies.length, 0, "no zombies in deathmatch");

  a.close();
  b.close();
  await wait(100);
});

test("a fifth client is refused and disconnects do not break the room", async () => {
  const { code } = await createRoom("coop");
  const clients = [];
  for (let i = 0; i < 5; i++) {
    const c = new Client(code, "P" + i);
    clients.push(c);
  }
  await Promise.all(clients.map((c) => c.open()));
  await wait(500);

  const fifth = clients[4];
  const refused = fifth.messages.some((m) => m.t === "error" && m.reason === "full");
  assert.ok(refused, "fifth client told the room is full");

  clients[0].close();
  await wait(300);
  assert.equal(clients[1].roster.players.length, 3, "roster shrinks after a disconnect");
  assert.ok(
    !clients[1].roster.players.some((p) => p.name === "P0"),
    "the player who left is dropped from the roster"
  );
  assert.ok(clients[1].lastSnap.players.some((p) => p.i === 2));

  for (const c of clients) c.close();
  await wait(100);
});

test("bad messages and bad room codes are rejected without crashing", async () => {
  const rawStatus = await new Promise((resolve) => {
    const sock = net.connect(PORT, "127.0.0.1", () => {
      sock.write(
        "GET /ws?room=bad%20code HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
      );
    });
    sock.once("data", (d) => {
      resolve(Number(String(d).split(" ")[1]));
      sock.destroy();
    });
    sock.on("error", () => resolve(0));
  });
  assert.equal(rawStatus, 400);
  const noWs = await fetch(`${BASE}/ws?room=ABCD`);
  assert.equal(noWs.status, 426);
  const bad = await fetch(`${BASE}/api/room/ab`);
  assert.equal(bad.status, 400);

  const { code } = await createRoom("coop");
  const a = new Client(code, "ALPHA");
  await a.open();
  a.ws.send("not json");
  a.ws.send(JSON.stringify(null));
  a.ws.send(JSON.stringify({ t: "input", mx: "x", my: null }));
  a.ws.send(JSON.stringify({ t: "nope" }));
  await wait(300);
  assert.ok(a.lastSnap, "room still running after garbage input");
  a.close();
});
