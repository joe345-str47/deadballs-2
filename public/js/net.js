// WebSocket client for the room server. Buffers authoritative snapshots and
// interpolates them ~120 ms behind the newest one so remote motion is smooth.

const INTERP_DELAY = 0.12;
const INPUT_HZ = 20;

export class NetClient {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.ws = null;
    this.you = 0;
    this.code = "";
    this.mode = "coop";
    this.arena = { w: 1600, h: 1000 };
    this.snaps = [];
    this.viewTime = 0;
    this.pending = null;
    this.pendingUrgent = false;
    this.acc = 0;
    this.pingTimer = 0;
    this.pingSeq = 1;
    this.rtt = 0;
    this.roster = [];
    this.closed = false;
    this.me = null; // locally predicted position of the own player
  }

  static urlFor(code, name, mode) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const q = new URLSearchParams({ room: code, name, mode });
    return `${proto}//${location.host}/ws?${q}`;
  }

  connect(code, name, mode) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const url = NetClient.urlFor(code, name, mode);
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {}
        reject(new Error("The room server did not answer."));
      }, 6000);

      ws.addEventListener("open", () => {
        this.pingTimer = 0;
      });
      ws.addEventListener("message", (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.t === "welcome") {
          this.you = msg.you;
          this.code = msg.code;
          this.mode = msg.mode;
          this.arena = msg.arena || this.arena;
          this.roster = msg.players || [];
          this.me = null;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(msg);
          }
          this.handlers.onWelcome?.(msg);
        } else if (msg.t === "roster") {
          this.roster = msg.players || [];
          this.handlers.onRoster?.(this.roster, msg.mode);
        } else if (msg.t === "snap") {
          this.onSnapshot(msg);
        } else if (msg.t === "error") {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error(msg.message || "Could not join that room."));
          }
          this.handlers.onError?.(msg);
        } else if (msg.t === "waiting") {
          this.handlers.onWaiting?.(msg.players);
        } else if (msg.t === "over") {
          this.handlers.onOver?.(msg);
        } else if (msg.t === "restarted") {
          this.snaps = [];
          this.me = null;
          this.handlers.onRestart?.();
        } else if (msg.t === "pong") {
          const rtt = Date.now() - msg.c;
          this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
        }
      });
      ws.addEventListener("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("Could not reach the room server."));
      });
      ws.addEventListener("close", () => {
        this.closed = true;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("The room closed before you joined."));
        }
        this.handlers.onClose?.();
      });
    });
  }

  onSnapshot(msg) {
    this.snaps.push(msg);
    if (this.snaps.length > 30) this.snaps.shift();
    const newest = this.snaps[this.snaps.length - 1];
    if (this.viewTime === 0) this.viewTime = newest.tm - INTERP_DELAY;
    if (msg.events?.length) this.handlers.onEvents?.(msg.events);
  }

  latest() {
    return this.snaps[this.snaps.length - 1] || null;
  }

  sendInput(input, urgent = false) {
    this.pending = input;
    if (urgent) this.flushInput();
  }

  flushInput() {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 || !this.pending) return;
    this.acc = 0;
    ws.send(JSON.stringify({ t: "input", ...this.pending }));
  }

  tick(dt) {
    const newest = this.latest();
    if (!newest) return;
    this.acc += dt;
    if (this.acc >= 1 / INPUT_HZ) this.flushInput();

    this.pingTimer -= dt;
    if (this.pingTimer <= 0) {
      this.pingTimer = 3;
      if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: "ping", c: Date.now() }));
    }

    // Keep the view a fixed delay behind the newest snapshot; catch up if far behind.
    this.viewTime += dt;
    const target = newest.tm - INTERP_DELAY;
    if (this.viewTime > target) this.viewTime = target;
    else if (target - this.viewTime > 0.5) this.viewTime = target;
    else if (target - this.viewTime > 0.18) this.viewTime += (target - this.viewTime) * 0.2;

    this.predict(dt, newest);
  }

  predict(dt, newest) {
    const own = newest.players.find((p) => p.i === this.you);
    if (!own) return;
    if (!own.alive) {
      this.me = null;
      return;
    }
    if (!this.me) {
      this.me = { x: own.x, y: own.y };
      return;
    }
    const input = this.pending;
    if (input && (input.mx || input.my)) {
      const speed = 245 + ((own.lv || 1) - 1) * 5;
      const len = Math.hypot(input.mx, input.my) || 1;
      const k = Math.min(1, len);
      this.me.x += (input.mx / len) * k * speed * dt;
      this.me.y += (input.my / len) * k * speed * dt;
    }
    this.me.x = Math.max(18, Math.min(this.arena.w - 18, this.me.x));
    this.me.y = Math.max(18, Math.min(this.arena.h - 18, this.me.y));

    const dx = own.x - this.me.x;
    const dy = own.y - this.me.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 160) {
      this.me.x = own.x;
      this.me.y = own.y;
    } else {
      const blend = Math.min(1, dt * 9);
      this.me.x += dx * blend;
      this.me.y += dy * blend;
    }
  }

  /** Build the render state for this frame from the snapshot buffer. */
  view() {
    const latest = this.latest();
    if (!latest) {
      return { players: [], enemies: [], bullets: [], ebullets: [], pickups: [], arena: this.arena, time: 0, localId: this.you, mode: this.mode, wave: 1, score: 0, kills: 0 };
    }
    let a = latest;
    let b = latest;
    let alpha = 0;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].tm <= this.viewTime) {
        a = this.snaps[i];
        b = this.snaps[i + 1] || a;
        const span = b.tm - a.tm;
        alpha = span > 0 ? Math.max(0, Math.min(1, (this.viewTime - a.tm) / span)) : 0;
        break;
      }
    }
    const players = a.players.map((p) => {
      const q = b.players.find((o) => o.i === p.i) || p;
      const isMe = p.i === this.you;
      const px = p.x + (q.x - p.x) * alpha;
      const py = p.y + (q.y - p.y) * alpha;
      const alive = alpha > 0.5 ? q.alive : p.alive;
      return {
        id: p.i,
        name: p.n,
        slot: p.s,
        x: isMe && this.me && alive ? this.me.x : px,
        y: isMe && this.me && alive ? this.me.y : py,
        vx: q.x - p.x,
        vy: q.y - p.y,
        angle: p.a + (q.a - p.a) * alpha,
        hp: q.hp,
        mh: q.mh,
        alive,
        invuln: q.dash ? 0.2 : 0,
        weapon: q.w,
        ammo: q.am,
        reserve: q.rs,
        reloading: !!q.rl,
        level: q.lv,
        xp: q.xp,
        kills: q.k,
        deaths: q.d,
        respawn: q.resp,
        dash: !!q.dash,
      };
    });
    const enemies = a.enemies.map((e) => {
      const q = b.enemies.find((o) => o.i === e.i) || e;
      return {
        id: e.i,
        t: e.t,
        x: e.x + (q.x - e.x) * alpha,
        y: e.y + (q.y - e.y) * alpha,
        a: e.a + (q.a - e.a) * alpha,
        hp: q.hp,
        mh: q.mh,
        f: q.f,
      };
    });
    return {
      players,
      enemies,
      bullets: latest.bullets,
      ebullets: latest.ebullets,
      pickups: latest.pickups,
      arena: this.arena,
      time: this.viewTime,
      localId: this.you,
      mode: latest.mode,
      wave: latest.wave,
      score: latest.score,
      kills: latest.kills,
      winner: latest.winner,
    };
  }

  close() {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }
}
