// DOM, HUD and audio helpers. Keeps all markup ids in one place.

import { COLORS, WEAPONS } from "./sim.js";

const $ = (id) => document.getElementById(id);

export const el = {
  menu: $("menu"),
  waiting: $("waiting"),
  pause: $("pauseMenu"),
  over: $("gameOver"),
  respawn: $("respawn"),
  loading: $("loading"),
  hud: $("hud"),
  wave: $("waveValue"),
  health: $("healthValue"),
  healthBar: $("healthBar"),
  xp: $("xpValue"),
  xpBar: $("xpBar"),
  score: $("scoreValue"),
  weapon: $("weaponName"),
  ammo: $("ammoValue"),
  center: $("centerMessage"),
  sub: $("subMessage"),
  players: $("playersHud"),
  modeLine: $("modeLine"),
  roomBadge: $("roomBadge"),
  netBadge: $("netBadge"),
  status: $("menuStatus"),
  waitingCode: $("waitingCode"),
  waitingText: $("waitingText"),
  waitingPlayers: $("waitingPlayers"),
  respawnText: $("respawnText"),
  respawnHint: $("respawnHint"),
  overTitle: $("overTitle"),
  overEyebrow: $("overEyebrow"),
  overWinner: $("overWinner"),
  finalScore: $("finalScore"),
  finalWave: $("finalWave"),
  finalKills: $("finalKills"),
  nameInput: $("nameInput"),
  codeInput: $("codeInput"),
  modeCoop: $("modeCoop"),
  modePvp: $("modePvp"),
};

let soundOn = true;
let audioCtx = null;

export function setSound(on) {
  soundOn = on;
  $("soundBtn").textContent = "SOUND: " + (on ? "ON" : "OFF");
}

export function soundEnabled() {
  return soundOn;
}

export function tone(freq = 180, dur = 0.07, type = "square", vol = 0.035, slide = 0) {
  if (!soundOn) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), audioCtx.currentTime + dur);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch {}
}

export function setStatus(text, kind = "") {
  el.status.textContent = text;
  el.status.className = "status-line " + kind;
}

/** screen: menu | waiting | pause | over | respawn | game | none */
export function showScreen(screen) {
  el.menu.classList.toggle("hidden", screen !== "menu");
  el.waiting.classList.toggle("hidden", screen !== "waiting");
  el.pause.classList.toggle("hidden", screen !== "pause");
  el.over.classList.toggle("hidden", screen !== "over");
  el.respawn.classList.toggle("hidden", screen !== "respawn");
  el.hud.classList.toggle("hidden", !(screen === "game" || screen === "pause" || screen === "respawn"));
  if (screen !== "game") {
    el.center.classList.add("hidden");
    el.sub.classList.add("hidden");
  }
}

let centerUntil = 0;
let subUntil = 0;

export function showCenter(text, seconds = 1.4) {
  el.center.textContent = text;
  el.center.classList.remove("hidden");
  centerUntil = performance.now() + seconds * 1000;
}

export function showSub(text, seconds = 2.2) {
  el.sub.textContent = text;
  el.sub.classList.remove("hidden");
  subUntil = performance.now() + seconds * 1000;
}

export function tickMessages() {
  const now = performance.now();
  if (centerUntil && now > centerUntil) {
    el.center.classList.add("hidden");
    centerUntil = 0;
  }
  if (subUntil && now > subUntil) {
    el.sub.classList.add("hidden");
    subUntil = 0;
  }
}

export function hideLoading() {
  el.loading.classList.add("hidden");
}

export function setRoomBadge(code) {
  if (!code) {
    el.roomBadge.classList.add("hidden");
    el.netBadge.classList.add("hidden");
    return;
  }
  el.roomBadge.textContent = "ROOM " + code;
  el.roomBadge.classList.remove("hidden");
  el.netBadge.classList.remove("hidden");
}

export function setPing(ms) {
  if (!ms) return;
  el.netBadge.textContent = Math.round(ms) + " MS";
  el.netBadge.style.color = ms < 90 ? "#5ee28b" : ms < 180 ? "#f6c65b" : "#f87171";
}

let lastPlayersKey = "";
let lastHud = {};

export function updateHud(view, localId, info = {}) {
  const me = view.players.find((p) => p.id === localId);
  if (!me) return;
  const weapon = WEAPONS[me.weapon] || WEAPONS[0];
  const hud = {
    wave: String(view.wave ?? 1),
    health: String(Math.ceil(me.hp)),
    healthW: (100 * me.hp) / (me.mh || 100) + "%",
    xp: me.xp + "/" + me.level * 100,
    xpW: (100 * me.xp) / (me.level * 100) + "%",
    score: String(view.score ?? 0).padStart(6, "0"),
    weapon: weapon.name,
    ammo: me.reloading ? "RELOADING" : me.ammo + " / " + me.reserve,
  };
  if (hud.wave !== lastHud.wave) el.wave.textContent = hud.wave;
  if (hud.health !== lastHud.health) el.health.textContent = hud.health;
  if (hud.healthW !== lastHud.healthW) el.healthBar.style.width = hud.healthW;
  if (hud.xp !== lastHud.xp) el.xp.textContent = hud.xp;
  if (hud.xpW !== lastHud.xpW) el.xpBar.style.width = hud.xpW;
  if (hud.score !== lastHud.score) el.score.textContent = hud.score;
  if (hud.weapon !== lastHud.weapon) el.weapon.textContent = hud.weapon;
  if (hud.ammo !== lastHud.ammo) el.ammo.textContent = hud.ammo;
  lastHud = hud;

  const key = view.players.map((p) => `${p.name}:${Math.round(p.hp)}:${p.kills}:${p.alive}`).join("|");
  if (key !== lastPlayersKey) {
    lastPlayersKey = key;
    const pvp = info.mode === "pvp";
    el.players.innerHTML = "";
    if (view.players.length > 1) {
      for (const p of view.players) {
        const li = document.createElement("li");
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = COLORS[p.slot % COLORS.length];
        const name = document.createElement("span");
        name.className = "pname" + (p.alive ? "" : " dead");
        name.textContent = (p.id === localId ? "YOU · " : "") + p.name;
        const def = document.createElement("span");
        def.className = "pdef";
        def.textContent = pvp ? p.kills + " K" : Math.max(0, Math.round(p.hp)) + " HP";
        li.append(dot, name, def);
        el.players.append(li);
      }
    }
  }
}

export function setModeLine(text) {
  el.modeLine.textContent = text;
}

export function renderLobby(list, mode, code, waiting) {
  el.waitingCode.textContent = code || "----";
  el.waitingText.textContent = waiting ? "Waiting for enough survivors. Share the code!" : "Dropping you in…";
  el.waitingPlayers.innerHTML = "";
  for (const p of list) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = COLORS[(p.slot ?? 0) % COLORS.length];
    const name = document.createElement("span");
    name.textContent = p.name;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = mode === "pvp" ? "DEATHMATCH" : "CO-OP";
    li.append(dot, name, tag);
    el.waitingPlayers.append(li);
  }
}

export function inviteLink(code) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", code);
  return url.toString();
}

export async function copyInvite(code) {
  const link = inviteLink(code);
  try {
    await navigator.clipboard.writeText(link);
    showSub("INVITE LINK COPIED", 1.8);
  } catch {
    showSub("LINK: " + link, 3.5);
  }
}

export function showGameOver({ title, eyebrow, winner, score, wave, kills }) {
  el.overEyebrow.textContent = eyebrow;
  el.overTitle.textContent = title;
  el.overWinner.classList.toggle("hidden", !winner);
  if (winner) el.overWinner.textContent = winner;
  el.finalScore.textContent = String(score).padStart(6, "0");
  el.finalWave.textContent = wave;
  el.finalKills.textContent = kills;
  showScreen("over");
}

export function showRespawn(seconds, hint) {
  el.respawnText.textContent = "RESPAWNING IN " + Math.max(0, Math.ceil(seconds));
  el.respawnHint.textContent = hint;
}
