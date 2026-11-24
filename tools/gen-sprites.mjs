import { mkdirSync, writeFileSync } from "node:fs";
import { Pix } from "./png.mjs";

const OUT = new URL("../public/assets/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const SCALE = 2;
const OUTLINE = "#141a20";
const FRAMES = 4;

const frame = (w, h, draw) => {
  const p = new Pix(w, h);
  draw(p);
  return p;
};

// ---------- survivors ----------
const SKINS = [
  { armor: "#b9c8d8", dark: "#5d7286", trim: "#a855f7", pack: "#2f3c4a" },
  { armor: "#d8c2a2", dark: "#8a6f52", trim: "#38bdf8", pack: "#43382b" },
  { armor: "#c8b8d8", dark: "#6a5b7d", trim: "#f6b64b", pack: "#3a3147" },
  { armor: "#a8d0bf", dark: "#4f7566", trim: "#f472b6", pack: "#2b3d37" },
];

function survivor(p, f, s) {
  const bob = f === 1 || f === 3 ? -1 : 0;
  const legSwing = f === 1 ? 1 : f === 3 ? -1 : 0;
  const cx = 12;
  const cy = 12 + bob;

  // backpack behind the shoulders
  p.rect(4, 8 + bob, 5, 9, OUTLINE);
  p.rect(5, 9 + bob, 4, 7, s.pack);
  p.rect(6, 10 + bob, 2, 2, s.dark);

  // boots / legs poking out under the torso
  p.rect(cx - 4 + legSwing, 17 + bob, 3, 4, OUTLINE);
  p.rect(cx - 3 + legSwing, 17 + bob, 2, 3, s.dark);
  p.rect(cx + 1 - legSwing, 17 + bob, 3, 4, OUTLINE);
  p.rect(cx + 2 - legSwing, 17 + bob, 2, 3, s.dark);

  // torso outline then plates
  p.disc(cx, cy, 9.2, OUTLINE);
  p.ellipse(cx, cy, 8.4, 7.4, s.dark);
  p.ellipse(cx + 1, cy - 1, 7.2, 6.2, s.armor);
  p.ellipse(cx + 1, cy - 2, 5.4, 3.4, "#ffffff", 0.16);

  // shoulder pads
  p.disc(cx - 2, cy - 6, 3, OUTLINE);
  p.disc(cx - 2, cy - 6, 2, s.armor);
  p.disc(cx - 2, cy + 6, 3, OUTLINE);
  p.disc(cx - 2, cy + 6, 2, s.dark);

  // team trim stripe
  p.rect(cx - 5, cy + 2, 4, 2, s.trim);

  // helmet + visor
  p.disc(cx + 3, cy, 6, OUTLINE);
  p.disc(cx + 3, cy, 5, s.armor);
  p.disc(cx + 4, cy - 1, 3.4, "#e8eef5");
  p.ellipse(cx + 6, cy, 2.6, 3.2, "#4c1d95");
  p.rect(cx + 6, cy - 1, 2, 1, s.trim);

  // rifle held forward
  p.rect(cx + 5, cy + 4, 3, 3, OUTLINE);
  p.rect(cx + 5, cy + 4, 2, 2, s.dark);
  p.rect(cx + 7, cy + 5, 9, 3, OUTLINE);
  p.rect(cx + 8, cy + 6, 8, 1, "#41505f");
  p.rect(cx + 8, cy + 7, 5, 1, "#1f2833");
  if (f === 1 || f === 3) p.rect(cx + 14, cy + 5, 2, 1, "#7b8a99");
}

function survivorSheet(s) {
  const sheet = new Pix(24 * FRAMES, 24);
  for (let f = 0; f < FRAMES; f++) {
    const p = frame(24, 24, (q) => survivor(q, f, s));
    sheet.blit(p, f * 24, 0);
  }
  return sheet;
}

// ---------- the dead ----------
function zombieBase(p, f, opts) {
  const { cx, cy, r, body, dark, light, eye, type } = opts;
  const sway = f === 1 ? 1 : f === 3 ? -1 : 0;

  // grasping arms
  if (type !== "brute") {
    p.rect(cx + 2, cy - r - 1 + sway, 8, 3, OUTLINE);
    p.rect(cx + 3, cy - r + sway, 6, 1, dark);
    p.rect(cx + 2, cy + r - 2 - sway, 8, 3, OUTLINE);
    p.rect(cx + 3, cy + r - 1 - sway, 6, 1, dark);
    p.disc(cx + 10, cy - r + sway + 1, 1.6, dark);
    p.disc(cx + 10, cy + r - 1 - sway + 1, 1.6, dark);
  }

  p.disc(cx, cy, r + 1.2, OUTLINE);
  p.disc(cx, cy, r, body);
  p.disc(cx - 1, cy - 1, r * 0.72, light, 0.55);

  // rotten patches
  p.disc(cx - r * 0.4, cy + r * 0.35, r * 0.28, dark, 0.8);
  p.disc(cx + r * 0.15, cy - r * 0.5, r * 0.18, dark, 0.7);
  p.disc(cx + r * 0.5, cy + r * 0.1, r * 0.12, "#ffffff", 0.12);

  // eyes + jaw, facing right
  p.disc(cx + r * 0.55, cy - r * 0.38, 1.5, eye);
  p.disc(cx + r * 0.55, cy + r * 0.3, 1.5, eye);
  p.rect(cx + r * 0.2, cy + r * 0.62, r * 0.9, 2, "#241417");
  p.rect(cx + r * 0.25, cy + r * 0.62, 1, 1, "#d8cbb6");
  p.rect(cx + r * 0.6, cy + r * 0.62, 1, 1, "#d8cbb6");
}

function walker(f) {
  return frame(24, 24, (p) =>
    zombieBase(p, f, { cx: 12, cy: 12, r: 7.6, body: "#567b52", dark: "#33513a", light: "#8fae78", eye: "#ff5b52", type: "walker" })
  );
}

function runner(f) {
  const stretch = f % 2 === 0 ? 3 : 1;
  return frame(20, 20, (p) => {
    zombieBase(p, f, { cx: 10, cy: 10, r: 5.8, body: "#a89a58", dark: "#6d6334", light: "#d6c583", eye: "#ffe66b", type: "runner" });
    p.rect(4, 3 + stretch, 3, 2, "#6d6334");
    p.rect(4, 15 - stretch, 3, 2, "#6d6334");
  });
}

function brute(f) {
  return frame(34, 34, (p) => {
    zombieBase(p, f, { cx: 17, cy: 17, r: 12.4, body: "#8d5638", dark: "#5a3322", light: "#c08258", eye: "#ffb347", type: "brute" });
    // bone spikes across the shoulders
    for (const [sx, sy] of [[5, 8], [5, 17], [5, 26], [12, 4], [22, 4]]) {
      p.disc(sx, sy, 2.4, OUTLINE);
      p.disc(sx, sy, 1.5, "#e8dcc6");
    }
    // heavy fists
    p.disc(8, 6 + (f === 1 ? 1 : 0), 3.4, OUTLINE);
    p.disc(8, 6 + (f === 1 ? 1 : 0), 2.6, "#6b4029");
    p.disc(8, 28 - (f === 3 ? 1 : 0), 3.4, OUTLINE);
    p.disc(8, 28 - (f === 3 ? 1 : 0), 2.6, "#6b4029");
  });
}

function spitter(f) {
  const pulse = f === 0 ? 0 : f === 1 ? 1 : f === 2 ? 2 : 1;
  return frame(24, 24, (p) => {
    zombieBase(p, f, { cx: 12, cy: 12, r: 7, body: "#5f8f4a", dark: "#3a5c30", light: "#93c46e", eye: "#c8ff5b", type: "spitter" });
    // bile sacs
    p.disc(9, 8, 2.6 + pulse * 0.3, "#7c3aed");
    p.disc(15, 16, 2.2 + pulse * 0.3, "#8b5cf6");
    p.disc(9, 8, 1.2, "#d8c4ff", 0.7);
    p.disc(15, 16, 0.9, "#d8c4ff", 0.6);
  });
}

function boss(f) {
  const swell = f % 2 === 0 ? 0 : 1;
  return frame(64, 64, (p) => {
    const cx = 32;
    const cy = 32;
    // back spikes
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      p.disc(cx + Math.cos(a) * 24, cy + Math.sin(a) * 24, 4, OUTLINE);
      p.disc(cx + Math.cos(a) * 24, cy + Math.sin(a) * 24, 2.6, "#3f1d63");
    }
    p.disc(cx, cy, 23, OUTLINE);
    p.disc(cx, cy, 21, "#7137a8");
    p.disc(cx - 2, cy - 3, 17, "#8b4fc4", 0.5);
    // ribs / plating
    for (let i = -2; i <= 2; i++) {
      p.rect(cx - 14, cy + i * 5 - 1, 18, 2, "#4c1d76", 0.7);
    }
    // glowing core
    p.disc(cx + 4, cy + 1, 8 + swell, "#c084fc", 0.35);
    p.disc(cx + 4, cy + 1, 5 + swell, "#e9d5ff", 0.9);
    p.disc(cx + 4, cy + 1, 2.6, "#ffffff");
    // horns
    p.rect(cx + 12, cy - 18, 3, 9, OUTLINE);
    p.rect(cx + 13, cy - 17, 2, 7, "#e8dcc6");
    p.rect(cx + 12, cy + 10, 3, 9, OUTLINE);
    p.rect(cx + 13, cy + 11, 2, 7, "#e8dcc6");
    // eyes
    p.disc(cx + 12, cy - 7, 2.4, "#ff4d4d");
    p.disc(cx + 12, cy + 8, 2.4, "#ff4d4d");
  });
}

// ---------- props & effects ----------
function pickups() {
  const sheet = new Pix(16 * 2, 16);
  const health = frame(16, 16, (p) => {
    p.rect(1, 1, 14, 14, OUTLINE);
    p.rect(2, 2, 12, 12, "#2f9c5a");
    p.rect(3, 3, 10, 3, "#5ee28b");
    p.rect(6, 5, 4, 10, "#eafff1");
    p.rect(5, 7, 6, 6, "#eafff1");
    p.rect(6, 8, 4, 4, "#f6c65b");
  });
  const ammo = frame(16, 16, (p) => {
    p.rect(1, 1, 14, 14, OUTLINE);
    p.rect(2, 2, 12, 12, "#b7892b");
    p.rect(3, 3, 10, 3, "#f6c65b");
    for (let i = 0; i < 3; i++) {
      p.rect(4 + i * 3, 7, 2, 6, "#2b2b2b");
      p.rect(4 + i * 3, 7, 2, 2, "#d9a520");
    }
  });
  sheet.blit(health, 0, 0);
  sheet.blit(ammo, 16, 0);
  return { sheet, frames: 2 };
}

function fx() {
  const w = 16;
  const sheet = new Pix(w * 4, w);
  sheet.blit(
    frame(w, w, (p) => {
      p.disc(8, 8, 6, "#ffb84d", 0.45);
      p.disc(8, 8, 4, "#ffd27a");
      p.disc(8, 8, 2, "#fffbe8");
    }),
    0,
    0
  );
  sheet.blit(
    frame(w, w, (p) => {
      p.disc(8, 8, 5, "#8f1d24", 0.8);
      p.disc(6, 7, 2.4, "#e54b58");
      p.disc(10, 10, 1.8, "#b3202b");
      p.disc(9, 5, 1.2, "#ff8a8a");
    }),
    w,
    0
  );
  sheet.blit(
    frame(w, w, (p) => {
      p.disc(8, 8, 4, "#3f6b3d", 0.9);
      p.disc(7, 7, 2.4, "#70a86c");
      p.rect(9, 9, 3, 3, "#2c4d2c");
    }),
    2 * w,
    0
  );
  sheet.blit(
    frame(w, w, (p) => {
      p.disc(8, 8, 5, "#a855f7", 0.35);
      p.disc(8, 8, 3, "#c084fc");
      p.disc(8, 8, 1.2, "#f3e8ff");
    }),
    3 * w,
    0
  );
  return { sheet, frames: 4 };
}

function projectile() {
  const sheet = new Pix(10 * 2, 10);
  sheet.blit(
    frame(10, 10, (p) => {
      p.disc(5, 5, 4.4, "#ffb84d", 0.28);
      p.disc(5, 5, 2.6, "#ffd98a");
      p.disc(5, 5, 1.2, "#fffef2");
    }),
    0,
    0
  );
  sheet.blit(
    frame(10, 10, (p) => {
      p.disc(5, 5, 4.6, "#a855f7", 0.3);
      p.disc(5, 5, 2.8, "#c084fc");
      p.disc(5, 5, 1.2, "#ffffff");
    }),
    10,
    0
  );
  return { sheet, frames: 2 };
}

function tiles() {
  const size = 64;
  const sheet = new Pix(size * 2, size);
  for (let v = 0; v < 2; v++) {
    const p = new Pix(size, size);
    p.rect(0, 0, size, size, "#0f1720");
    for (let ty = 0; ty < 4; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        const n = (tx * 13 + ty * 7 + v * 5) % 4;
        const base = ["#111b24", "#0e161f", "#121d26", "#101a23"][n];
        p.rect(tx * 16 + 1, ty * 16 + 1, 14, 14, base);
        if (n === 0) p.rect(tx * 16 + 1, ty * 16 + 1, 14, 1, "#18232e");
        if (n === 2) p.rect(tx * 16 + 1, ty * 16 + 14, 14, 1, "#0b1219");
      }
    }
    // cracks and stains
    p.rect(10, 22 + v * 3, 1, 9, "#0a1017");
    p.rect(11, 30 + v * 3, 4, 1, "#0a1017");
    p.disc(45, 45 - v * 6, 5, "#0b1319", 0.75);
    p.disc(48, 43 - v * 6, 2, "#0d161d", 0.9);
    p.disc(20, 12 + v * 4, 1, "#26323d", 0.7);
    sheet.blit(p, v * size, 0);
  }
  return { sheet, frames: 2 };
}

function write(name, sheet, frameW, frames, extra = {}) {
  writeFileSync(new URL(name + ".png", OUT), sheet.scaled(SCALE).png());
  return { file: "assets/" + name + ".png", frameW: frameW * SCALE, frameH: sheet.h * SCALE, frames, scale: SCALE, ...extra };
}

const manifest = { generated: "tools/gen-sprites.mjs", players: [], sheets: {} };

for (let i = 0; i < SKINS.length; i++) {
  manifest.players.push(write("survivor-" + (i + 1), survivorSheet(SKINS[i]), 24, FRAMES));
}

manifest.sheets.walker = write("walker", (() => {
  const s = new Pix(24 * FRAMES, 24);
  for (let f = 0; f < FRAMES; f++) s.blit(walker(f), f * 24, 0);
  return s;
})(), 24, FRAMES);

manifest.sheets.runner = write("runner", (() => {
  const s = new Pix(20 * FRAMES, 20);
  for (let f = 0; f < FRAMES; f++) s.blit(runner(f), f * 20, 0);
  return s;
})(), 20, FRAMES);

manifest.sheets.brute = write("brute", (() => {
  const s = new Pix(34 * FRAMES, 34);
  for (let f = 0; f < FRAMES; f++) s.blit(brute(f), f * 34, 0);
  return s;
})(), 34, FRAMES);

manifest.sheets.spitter = write("spitter", (() => {
  const s = new Pix(24 * FRAMES, 24);
  for (let f = 0; f < FRAMES; f++) s.blit(spitter(f), f * 24, 0);
  return s;
})(), 24, FRAMES);

manifest.sheets.boss = write("boss", (() => {
  const s = new Pix(64 * FRAMES, 64);
  for (let f = 0; f < FRAMES; f++) s.blit(boss(f), f * 64, 0);
  return s;
})(), 64, FRAMES);

const pick = pickups();
manifest.sheets.pickups = write("pickups", pick.sheet, 16, pick.frames);
const eff = fx();
manifest.sheets.fx = write("fx", eff.sheet, 16, eff.frames);
const proj = projectile();
manifest.sheets.bullets = write("bullets", proj.sheet, 10, proj.frames);
const tile = tiles();
manifest.sheets.tiles = write("tiles", tile.sheet, 64, tile.frames);

writeFileSync(new URL("sprites.json", OUT), JSON.stringify(manifest, null, 2) + "\n");
console.log("wrote", Object.keys(manifest.sheets).length + manifest.players.length, "sprite sheets to public/assets");
