// Transport-independent room logic. The Cloudflare Durable Object and the
// local Node dev server both wrap this class, so multiplayer behaves the same
// in production and in tests.

import { createWorld, addPlayer, removePlayer, applyInput, step, snapshot, MAX_PLAYERS, TICK } from "../public/js/sim.js";

export const PROTOCOL = 1;
export const SNAPSHOT_EVERY = 2; // 30 Hz simulation -> 15 Hz snapshots, interpolated on the client
const MAX_MESSAGES_PER_SECOND = 90;

export class RoomCore {
  constructor(code, mode = "coop") {
    this.code = code;
    this.mode = mode === "pvp" ? "pvp" : "coop";
    this.world = createWorld(this.mode);
    this.clients = new Map(); // id -> { send, name, msgs, window }
    this.nextPlayerId = 1;
    this.ticks = 0;
    this.endedAt = null;
    this.lastWait = "";
  }

  get playerCount() {
    return this.clients.size;
  }

  join(send, name) {
    if (this.clients.size >= MAX_PLAYERS) {
      send({ t: "error", reason: "full", message: "Room is full (4 survivors max)." });
      return null;
    }
    const id = this.nextPlayerId++;
    const player = addPlayer(this.world, id, name || "SURVIVOR " + id);
    if (!player) {
      send({ t: "error", reason: "full", message: "Room is full (4 survivors max)." });
      return null;
    }
    this.clients.set(id, { send, name: player.name, msgs: 0, window: Date.now() });
    send({
      t: "welcome",
      protocol: PROTOCOL,
      you: id,
      code: this.code,
      mode: this.mode,
      tick: Math.round(1 / TICK),
      arena: { w: this.world.w, h: this.world.h },
      players: this.roster(),
    });
    this.announceRoster();
    return id;
  }

  leave(id) {
    this.clients.delete(id);
    removePlayer(this.world, id);
    this.announceRoster();
  }

  roster() {
    return this.world.players.map((p) => ({ id: p.id, name: p.name, slot: p.slot }));
  }

  announceRoster() {
    const players = this.roster();
    for (const c of this.clients.values()) c.send({ t: "roster", players, mode: this.mode });
  }

  message(id, msg) {
    const client = this.clients.get(id);
    if (!client || !msg || typeof msg !== "object") return;
    const now = Date.now();
    if (now - client.window > 1000) {
      client.window = now;
      client.msgs = 0;
    }
    if (++client.msgs > MAX_MESSAGES_PER_SECOND) return;

    switch (msg.t) {
      case "input":
        applyInput(this.world, id, msg);
        break;
      case "ping":
        client.send({ t: "pong", c: msg.c, s: now });
        break;
      case "restart":
        if (this.world.winner && this.endedAt && now - this.endedAt > 2500) this.restart();
        break;
      case "chat":
        // not part of the game yet; ignored so a stray message cannot break a room
        break;
      default:
        break;
    }
  }

  restart() {
    this.world = createWorld(this.mode);
    for (const [id, client] of this.clients) addPlayer(this.world, id, client.name);
    this.endedAt = null;
    this.announceRoster();
    this.broadcast({ t: "restarted" });
  }

  broadcast(msg) {
    for (const c of this.clients.values()) c.send(msg);
  }

  update(dt) {
    if (this.clients.size === 0) return;
    if (this.mode === "pvp" && this.clients.size < 2) {
      const key = "waiting:" + this.clients.size;
      if (this.lastWait !== key) {
        this.lastWait = key;
        this.broadcast({ t: "waiting", players: this.clients.size });
      }
      return;
    }
    this.lastWait = "";
    step(this.world, dt);
    this.ticks++;
    if (this.world.winner && this.endedAt === null) {
      this.endedAt = Date.now();
      const winner = this.world.players.find((p) => p.id === this.world.winner);
      this.broadcast({ t: "over", winner: this.world.winner, name: winner ? winner.name : "" });
    }
  }

  sendSnapshot() {
    if (this.clients.size === 0) return;
    if (this.mode === "pvp" && this.clients.size < 2) return;
    const snap = snapshot(this.world);
    for (const c of this.clients.values()) c.send({ t: "snap", ...snap });
  }
}
