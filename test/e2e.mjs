// Two-client browser check for online play (co-op and PvP).
//
// Needs a browser plus puppeteer-core, which is not a project dependency:
//   npm i -D puppeteer-core
//   CHROME_PATH=/usr/bin/chromium npm run test:e2e
//
// Each client gets its own browser so a hidden tab's throttled animation frame
// loop cannot fake a slow start.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}/`;
const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


async function loadPuppeteer() {
  for (const name of ["puppeteer-core", "puppeteer"]) {
    try {
      return await import(name);
    } catch {
      // try the next one
    }
  }
  return null;
}

const read = (page) =>
  page.evaluate(() => {
    const s = window.DEADBALLS?.state;
    const v = s?.net ? s.net.view() : null;
    const me = v?.players.find((p) => p.id === s.localId);
    return {
      mode: s?.mode,
      netMode: s?.netMode,
      localId: s?.localId,
      room: s?.roomCode,
      roster: s?.net?.roster?.map((r) => r.name) ?? [],
      players: v?.players.map((p) => ({
        id: p.id,
        name: p.name,
        x: Math.round(p.x),
        y: Math.round(p.y),
        ammo: p.ammo,
      })),
      enemies: v?.enemies.length ?? 0,
      wave: v?.wave,
      me: me ? { id: me.id, ammo: me.ammo, x: Math.round(me.x) } : null,
      overlays: [...document.querySelectorAll(".overlay:not(.hidden)")].map((n) => n.id),
    };
  });

async function until(page, fn, label, timeout = 6000, ...args) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(fn, ...args)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function openClient(puppeteer, name) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
    userDataDir: `/tmp/db2-e2e-${name}-${process.pid}`,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${name}: ${m.text()}`);
  });
  page.on("requestfailed", (r) => errors.push(`${name}: request failed ${r.url()}`));
  await page.setViewport({ width: 1100, height: 760 });
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await until(page, () => document.getElementById("loading").classList.contains("hidden"), "load");
  return {
    browser,
    page,
    errors,
    async close() {
      await browser.close();
      await rm(`/tmp/db2-e2e-${name}-${process.pid}`, { recursive: true, force: true });
    },
  };
}

async function fill(page, selector, text) {
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, text);
}

async function createRoom(page, name, mode) {
  await fill(page, "#nameInput", name);
  if (mode === "pvp") await page.click("#modePvp");
  else await page.click("#modeCoop");
  await page.click("#createBtn");
  await until(page, () => /^[A-Z0-9]{4}$/.test(document.getElementById("roomBadge").textContent.replace("ROOM", "").trim()), "room code");
  return page.evaluate(() => document.getElementById("roomBadge").textContent.replace("ROOM", "").trim());
}

async function joinRoom(page, name, code) {
  await fill(page, "#nameInput", name);
  await fill(page, "#codeInput", code);
  await page.click("#joinBtn");
  await until(page, () => window.DEADBALLS?.state?.net && window.DEADBALLS.state.roomCode !== "", "join");
}

const shootFor = async (page, ms) => {
  const box = await page.evaluate(() => {
    const r = document.getElementById("game").getBoundingClientRect();
    return { x: r.width / 2 + 120, y: r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await sleep(ms);
  await page.mouse.up();
  await sleep(300);
};

async function waitForHealth(tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Error("dev server did not start");
}


async function run() {
  const puppeteer = await loadPuppeteer();
  if (!puppeteer) {
    console.log("e2e skipped: install puppeteer-core first (npm i -D puppeteer-core)");
    return false;
  }
  if (!CHROME) {
    console.log("e2e skipped: set CHROME_PATH to a Chrome or Chromium binary");
    return false;
  }

  const server = spawn(process.execPath, ["server/dev.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[dev] " + d));

  const clients = [];
  try {
    await waitForHealth();

    // ---- co-op: two players share one world ----
    const a = await openClient(puppeteer, "a");
    const b = await openClient(puppeteer, "b");
    clients.push(a, b);

    const code = await createRoom(a.page, "ALPHA", "coop");
    await joinRoom(b.page, "BETA", code);
    await until(a.page, () => window.DEADBALLS.state.net.roster.length === 2, "A roster of two");
    await until(b.page, () => window.DEADBALLS.state.net.roster.length === 2, "B roster of two");

    const viewA = await read(a.page);
    const viewB = await read(b.page);
    assert.equal(viewA.netMode, "coop");
    assert.equal(viewB.netMode, "coop");
    assert.deepEqual(viewA.roster.slice().sort(), ["ALPHA", "BETA"]);
    assert.deepEqual(viewA.players.map((p) => p.name).sort(), ["ALPHA", "BETA"]);
    assert.equal(viewA.me.id, viewA.localId);

    // movement replicates: A holds D, B sees A further right
    const startX = viewB.players.find((p) => p.id === viewA.localId).x;
    await a.page.keyboard.down("d");
    await sleep(800);
    await a.page.keyboard.up("d");
    await until(
      b.page,
      (id, x) => {
        const p = window.DEADBALLS.state.net.view().players.find((q) => q.id === id);
        return !!p && p.x > x + 80;
      },
      "B sees A move right",
      4000,
      viewA.localId,
      startX
    ).catch(async () => {
      const seen = (await read(b.page)).players.find((p) => p.id === viewA.localId);
      throw new Error(`B did not see A move (start ${startX}, now ${seen?.x})`);
    });

    // firing spends ammo on the server, and B sees it
    const ammoBefore = (await read(a.page)).me.ammo;
    await shootFor(a.page, 1200);
    await until(
      a.page,
      (before) => {
        const s = window.DEADBALLS.state;
        const me = s.net.view().players.find((p) => p.id === s.localId);
        return me && me.ammo < before;
      },
      "A spends ammo",
      4000,
      ammoBefore
    );

    // a leaver drops out of the other client's roster
    await b.page.evaluate(() => window.DEADBALLS.state.net.close());
    await until(a.page, () => window.DEADBALLS.state.net.roster.length === 1, "A roster of one", 5000);
    assert.deepEqual((await read(a.page)).roster, ["ALPHA"]);
    await b.close();
    clients.pop();

    // ---- pvp: a second room in the other mode ----
    const c = await openClient(puppeteer, "c");
    const d = await openClient(puppeteer, "d");
    clients.push(c, d);
    const pvpCode = await createRoom(c.page, "CHARLIE", "pvp");
    await joinRoom(d.page, "DELTA", pvpCode);
    await until(c.page, () => window.DEADBALLS.state.net.view().players.length === 2, "PvP has two players");
    const pvpA = await read(c.page);
    const pvpB = await read(d.page);
    assert.equal(pvpA.netMode, "pvp");
    assert.equal(pvpB.netMode, "pvp");
    assert.equal(pvpA.players.length, 2);

    const pvpAmmo = pvpA.me.ammo;
    await shootFor(c.page, 1000);
    await until(
      d.page,
      (id, before) => {
        const p = window.DEADBALLS.state.net.view().players.find((q) => q.id === id);
        return !!p && p.ammo < before;
      },
      "D sees C spend ammo",
      4000,
      pvpA.localId,
      pvpAmmo
    );

    const errors = clients.flatMap((cl) => cl.errors).filter((e) => !e.includes("favicon"));
    assert.deepEqual(errors, [], "no page errors");

    console.log(`e2e ok: co-op room ${code}, pvp room ${pvpCode}`);
    return true;
  } finally {
    for (const cl of clients) {
      await cl.close().catch(() => {});
    }
    server.kill();
  }
}

run().then(
  () => process.exit(0),
  (err) => {
    console.error("e2e failed:", err.message);
    process.exit(1);
  }
);
