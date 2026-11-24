import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  addPlayer,
  removePlayer,
  applyInput,
  step,
  snapshot,
  createSolo,
  TICK,
  ARENA,
  WEAPONS,
  MAX_PLAYERS,
} from "../public/js/sim.js";

const ticks = (world, n, dt = TICK) => {
  for (let i = 0; i < n; i++) step(world, dt);
};

test("players spawn inside the arena and are capped at four", () => {
  const w = createWorld("coop");
  for (let i = 0; i < 6; i++) addPlayer(w, i + 1, "P" + i);
  assert.equal(w.players.length, MAX_PLAYERS);
  for (const p of w.players) {
    assert.ok(p.x >= 20 && p.x <= ARENA.w - 20);
    assert.ok(p.y >= 20 && p.y <= ARENA.h - 20);
    assert.equal(p.hp, 100);
    assert.deepEqual(p.ammo, WEAPONS.map((x) => x.mag));
  }
  removePlayer(w, 2);
  assert.equal(w.players.length, 3);
});

test("input moves the player and is clamped to the arena", () => {
  const w = createWorld("pvp");
  addPlayer(w, 1, "A");
  const p = w.players[0];
  const x0 = p.x;
  applyInput(w, 1, { mx: 1, my: 0, aim: 0 });
  ticks(w, 10);
  assert.ok(p.x > x0 + 50, "moves right");
  applyInput(w, 1, { mx: 1, my: 1, aim: 0 });
  ticks(w, 300);
  assert.ok(p.x <= ARENA.w - 20 && p.y <= ARENA.h - 20);
});

test("deterministic direction with diagonal input is normalised", () => {
  const w = createWorld("pvp");
  addPlayer(w, 1, "A");
  const p = w.players[0];
  const x0 = p.x;
  const y0 = p.y;
  applyInput(w, 1, { mx: 1, my: 1, aim: 0 });
  ticks(w, 10);
  assert.ok(Math.abs(p.x - x0 - (p.y - y0)) < 1.5, "diagonal is 45 degrees");
});

test("shooting spends ammo, respects cooldown and spawns bullets", () => {
  const w = createWorld("pvp");
  addPlayer(w, 1, "A");
  const p = w.players[0];
  applyInput(w, 1, { fire: true, aim: 0 });
  step(w, TICK);
  assert.equal(p.ammo[0], WEAPONS[0].mag - 1);
  assert.equal(w.bullets.length, 1);
  step(w, TICK);
  assert.equal(p.ammo[0], WEAPONS[0].mag - 1, "still on cooldown");
  ticks(w, 10);
  assert.ok(p.ammo[0] < WEAPONS[0].mag - 1);
});

test("reload pulls from reserve and cannot overfill", () => {
  const w = createWorld("pvp");
  addPlayer(w, 1, "A");
  const p = w.players[0];
  p.ammo[0] = 2;
  applyInput(w, 1, { reload: true });
  step(w, TICK);
  assert.ok(p.reload > 0);
  ticks(w, 40);
  assert.equal(p.ammo[0], WEAPONS[0].mag);
  assert.equal(p.reserve[0], WEAPONS[0].reserve - (WEAPONS[0].mag - 2));
  applyInput(w, 1, { reload: true });
  ticks(w, 45);
  assert.equal(p.reserve[0], WEAPONS[0].reserve - (WEAPONS[0].mag - 2), "no reload when full");
});

test("weapon switching works and shotgun fires pellets", () => {
  const w = createWorld("pvp");
  addPlayer(w, 1, "A");
  const p = w.players[0];
  applyInput(w, 1, { weapon: 1 });
  step(w, TICK);
  assert.equal(p.weapon, 1);
  applyInput(w, 1, { weapon: 1, fire: true, aim: 0 });
  step(w, TICK);
  assert.equal(w.bullets.length, WEAPONS[1].pellets);
});

test("pvp bullets damage and kill other players, then they respawn", () => {
  const w = createWorld("pvp");
  addPlayer(w, 1, "A");
  addPlayer(w, 2, "B");
  const a = w.players[0];
  const b = w.players[1];
  a.x = 200;
  a.y = 500;
  b.x = 300;
  b.y = 500;
  b.invuln = 0;

  for (let shot = 0; shot < 3; shot++) {
    applyInput(w, 1, { fire: true, aim: 0 });
    step(w, TICK);
    for (const bullet of w.bullets) {
      bullet.x = b.x - 1;
      bullet.y = b.y;
      bullet.vx = 0;
      bullet.vy = 0;
    }
    a.cool = 0;
    step(w, TICK);
  }

  assert.equal(a.kills, 1);
  assert.equal(b.alive, false);
  assert.equal(b.deaths, 1);
  const snap = snapshot(w);
  const sb = snap.players.find((p) => p.i === 2);
  assert.equal(sb.alive, false);
  assert.ok(sb.resp > 0);

  ticks(w, 90);
  assert.equal(b.alive, true, "respawned");
  assert.equal(b.hp, b.maxHp);
});

test("friendly fire is ignored and dead players cannot be hit", () => {
  const w = createWorld("pvp");
  addPlayer(w, 1, "A");
  addPlayer(w, 2, "B");
  const a = w.players[0];
  const b = w.players[1];
  a.x = 200;
  a.y = 500;
  b.x = 300;
  b.y = 500;
  a.invuln = 0;
  b.invuln = 0;
  applyInput(w, 1, { fire: true, aim: 0 });
  step(w, TICK);
  const own = w.bullets[0];
  own.x = a.x;
  own.y = a.y;
  step(w, TICK);
  assert.equal(a.hp, 100, "own bullet never damages the shooter");
  b.alive = false;
  b.respawn = 5;
  own.x = b.x;
  own.y = b.y;
  b.hp = 0;
  step(w, TICK);
  assert.equal(b.hp, 0);
  assert.equal(b.respawn <= 5 && b.respawn > 4, true, "dead player keeps its respawn timer");
});

test("coop spawns enemies, kills score points and waves advance", () => {
  const w = createWorld("coop");
  addPlayer(w, 1, "A");
  w.spawnTimer = 0;
  ticks(w, 40);
  assert.ok(w.enemies.length > 0, "enemies spawned");

  const e = w.enemies[0];
  w.bullets.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 1, damage: 9999, r: 3, owner: 1 });
  const scoreBefore = w.score;
  step(w, TICK);
  assert.ok(w.score > scoreBefore);
  assert.ok(!w.enemies.includes(e));
  const snap = snapshot(w);
  assert.ok(snap.events.some((ev) => ev.t === "kill"));
  assert.equal(w.events.length, 0, "world events are drained by snapshot");
});

test("coop enemy contact damages players and they respawn", () => {
  const w = createWorld("coop");
  addPlayer(w, 1, "A");
  const p = w.players[0];
  p.invuln = 0;
  p.hp = 10;
  w.enemies.push({ id: 99, type: "walker", x: p.x, y: p.y, angle: 0, r: 15, hp: 70, maxHp: 70, speed: 0, damage: 14, attack: 0, flash: 0 });
  step(w, TICK);
  assert.equal(p.alive, false);
  assert.equal(p.hp, 0);
  ticks(w, 130);
  assert.equal(p.alive, true);
  assert.equal(p.hp, p.maxHp);
});

test("pickups heal and restock reserves", () => {
  const w = createWorld("coop");
  addPlayer(w, 1, "A");
  const p = w.players[0];
  p.hp = 40;
  w.pickups.push({ id: 5, x: p.x, y: p.y, type: "health", life: 5 });
  step(w, TICK);
  assert.equal(p.hp, 64);
  const reserve = p.reserve.slice();
  w.pickups.push({ id: 6, x: p.x, y: p.y, type: "ammo", life: 5 });
  step(w, TICK);
  assert.ok(p.reserve[0] > reserve[0]);
});

test("malformed input and huge values never crash or escape", () => {
  const w = createWorld("coop");
  addPlayer(w, 1, "A");
  const p = w.players[0];
  for (const bad of [null, undefined, "x", 42, [], { mx: "a", my: NaN, aim: Infinity, weapon: 99 }, { mx: 1e9, my: -1e9 }]) {
    applyInput(w, 1, bad);
    step(w, 0.05);
  }
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  assert.ok(p.x >= 20 && p.x <= ARENA.w - 20);
  assert.ok(p.y >= 20 && p.y <= ARENA.h - 20);
  assert.ok(p.weapon >= 0 && p.weapon < WEAPONS.length);
  assert.ok(p.ammo[p.weapon] >= 0);
});

test("solo worlds contain exactly one player", () => {
  const w = createSolo("YOU");
  assert.equal(w.players.length, 1);
  assert.equal(w.mode, "coop");
  assert.equal(w.players[0].name, "YOU");
});

test("pvp match ends at 15 kills", () => {
  const w = createWorld("pvp");
  addPlayer(w, 1, "A");
  addPlayer(w, 2, "B");
  w.players[0].kills = 14;
  const b = w.players[1];
  b.hp = 1;
  b.invuln = 0;
  b.alive = true;
  w.players[0].x = 200;
  w.players[0].y = 500;
  b.x = 300;
  b.y = 500;
  applyInput(w, 1, { fire: true, aim: 0 });
  step(w, TICK);
  const bullet = w.bullets[0];
  bullet.x = b.x - 1;
  bullet.y = b.y;
  bullet.vx = 0;
  bullet.vy = 0;
  step(w, TICK);
  assert.equal(w.winner, 1);
  assert.equal(w.players[0].kills, 15);
  const before = w.time;
  step(w, TICK);
  assert.equal(w.time, before, "match is frozen after a winner");
});

test("a per-frame input with weapon -1 keeps the selected weapon", () => {
  const w = createWorld("coop");
  addPlayer(w, 1, "A");
  const p = w.players[0];
  applyInput(w, 1, { weapon: 1 });
  step(w, TICK);
  assert.equal(p.weapon, 1);
  for (let i = 0; i < 5; i++) {
    applyInput(w, 1, { weapon: -1, mx: 0, my: 0 });
    step(w, TICK);
    assert.equal(p.weapon, 1, "weapon -1 means no switch");
  }
});
