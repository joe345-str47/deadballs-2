// Canvas renderer: camera, tiled arena, sprite entities, effects and screen shake.

import { art, playerArt, drawSheet, drawFrame } from "./sprites.js";

const TILE = 128;
const MAX_PARTICLES = 420;
const ENEMY_SHEET = { walker: "walker", runner: "runner", brute: "brute", spitter: "spitter", boss: "boss" };
const ENEMY_SIZE = { walker: 46, runner: 34, brute: 68, spitter: 46, boss: 112 };
const GIB_COLOR = { walker: "#5d7f5a", runner: "#a89a58", brute: "#8d5638", spitter: "#5f8f4a", boss: "#7137a8" };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.zoom = 1;
    this.camX = 800;
    this.camY = 500;
    this.particles = [];
    this.shake = 0;
    this.time = 0;
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth;
    this.h = innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
    this.zoom = Math.max(0.5, Math.min(1.5, Math.min(this.w / 1000, this.h / 700)));
  }

  addEvent(ev) {
    if (!ev || !ev.t) return;
    const { x, y } = ev;
    switch (ev.t) {
      case "shot":
        this.burst(x, y, "#ffd27a", 4, 120, 0.18);
        this.time0 = 0;
        break;
      case "impact":
        this.burst(x, y, "#ffd98a", 3, 150, 0.16);
        break;
      case "kill":
        this.burst(x, y, GIB_COLOR[ev.k] || "#70a86c", ev.boss ? 26 : 12, ev.boss ? 320 : 220, 0.55);
        this.burst(x, y, "#8f1d24", ev.boss ? 12 : 5, 180, 0.4);
        this.shake = Math.max(this.shake, ev.boss ? 16 : 4);
        break;
      case "death":
        this.burst(x, y, "#e54b58", 18, 300, 0.6);
        this.shake = 14;
        break;
      case "hit":
        this.burst(x, y, "#ef4444", 6, 170, 0.3);
        this.shake = Math.max(this.shake, 7);
        break;
      case "pickup":
        this.burst(x, y, "#5ee28b", 8, 130, 0.45);
        break;
      case "level":
      case "spawn":
        this.burst(x, y, "#c084fc", 12, 160, 0.5);
        break;
      case "dash":
        this.burst(x, y, "#a855f7", 6, 90, 0.3);
        break;
      case "spit":
        this.burst(x, y, "#8b5cf6", 5, 110, 0.3);
        break;
      default:
        break;
    }
  }

  burst(x, y, color, n, speed, life) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.25 + Math.random() * 0.85);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        max: life,
        size: 1.5 + Math.random() * 3,
        color,
      });
    }
  }

  update(dt) {
    this.time += dt;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.93;
      p.vy *= 0.93;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - dt * 34);
  }

  worldToScreen(x, y) {
    return { x: (x - this.camX) * this.zoom + this.w / 2, y: (y - this.camY) * this.zoom + this.h / 2 };
  }

  draw(view) {
    const { ctx } = this;
    const arena = view.arena;
    const focus = view.players.find((p) => p.id === view.localId && p.alive) || view.players.find((p) => p.id === view.localId) || { x: arena.w / 2, y: arena.h / 2 };
    // camera eases toward the focus point
    this.camX += (focus.x - this.camX) * 0.14;
    this.camY += (focus.y - this.camY) * 0.14;
    const halfW = this.w / 2 / this.zoom;
    const halfH = this.h / 2 / this.zoom;
    if (arena.w <= halfW * 2) this.camX = arena.w / 2;
    else this.camX = Math.max(halfW, Math.min(arena.w - halfW, this.camX));
    if (arena.h <= halfH * 2) this.camY = arena.h / 2;
    else this.camY = Math.max(halfH, Math.min(arena.h - halfH, this.camY));

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#07090d";
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.save();
    if (this.shake > 0.2) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    this.drawFloor(ctx, arena);
    this.drawArenaMarks(ctx, arena);
    this.drawPickups(ctx, view.pickups, view.time);
    this.drawBullets(ctx, view.bullets, view.ebullets);
    this.drawEnemies(ctx, view.enemies);
    this.drawPlayers(ctx, view.players, view.localId);
    this.drawParticles(ctx);
    ctx.restore();
    this.drawOffscreenArrows(view);
  }

  drawFloor(ctx, arena) {
    const tiles = art.sheets.tiles;
    const left = this.camX - this.w / 2 / this.zoom;
    const top = this.camY - this.h / 2 / this.zoom;
    const right = this.camX + this.w / 2 / this.zoom;
    const bottom = this.camY + this.h / 2 / this.zoom;
    const gx0 = Math.floor(Math.max(0, left) / TILE);
    const gx1 = Math.ceil(Math.min(arena.w, right) / TILE);
    const gy0 = Math.floor(Math.max(0, top) / TILE);
    const gy1 = Math.ceil(Math.min(arena.h, bottom) / TILE);

    if (tiles) {
      for (let gy = gy0; gy < gy1; gy++) {
        for (let gx = gx0; gx < gx1; gx++) {
          const v = (gx * 7 + gy * 13) % 2;
          ctx.drawImage(tiles.img, v * tiles.frameW, 0, tiles.frameW, tiles.frameH, gx * TILE, gy * TILE, TILE, TILE);
        }
      }
    } else {
      ctx.fillStyle = "#0e161f";
      ctx.fillRect(0, 0, arena.w, arena.h);
    }

    // arena floor tint and boundary
    ctx.fillStyle = "rgba(8,10,16,.28)";
    ctx.fillRect(0, 0, arena.w, arena.h);
    ctx.strokeStyle = "rgba(168,85,247,.35)";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, arena.w - 4, arena.h - 4);
    ctx.strokeStyle = "rgba(168,85,247,.10)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(arena.w / 2, arena.h / 2, Math.min(arena.w, arena.h) * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(arena.w / 2, arena.h / 2, Math.min(arena.w, arena.h) * 0.33, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawArenaMarks(ctx, arena) {
    ctx.strokeStyle = "rgba(246,198,91,.16)";
    ctx.lineWidth = 3;
    for (const [x, y, w, h] of [
      [80, 80, 120, 6],
      [arena.w - 200, 80, 120, 6],
      [80, arena.h - 86, 120, 6],
      [arena.w - 200, arena.h - 86, 120, 6],
    ]) {
      ctx.strokeRect(x, y, w, h);
    }
  }

  drawPickups(ctx, pickups, time) {
    const sheet = art.sheets.pickups;
    for (const p of pickups ?? []) {
      const bob = Math.sin(time * 4 + p.x * 0.01) * 3;
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = p.t === "health" ? "#5ee28b" : "#f6c65b";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (sheet) drawFrame(ctx, sheet, p.t === "health" ? 0 : 1, p.x, p.y + bob, 30);
      else {
        ctx.fillStyle = p.t === "health" ? "#5ee28b" : "#f6c65b";
        ctx.fillRect(p.x - 7, p.y - 7 + bob, 14, 14);
      }
    }
  }

  drawBullets(ctx, bullets, ebullets) {
    const sheet = art.sheets.bullets;
    ctx.save();
    ctx.shadowBlur = 12;
    for (const b of bullets ?? []) {
      const a = Math.atan2(b.vy, b.vx);
      ctx.shadowColor = "#ffb84d";
      if (sheet) drawSheet(ctx, sheet, 0, b.x, b.y, a, 16);
      else {
        ctx.fillStyle = "#ffd98a";
        ctx.beginPath();
        ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const b of ebullets ?? []) {
      const a = Math.atan2(b.vy, b.vx);
      ctx.shadowColor = "#a855f7";
      if (sheet) drawSheet(ctx, sheet, 1, b.x, b.y, a, 20);
      else {
        ctx.fillStyle = "#a855f7";
        ctx.beginPath();
        ctx.arc(b.x, b.y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawEnemies(ctx, enemies) {
    for (const e of enemies ?? []) {
      const sheet = art.sheets[ENEMY_SHEET[e.t] || "walker"];
      const size = ENEMY_SIZE[e.t] || 46;
      const frame = Math.floor(this.time * (e.t === "runner" ? 12 : e.t === "boss" ? 5 : 8)) % 4;

      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + size * 0.26, size * 0.34, size * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (sheet) {
        drawSheet(ctx, sheet, frame, e.x, e.y, e.a, size, { flash: e.f === 1 });
      } else {
        ctx.fillStyle = e.f ? "#ffffff" : GIB_COLOR[e.t] || "#5d7f5a";
        ctx.beginPath();
        ctx.arc(e.x, e.y, size * 0.36, 0, Math.PI * 2);
        ctx.fill();
      }

      const showBar = e.t === "boss" || e.hp < e.mh;
      if (showBar) {
        const w = Math.max(26, size * 0.7);
        ctx.fillStyle = "rgba(8,6,10,.8)";
        ctx.fillRect(e.x - w / 2, e.y - size * 0.58, w, 5);
        ctx.fillStyle = e.t === "boss" ? "#c084fc" : "#ef4444";
        ctx.fillRect(e.x - w / 2 + 1, e.y - size * 0.58 + 1, Math.max(0, (w - 2) * (e.hp / e.mh)), 3);
      }
    }
  }

  drawPlayers(ctx, players, localId) {
    for (const p of players ?? []) {
      if (!p.alive) continue;
      const sheet = playerArt(p.slot ?? 0);
      const size = 54;
      const moving = Math.abs(p.vx || 0) + Math.abs(p.vy || 0) > 5;
      const frame = moving ? Math.floor(this.time * 7) % 4 : 0;

      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 14, 17, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const flicker = p.invuln > 0 && Math.floor(this.time * 20) % 2 === 0;
      if (sheet) {
        drawSheet(ctx, sheet, frame, p.x, p.y, p.angle ?? 0, size, { alpha: flicker ? 0.55 : 1 });
      } else {
        ctx.fillStyle = p.id === localId ? "#b8c4d0" : "#8fa3b8";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
        ctx.fill();
      }

      // team ring under the local player
      if (p.id === localId) {
        ctx.strokeStyle = "rgba(192,132,252,.75)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 21, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (p.id !== localId) {
        ctx.font = "700 11px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,.65)";
        const label = p.name || "SURVIVOR";
        const tw = ctx.measureText(label).width;
        ctx.fillRect(p.x - tw / 2 - 5, p.y - 42, tw + 10, 15);
        ctx.fillStyle = "#e9e4f5";
        ctx.fillText(label, p.x, p.y - 31);
        ctx.fillStyle = "rgba(255,255,255,.2)";
        ctx.fillRect(p.x - 18, p.y - 25, 36, 3);
        ctx.fillStyle = "#5ee28b";
        ctx.fillRect(p.x - 18, p.y - 25, 36 * Math.max(0, p.hp / (p.mh || 100)), 3);
      }
    }
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  /** Arrows at the screen edge pointing to teammates outside the view. */
  drawOffscreenArrows(view) {
    if (!view.players || view.players.length < 2) return;
    const { ctx } = this;
    const pad = 46;
    for (const p of view.players) {
      if (p.id === view.localId || !p.alive) continue;
      const s = this.worldToScreen(p.x, p.y);
      if (s.x > pad && s.x < this.w - pad && s.y > pad && s.y < this.h - pad) continue;
      const cx = this.w / 2;
      const cy = this.h / 2;
      const a = Math.atan2(s.y - cy, s.x - cx);
      const rx = Math.min(cx, cy) - pad;
      const ex = cx + Math.cos(a) * rx * (Math.abs(Math.cos(a)) > 0.999 ? 1 : 1.25);
      const ey = cy + Math.sin(a) * rx;
      ctx.save();
      ctx.translate(Math.max(pad, Math.min(this.w - pad, ex)), Math.max(pad, Math.min(this.h - pad, ey)));
      ctx.rotate(a);
      ctx.fillStyle = "rgba(192,132,252,.9)";
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-7, 7);
      ctx.lineTo(-7, -7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}
