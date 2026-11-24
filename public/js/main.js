// Client entry: solo simulation, online rooms, input and the render loop.

import { applyInput, createSolo, step, TICK } from "./sim.js";
import { loadArt } from "./sprites.js";
import { Renderer } from "./render.js";
import { NetClient } from "./net.js";
import * as UI from "./ui.js";

const canvas = document.getElementById("game");
const renderer = new Renderer(canvas);

const state = {
  mode: "menu", // menu | solo | online
  netMode: "coop",
  solo: null,
  soloAcc: 0,
  soloOver: false,
  paused: false,
  net: null,
  localId: 1,
  roomCode: "",
  waiting: false,
  input: { mx: 0, my: 0, aim: 0, fire: false },
  edges: { reload: false, dash: false, weapon: -1 },
  keys: {},
  mouse: { x: 0, y: 0, seen: false, down: false },
  touch: { active: false, mx: 0, my: 0, fire: false },
  holdFireUntil: 0, // a quick click or tap still fires at least one shot
  lastShotAt: 0,
  lastKillSound: 0,
  matchOver: false,
  respawnShowing: false,
};

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------ audio */

function soundForEvent(ev, now) {
  switch (ev.t) {
    case "shot":
      if (now - state.lastShotAt > 55) {
        state.lastShotAt = now;
        UI.tone(ev.w === 1 ? 105 : ev.w === 2 ? 230 : 160, 0.05, ev.w === 1 ? "sawtooth" : "square", 0.022, -50);
      }
      break;
    case "hit":
      UI.tone(95, 0.12, "sawtooth", 0.04, -40);
      break;
    case "death":
      UI.tone(90, 0.4, "sawtooth", 0.05, -50);
      break;
    case "kill":
      if (now - state.lastKillSound > 45) {
        state.lastKillSound = now;
        UI.tone(220, 0.07, "triangle", 0.02, 120);
      }
      break;
    case "pickup":
      UI.tone(650, 0.12, "sine", 0.03, 220);
      break;
    case "reload":
      UI.tone(330, 0.05, "triangle", 0.014, -80);
      break;
    case "reloaded":
      UI.tone(510, 0.06, "triangle", 0.018, 100);
      break;
    case "level":
      UI.tone(520, 0.25, "triangle", 0.04, 400);
      break;
    case "dash":
      UI.tone(180, 0.11, "sawtooth", 0.026, 400);
      break;
    default:
      break;
  }
}

function handleEvents(events) {
  const now = performance.now();
  for (const ev of events) {
    renderer.addEvent(ev);
    soundForEvent(ev, now);
    if (ev.t === "wave") {
      if (ev.boss) {
        UI.showCenter("BOSS INCOMING", 2);
        UI.tone(65, 0.6, "sawtooth", 0.06, -25);
      } else {
        UI.showCenter("WAVE " + ev.n, 1.3);
        UI.tone(420, 0.16, "triangle", 0.03, 180);
      }
    }
    if (ev.t === "level" && ev.id === state.localId) UI.showSub("LEVEL UP · +25 HEALTH", 1.6);
  }
}

/* ------------------------------------------------------------------ input */

function pollInput() {
  const k = state.keys;
  let mx = (k.d || k.ArrowRight ? 1 : 0) - (k.a || k.ArrowLeft ? 1 : 0);
  let my = (k.s || k.ArrowDown ? 1 : 0) - (k.w || k.ArrowUp ? 1 : 0);
  mx += state.touch.mx;
  my += state.touch.my;
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  state.input.mx = mx;
  state.input.my = my;
  state.input.fire = state.mouse.down || state.touch.fire || performance.now() < state.holdFireUntil;
}

function aimAt(view) {
  const me = view.players.find((p) => p.id === state.localId);
  if (!me || !me.alive) return state.input.aim;
  if (state.mouse.seen && !state.touch.active) {
    const wx = (state.mouse.x - renderer.w / 2) / renderer.zoom + renderer.camX;
    const wy = (state.mouse.y - renderer.h / 2) / renderer.zoom + renderer.camY;
    return Math.atan2(wy - me.y, wx - me.x);
  }
  // Touch: aim at the nearest target (enemies in co-op, rivals in PvP).
  const targets = view.mode === "pvp" ? view.players.filter((p) => p.id !== me.id && p.alive) : view.enemies;
  let best = null;
  let bd = Infinity;
  for (const t of targets) {
    const d = Math.hypot(t.x - me.x, t.y - me.y);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  if (best) return Math.atan2(best.y - me.y, best.x - me.x);
  return state.input.aim;
}

function takeEdges() {
  const e = { ...state.edges };
  state.edges.reload = false;
  state.edges.dash = false;
  state.edges.weapon = -1;
  return e;
}

/* ------------------------------------------------------------------ frames */

let lastFrame = performance.now();

function frame(t) {
  const dt = Math.min(0.05, Math.max(0, (t - lastFrame) / 1000));
  lastFrame = t;
  pollInput();
  UI.tickMessages();

  if (state.mode === "solo" && !state.paused) stepSolo(dt);

  let view;
  if (state.mode === "online" && state.net) {
    state.net.tick(dt);
    if (state.net.rtt) UI.setPing(state.net.rtt);
    view = state.net.view();
    driveOnline(view);
  } else if (state.mode === "solo") {
    view = soloView();
    driveSolo(view);
  } else {
    view = soloIdleView();
  }

  renderer.update(dt);
  renderer.draw(view);

  if (state.mode !== "menu") UI.updateHud(view, state.localId, { mode: state.netMode });
  requestAnimationFrame(frame);
}

function driveSolo(view) {
  if (state.paused || state.soloOver) return;
  const world = state.solo;
  const me = world.players[0];
  const edges = takeEdges();
  const aim = aimAt(view);
  state.input.aim = aim;
  applyInput(world, me.id, {
    mx: state.input.mx,
    my: state.input.my,
    aim,
    fire: state.input.fire,
    reload: edges.reload,
    dash: edges.dash,
    weapon: edges.weapon,
  });
  me.angle = aim;
  if (state.input.fire) localMuzzle(me, performance.now());
}

function driveOnline(view) {
  if (!state.net || state.matchOver) return;
  const me = view.players.find((p) => p.id === state.localId);
  if (!me) return;
  if (!me.alive && !state.matchOver) {
    if (!state.respawnShowing) {
      state.respawnShowing = true;
      UI.showScreen("respawn");
    }
    UI.showRespawn(me.respawn, state.netMode === "pvp" ? "Back in the fight shortly." : "Your team fights on.");
  } else if (state.respawnShowing) {
    state.respawnShowing = false;
    UI.showScreen("game");
  }
  if (state.paused) return;
  const edges = takeEdges();
  const aim = aimAt(view);
  state.input.aim = aim;
  state.net.sendInput(
    {
      mx: state.input.mx,
      my: state.input.my,
      aim,
      fire: state.input.fire,
      reload: edges.reload,
      dash: edges.dash,
      weapon: edges.weapon,
    },
    edges.reload || edges.dash || edges.weapon >= 0
  );
  if (state.input.fire) localMuzzle(me, performance.now());
}

let lastMuzzle = 0;

function localMuzzle(me, now) {
  if (now - lastMuzzle < 70) return;
  lastMuzzle = now;
  renderer.addEvent({ t: "shot", x: me.x + Math.cos(me.angle) * 24, y: me.y + Math.sin(me.angle) * 24 });
}

function stepSolo(dt) {
  const world = state.solo;
  state.soloAcc += dt;
  let guard = 0;
  while (state.soloAcc >= TICK && guard++ < 5) {
    state.soloAcc -= TICK;
    step(world, TICK);
    if (world.events.length) handleEvents(world.events.splice(0));
    const me = world.players[0];
    if (!me.alive) {
      state.soloOver = true;
      UI.showGameOver({
        title: "YOU'RE DEAD.",
        eyebrow: "THE HORDE WON THIS ROUND",
        score: world.score,
        wave: world.wave,
        kills: world.kills,
      });
      UI.tone(90, 0.5, "sawtooth", 0.06, -55);
      return;
    }
  }
}

/* ------------------------------------------------------------- view models */

function soloView() {
  const w = state.solo;
  state.localId = w.players[0]?.id ?? 1;
  return {
    players: w.players.map((p) => ({
      id: p.id,
      name: p.name,
      slot: p.slot,
      x: p.x,
      y: p.y,
      vx: p.input.mx * p.speed,
      vy: p.input.my * p.speed,
      angle: p.angle,
      hp: p.hp,
      mh: p.maxHp,
      alive: p.alive,
      invuln: p.invuln,
      weapon: p.weapon,
      ammo: p.ammo[p.weapon],
      reserve: p.reserve[p.weapon],
      reloading: p.reload > 0,
      level: p.level,
      xp: p.xp,
      kills: p.kills,
      deaths: p.deaths,
      respawn: p.respawn,
    })),
    enemies: w.enemies.map((e) => ({ id: e.id, t: e.type, x: e.x, y: e.y, a: e.angle, hp: e.hp, mh: e.maxHp, f: e.flash > 0 ? 1 : 0 })),
    bullets: w.bullets,
    ebullets: w.enemyBullets,
    pickups: w.pickups.map((p) => ({ x: p.x, y: p.y, t: p.type })),
    arena: { w: w.w, h: w.h },
    time: w.time,
    localId: state.localId,
    mode: w.mode,
    wave: w.wave,
    score: w.score,
    kills: w.kills,
    winner: w.winner,
  };
}

function soloIdleView() {
  return { players: [], enemies: [], bullets: [], ebullets: [], pickups: [], arena: { w: 1600, h: 1000 }, time: performance.now() / 1000, localId: 0, mode: "coop", wave: 1, score: 0, kills: 0 };
}

/* --------------------------------------------------------------- game flow */

function playerName() {
  const raw = (UI.el.nameInput.value || "").trim().toUpperCase().replace(/[^A-Z0-9 _-]/g, "").slice(0, 12);
  return raw || "SURVIVOR";
}

function resetRoomUi() {
  state.matchOver = false;
  state.waiting = false;
  state.respawnShowing = false;
  UI.el.overWinner.classList.add("hidden");
  $("pauseLeaveBtn").classList.add("hidden");
  $("overLeaveBtn").classList.add("hidden");
  $("restartBtn").classList.remove("hidden");
}

function startSolo() {
  leaveRoom(true);
  state.mode = "solo";
  state.netMode = "coop";
  state.solo = createSolo(playerName(), "coop");
  state.soloAcc = 0;
  state.soloOver = false;
  state.paused = false;
  state.localId = 1;
  resetRoomUi();
  UI.setRoomBadge(null);
  UI.setModeLine("SOLO · [1] PISTOL [2] SHOTGUN [3] AUTO");
  UI.showScreen("game");
  UI.showCenter("WAVE 1", 1.2);
  UI.tone(420, 0.14, "triangle", 0.03, 160);
}

function restartSolo() {
  startSolo();
}

async function createRoom() {
  const name = playerName();
  const mode = state.netMode;
  UI.setStatus("Creating room…");
  try {
    const res = await fetch("api/room", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, name }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data.code) throw new Error("No room code");
    await joinRoom(data.code, false);
  } catch (err) {
    UI.setStatus("Could not create a room: " + err.message, "error");
  }
}

async function joinRoom(codeInput, showStatus = true) {
  const code = String(codeInput || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  if (code.length !== 4) {
    UI.setStatus("Room codes are 4 characters.", "error");
    return;
  }
  const name = playerName();
  if (showStatus) UI.setStatus("Connecting to " + code + "…");
  leaveRoom(true);
  state.mode = "online";
  state.localId = 0;
  state.roomCode = code;
  state.netMode = UI.el.modePvp.classList.contains("active") ? "pvp" : "coop";
  const net = new NetClient({
    onWelcome: (msg) => {
      state.localId = msg.you;
      state.netMode = msg.mode;
      state.roomCode = msg.code;
      state.mode = "online";
      UI.setRoomBadge(msg.code);
      UI.setModeLine((msg.mode === "pvp" ? "PVP DEATHMATCH · FIRST TO 15" : "CO-OP SURVIVAL") + " · [1] [2] [3] WEAPONS");
      UI.renderLobby(net.roster, msg.mode, msg.code, false);
      UI.showScreen("game");
      UI.showSub("ROOM " + msg.code + " · SHARE THE CODE", 3);
    },
    onRoster: (list, mode) => {
      if (state.net !== net) return;
      UI.renderLobby(list, mode, state.roomCode, list.length < 2);
      if (mode === "pvp") {
        if (list.length < 2) {
          state.waiting = true;
          UI.showScreen("waiting");
          UI.showSub("FIGHT STARTS AT 2 PLAYERS", 2);
        } else if (state.waiting) {
          state.waiting = false;
          UI.showScreen("game");
          UI.showCenter("FIGHT", 1.2);
          UI.tone(480, 0.2, "square", 0.04, 200);
        }
      }
    },
    onEvents: handleEvents,
    onWaiting: (count) => {
      state.waiting = true;
      UI.renderLobby(net.roster, "pvp", state.roomCode, true);
      if (count < 2) UI.showScreen("waiting");
    },
    onOver: (msg) => {
      state.matchOver = true;
      const view = net.view();
      const winner = msg.winner === state.localId ? "YOU WIN" : (msg.name || "RIVAL") + " WINS";
      UI.showGameOver({
        title: msg.winner === state.localId ? "VICTORY." : "MATCH OVER.",
        eyebrow: msg.mode === "pvp" ? "DEATHMATCH COMPLETE" : "ROUND COMPLETE",
        winner,
        score: view.score,
        wave: view.wave,
        kills: view.kills,
      });
      $("againBtn").textContent = "PLAY AGAIN";
      $("overLeaveBtn").classList.remove("hidden");
      $("restartBtn").classList.add("hidden");
      UI.tone(msg.winner === state.localId ? 620 : 120, 0.4, "triangle", 0.05, 220);
    },
    onRestart: () => {
      state.matchOver = false;
      $("againBtn").textContent = "TRY AGAIN";
      UI.showScreen("game");
      UI.showCenter("REMATCH", 1.2);
    },
    onClose: () => {
      if (state.net !== net || state.mode !== "online") return;
      state.mode = "menu";
      state.net = null;
      state.waiting = false;
      UI.setRoomBadge(null);
      UI.showScreen("menu");
      UI.setStatus("Disconnected from the room.", "error");
    },
    onError: (msg) => {
      UI.setStatus(msg.message || "Room error.", "error");
    },
  });
  state.net = net;
  UI.renderLobby([{ name: playerName(), slot: 0 }], state.netMode, code, true);
  try {
    await net.connect(code, name, state.netMode);
    if (state.netMode === "coop") {
      UI.showScreen("game");
      UI.showCenter("SURVIVE", 1.1);
    }
  } catch (err) {
    state.mode = "menu";
    state.net = null;
    UI.showScreen("menu");
    UI.setStatus(err.message + " You can still play solo.", "error");
  }
}

function leaveRoom(silent = false) {
  if (state.net) {
    state.net.close();
    state.net = null;
  }
  if (!silent) {
    state.mode = "menu";
    state.localId = 1;
    state.matchOver = false;
    state.waiting = false;
    UI.setRoomBadge(null);
    UI.showScreen("menu");
    UI.setStatus("Left the room.");
  }
}

function pause() {
  if (state.mode === "menu" || state.paused) return;
  if (state.mode === "solo" && state.soloOver) return;
  state.paused = true;
  $("pauseLeaveBtn").classList.toggle("hidden", state.mode !== "online");
  UI.showScreen("pause");
}

function resume() {
  if (!state.paused) return;
  state.paused = false;
  UI.showScreen("game");
  lastFrame = performance.now();
}

function leaveToMenu() {
  state.paused = false;
  leaveRoom(false);
}

function again() {
  if (state.mode === "solo") {
    restartSolo();
    return;
  }
  if (!state.net) {
    leaveToMenu();
    return;
  }
  if (state.matchOver) {
    state.net.ws?.send(JSON.stringify({ t: "restart" }));
    UI.showSub("REMATCH REQUESTED", 2);
    if (state.netMode === "coop") {
      state.matchOver = false;
      UI.showScreen("game");
    }
  }
}

/* ------------------------------------------------------------------ wiring */

// Read-only handle for test/e2e.mjs and for debugging in devtools.
window.DEADBALLS = { state, renderer };

UI.setSound(true);
UI.el.nameInput.value = localStorage.getItem("db2-name") || "";
UI.el.modeCoop.addEventListener("click", () => setMode("coop"));
UI.el.modePvp.addEventListener("click", () => setMode("pvp"));

function setMode(mode) {
  state.netMode = mode;
  UI.el.modeCoop.classList.toggle("active", mode === "coop");
  UI.el.modePvp.classList.toggle("active", mode === "pvp");
  UI.setStatus(mode === "pvp" ? "Deathmatch: first to 15 kills. Needs 2+ players." : "Co-op: up to 4 survivors share one horde.");
}

$("startBtn").addEventListener("click", () => startSolo());
$("createBtn").addEventListener("click", () => createRoom());
$("joinBtn").addEventListener("click", () => joinRoom(UI.el.codeInput.value));
UI.el.codeInput.addEventListener("input", () => {
  UI.el.codeInput.value = UI.el.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
});
UI.el.codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom(UI.el.codeInput.value);
});
UI.el.nameInput.addEventListener("change", () => {
  localStorage.setItem("db2-name", playerName());
  UI.el.nameInput.value = playerName();
});

$("resumeBtn").addEventListener("click", resume);
$("restartBtn").addEventListener("click", () => {
  if (state.mode === "solo") restartSolo();
  else if (state.net) {
    state.net.ws?.send(JSON.stringify({ t: "restart" }));
    UI.showSub("RESTART REQUESTED", 2);
  }
});
$("pauseLeaveBtn").addEventListener("click", leaveToMenu);
$("againBtn").addEventListener("click", again);
$("overLeaveBtn").addEventListener("click", leaveToMenu);
$("waitingLeaveBtn").addEventListener("click", leaveToMenu);
$("copyLinkBtn").addEventListener("click", () => state.roomCode && UI.copyInvite(state.roomCode));
UI.el.roomBadge.addEventListener("click", () => state.roomCode && UI.copyInvite(state.roomCode));
$("pauseBtn").addEventListener("click", () => (state.paused ? resume() : pause()));
$("soundBtn").addEventListener("click", () => {
  UI.setSound(!UI.soundEnabled());
  if (UI.soundEnabled()) UI.tone(500, 0.07, "sine");
});
$("fullscreenBtn").addEventListener("click", () => {
  const shell = $("game-shell");
  if (!document.fullscreenElement) shell.requestFullscreen?.();
  else document.exitFullscreen?.();
});

/* keyboard */
addEventListener("keydown", (e) => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
  state.keys[key] = true;
  if (state.mode === "menu") return;
  if (key === "r") state.edges.reload = true;
  if (key === "1") state.edges.weapon = 0;
  if (key === "2") state.edges.weapon = 1;
  if (key === "3") state.edges.weapon = 2;
  if (key === " " && !e.repeat) state.edges.dash = true;
  if (key === "Escape" || key === "p") {
    if (state.paused) resume();
    else pause();
  }
});
addEventListener("keyup", (e) => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  state.keys[key] = false;
});
addEventListener("blur", () => {
  state.keys = {};
  state.mouse.down = false;
});

/* mouse */
function setMouse(e) {
  const r = canvas.getBoundingClientRect();
  state.mouse.x = e.clientX - r.left;
  state.mouse.y = e.clientY - r.top;
  state.mouse.seen = true;
}
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse") setMouse(e);
});
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "mouse") return;
  setMouse(e);
  state.mouse.down = true;
  state.holdFireUntil = performance.now() + 140;
  if (state.mode === "menu") return;
});
addEventListener("pointerup", (e) => {
  if (e.pointerType === "mouse") state.mouse.down = false;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

/* touch pad */
const pad = $("movePad");
function padMove(e) {
  const r = pad.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let dx = e.clientX - cx;
  let dy = e.clientY - cy;
  const max = r.width * 0.36;
  const len = Math.hypot(dx, dy);
  if (len > max) {
    dx *= max / len;
    dy *= max / len;
  }
  state.touch.mx = dx / max;
  state.touch.my = dy / max;
  const dot = pad.querySelector(".pad-center");
  dot.style.transform = `translate(${dx}px,${dy}px)`;
}
pad.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  state.touch.active = true;
  pad.setPointerCapture(e.pointerId);
  padMove(e);
});
pad.addEventListener("pointermove", (e) => {
  if (state.touch.active) padMove(e);
});
for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) {
  pad.addEventListener(ev, () => {
    state.touch.active = false;
    state.touch.mx = 0;
    state.touch.my = 0;
    pad.querySelector(".pad-center").style.transform = "";
  });
}
$("fireBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  state.touch.fire = true;
  state.holdFireUntil = performance.now() + 140;
});
for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
  $("fireBtn").addEventListener(ev, (e) => {
    e.preventDefault();
    state.touch.fire = false;
  });
}
$("dashBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  state.edges.dash = true;
});
$("reloadBtn").addEventListener("click", () => {
  state.edges.reload = true;
});
document.querySelectorAll("[data-weapon]").forEach((b) => {
  // pointerdown, not click: a tap must not wait for a synthetic click that the
  // canvas handlers can cancel.
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    state.edges.weapon = Number(b.dataset.weapon);
  });
});

/* ------------------------------------------------------------------- boot */

const params = new URLSearchParams(location.search);
const inviteCode = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
if (inviteCode) {
  UI.el.codeInput.value = inviteCode;
  UI.setStatus("Invite code " + inviteCode + " loaded. Press JOIN.");
}

loadArt().then(() => {
  UI.hideLoading();
  lastFrame = performance.now();
  requestAnimationFrame(frame);
  if (location.hash === "#coop" || location.hash === "#pvp") setMode(location.hash.slice(1));
});
