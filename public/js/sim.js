// Authoritative game simulation shared by the browser (solo) and the room server.
// Pure ESM, no DOM and no timers: the host calls step() on a fixed tick.

export const TICK = 1 / 30;
export const ARENA = { w: 1600, h: 1000 };
export const MAX_PLAYERS = 4;

export const WEAPONS = [
  { name: "SIDEARM", mag: 12, reserve: 72, rate: 0.22, reload: 1.0, damage: 34, speed: 760, pellets: 1, spread: 0.035 },
  { name: "BREACHER", mag: 6, reserve: 42, rate: 0.62, reload: 1.35, damage: 22, speed: 610, pellets: 6, spread: 0.34 },
  { name: "RIPPER", mag: 30, reserve: 180, rate: 0.095, reload: 1.5, damage: 15, speed: 820, pellets: 1, spread: 0.075 },
];

export const COLORS = ["#a855f7", "#38bdf8", "#f6b64b", "#f472b6"];
export const SKIN_COUNT = 4;

const ENEMY_STATS = {
  walker: { hp: 70, r: 15, speed: 65, damage: 14, score: 70 },
  runner: { hp: 42, r: 11, speed: 125, damage: 10, score: 90 },
  brute: { hp: 150, r: 22, speed: 42, damage: 24, score: 160 },
  spitter: { hp: 58, r: 15, speed: 48, damage: 14, score: 110 },
  boss: { hp: 950, r: 38, speed: 38, damage: 30, score: 1500 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

export function createWorld(mode = "coop", options = {}) {
  const world = {
    mode: mode === "pvp" ? "pvp" : "coop",
    w: ARENA.w,
    h: ARENA.h,
    time: 0,
    wave: 1,
    spawnLeft: 0,
    spawnTimer: 1.2,
    waveBreak: 2.5,
    players: [],
    enemies: [],
    bullets: [],
    enemyBullets: [],
    pickups: [],
    events: [],
    nextId: 1,
    kills: 0,
    score: 0,
    winner: null,
    ...options,
  };
  if (world.mode === "coop") {
    world.spawnLeft = 8;
    world.waveBreak = 0;
  }
  return world;
}

function newPlayer(id, name, slot) {
  return {
    id,
    name: String(name || "SURVIVOR").slice(0, 14).toUpperCase(),
    slot,
    x: ARENA.w / 2,
    y: ARENA.h / 2,
    r: 15,
    angle: 0,
    hp: 100,
    maxHp: 100,
    speed: 245,
    weapon: 0,
    ammo: WEAPONS.map((w) => w.mag),
    reserve: WEAPONS.map((w) => w.reserve),
    cool: 0,
    reload: 0,
    dash: 0,
    dashX: 0,
    dashY: 0,
    dashCd: 0,
    invuln: 0,
    xp: 0,
    level: 1,
    kills: 0,
    deaths: 0,
    alive: true,
    respawn: 0,
    input: { mx: 0, my: 0, aim: 0, fire: false, reload: false, weapon: -1, dash: false },
    lastInputAt: 0,
  };
}

function spawnPoint(world, slot, id) {
  if (world.mode === "pvp") {
    const pts = [
      { x: 160, y: 160 },
      { x: ARENA.w - 160, y: ARENA.h - 160 },
      { x: ARENA.w - 160, y: 160 },
      { x: 160, y: ARENA.h - 160 },
    ];
    return pts[(slot + id) % pts.length];
  }
  return { x: ARENA.w / 2 + Math.cos(slot * 1.6) * 120, y: ARENA.h / 2 + Math.sin(slot * 1.6) * 120 };
}

export function addPlayer(world, id, name) {
  if (world.players.length >= MAX_PLAYERS) return null;
  const slot = [0, 1, 2, 3].find((s) => !world.players.some((p) => p.slot === s));
  const p = newPlayer(id, name, slot);
  const sp = spawnPoint(world, slot, 0);
  p.x = sp.x;
  p.y = sp.y;
  world.players.push(p);
  return p;
}

export function removePlayer(world, id) {
  const i = world.players.findIndex((p) => p.id === id);
  if (i >= 0) world.players.splice(i, 1);
}

export function applyInput(world, id, input) {
  const p = world.players.find((q) => q.id === id);
  if (!p || !input || typeof input !== "object") return;
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  p.input.mx = clamp(num(input.mx, 0), -1, 1);
  p.input.my = clamp(num(input.my, 0), -1, 1);
  p.input.aim = num(input.aim, p.angle);
  p.input.fire = !!input.fire;
  p.input.reload = !!input.reload;
  p.input.dash = !!input.dash;
  p.input.weapon = Number.isInteger(input.weapon) && input.weapon >= 0 ? clamp(input.weapon, 0, WEAPONS.length - 1) : -1;
  p.lastInputAt = world.time;
}

export function snapshot(world) {
  const r = (v) => Math.round(v);
  const snap = {
    tm: Math.round(world.time * 100) / 100,
    mode: world.mode,
    wave: world.wave,
    score: world.score,
    kills: world.kills,
    winner: world.winner,
    players: world.players.map((p) => ({
      i: p.id,
      n: p.name,
      s: p.slot,
      x: r(p.x),
      y: r(p.y),
      a: Math.round(p.angle * 100) / 100,
      hp: r(p.hp),
      mh: p.maxHp,
      w: p.weapon,
      am: p.ammo[p.weapon],
      rs: p.reserve[p.weapon],
      rl: p.reload > 0 ? 1 : 0,
      lv: p.level,
      xp: p.xp,
      k: p.kills,
      d: p.deaths,
      alive: p.alive,
      resp: p.respawn > 0 ? Math.ceil(p.respawn) : 0,
      dash: p.dash > 0 ? 1 : 0,
    })),
    enemies: world.enemies.map((e) => ({
      i: e.id,
      x: r(e.x),
      y: r(e.y),
      a: Math.round(e.angle * 100) / 100,
      t: e.type,
      hp: r(e.hp),
      mh: r(e.maxHp),
      f: e.flash > 0 ? 1 : 0,
    })),
    bullets: world.bullets.map((b) => ({ x: r(b.x), y: r(b.y), vx: r(b.vx), vy: r(b.vy), o: b.owner })),
    ebullets: world.enemyBullets.map((b) => ({ x: r(b.x), y: r(b.y), vx: r(b.vx), vy: r(b.vy) })),
    pickups: world.pickups.map((p) => ({ x: r(p.x), y: r(p.y), t: p.type })),
    events: world.events,
  };
  world.events = [];
  return snap;
}

function emit(world, ev) {
  if (world.events.length < 60) world.events.push(ev);
}

function alivePlayers(world) {
  return world.players.filter((p) => p.alive);
}

function nearestPlayer(world, x, y) {
  let best = null;
  let bd = Infinity;
  for (const p of world.players) {
    if (!p.alive) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function spawnEnemy(world, forcedType) {
  const edge = Math.floor(Math.random() * 4);
  const x = edge === 0 ? rand(0, world.w) : edge === 1 ? world.w + 25 : edge === 2 ? rand(0, world.w) : -25;
  const y = edge === 0 ? -25 : edge === 1 ? rand(0, world.h) : edge === 2 ? world.h + 25 : rand(0, world.h);
  let type = forcedType || "walker";
  if (!forcedType) {
    const roll = Math.random();
    if (world.wave >= 2 && roll > 0.68) type = "runner";
    if (world.wave >= 3 && roll > 0.83) type = "brute";
    if (world.wave >= 4 && roll > 0.92) type = "spitter";
  }
  const st = ENEMY_STATS[type];
  const scale = 1 + world.wave * 0.075;
  const e = {
    id: world.nextId++,
    type,
    x,
    y,
    angle: 0,
    r: st.r,
    hp: st.hp * scale,
    maxHp: st.hp * scale,
    speed: st.speed + world.wave * 2,
    damage: st.damage,
    attack: 0,
    flash: 0,
  };
  world.enemies.push(e);
  return e;
}

function spawnBoss(world) {
  const st = ENEMY_STATS.boss;
  world.enemies.push({
    id: world.nextId++,
    type: "boss",
    x: world.w / 2,
    y: -60,
    angle: 0,
    r: st.r,
    hp: 950 + world.wave * 140,
    maxHp: 950 + world.wave * 140,
    speed: 38 + world.wave,
    damage: st.damage,
    attack: 1.5,
    flash: 0,
  });
  emit(world, { t: "wave", n: world.wave, boss: 1 });
}

function shoot(world, p) {
  const w = WEAPONS[p.weapon];
  if (p.reload > 0 || p.cool > 0 || !p.alive) return;
  if (p.ammo[p.weapon] <= 0) {
    startReload(world, p);
    return;
  }
  p.cool = w.rate;
  p.ammo[p.weapon]--;
  for (let i = 0; i < w.pellets; i++) {
    const a = p.angle + (Math.random() - 0.5) * w.spread;
    world.bullets.push({
      x: p.x + Math.cos(a) * 22,
      y: p.y + Math.sin(a) * 22,
      vx: Math.cos(a) * w.speed,
      vy: Math.sin(a) * w.speed,
      life: 0.85,
      damage: w.damage,
      r: w.pellets > 1 ? 3 : 2.5,
      owner: p.id,
    });
  }
  emit(world, { t: "shot", x: Math.round(p.x + Math.cos(p.angle) * 24), y: Math.round(p.y + Math.sin(p.angle) * 24), a: Math.round(p.angle * 100) / 100, w: p.weapon });
}

function startReload(world, p) {
  const w = WEAPONS[p.weapon];
  if (p.reload > 0 || p.ammo[p.weapon] === w.mag || p.reserve[p.weapon] <= 0) return;
  p.reload = w.reload;
  emit(world, { t: "reload", id: p.id });
}

function switchWeapon(world, p, index) {
  if (index < 0 || index >= WEAPONS.length || index === p.weapon) return;
  p.weapon = index;
  p.reload = 0;
}

function hurtPlayer(world, p, amount, sourceId) {
  if (!p.alive || p.invuln > 0) return;
  p.hp -= amount;
  emit(world, { t: "hit", x: Math.round(p.x), y: Math.round(p.y), id: p.id });
  if (p.hp > 0) return;

  p.hp = 0;
  p.alive = false;
  p.deaths++;
  p.respawn = world.mode === "pvp" ? 2.5 : 4;
  p.dash = 0;
  emit(world, { t: "death", x: Math.round(p.x), y: Math.round(p.y), id: p.id });
  if (world.mode === "pvp" && sourceId != null && sourceId !== p.id) {
    const killer = world.players.find((q) => q.id === sourceId);
    if (killer) {
      killer.kills++;
      world.score = Math.max(...world.players.map((q) => q.kills), 0);
    }
  }
  if (world.mode === "pvp") {
    const best = world.players.reduce((a, b) => (b.kills > a.kills ? b : a), world.players[0]);
    if (best && best.kills >= 15) world.winner = best.id;
  }
}

function respawnPlayer(world, p) {
  const sp = spawnPoint(world, p.slot, p.id);
  p.x = sp.x;
  p.y = sp.y;
  p.hp = p.maxHp;
  p.alive = true;
  p.invuln = 1.5;
  p.respawn = 0;
  p.cool = 0;
  p.reload = 0;
  p.dash = 0;
  p.dashCd = 0;
  p.ammo = WEAPONS.map((w) => w.mag);
  p.reserve = WEAPONS.map((w) => w.reserve);
  emit(world, { t: "spawn", x: Math.round(p.x), y: Math.round(p.y), id: p.id });
}

function gainXp(world, p, n) {
  p.xp += n;
  while (p.xp >= p.level * 100) {
    p.xp -= p.level * 100;
    p.level++;
    p.maxHp += 8;
    p.hp = Math.min(p.maxHp, p.hp + 25);
    p.speed += 5;
    emit(world, { t: "level", id: p.id, lv: p.level });
  }
}

function updatePlayer(world, p, dt) {
  p.cool = Math.max(0, p.cool - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.flash = Math.max(0, (p.flash || 0) - dt);

  if (!p.alive) {
    p.respawn -= dt;
    if (p.respawn <= 0) respawnPlayer(world, p);
    return;
  }

  if (p.reload > 0) {
    p.reload -= dt;
    if (p.reload <= 0) {
      p.reload = 0;
      const w = WEAPONS[p.weapon];
      const need = w.mag - p.ammo[p.weapon];
      const take = Math.min(need, p.reserve[p.weapon]);
      p.ammo[p.weapon] += take;
      p.reserve[p.weapon] -= take;
      emit(world, { t: "reloaded", id: p.id });
    }
  }

  if (p.input.weapon >= 0) {
    switchWeapon(world, p, p.input.weapon);
    p.input.weapon = -1;
  }
  if (p.input.reload) startReload(world, p);
  if (p.input.dash) tryDash(world, p);

  p.angle = p.input.aim;

  let mx = p.input.mx;
  let my = p.input.my;
  const ml = Math.hypot(mx, my);
  if (ml > 1) {
    mx /= ml;
    my /= ml;
  }

  if (p.dash > 0) {
    p.dash -= dt;
    p.x += p.dashX * 760 * dt;
    p.y += p.dashY * 760 * dt;
  } else {
    p.x += mx * p.speed * dt;
    p.y += my * p.speed * dt;
  }
  p.x = clamp(p.x, 20, world.w - 20);
  p.y = clamp(p.y, 20, world.h - 20);

  if (p.input.fire) shoot(world, p);
}

function tryDash(world, p) {
  if (p.dashCd > 0 || !p.alive) return;
  let dx = p.input.mx;
  let dy = p.input.my;
  const l = Math.hypot(dx, dy);
  if (l < 0.1) {
    dx = Math.cos(p.angle);
    dy = Math.sin(p.angle);
  } else {
    dx /= l;
    dy /= l;
  }
  p.dash = 0.17;
  p.dashCd = 2.1;
  p.dashX = dx;
  p.dashY = dy;
  p.invuln = Math.max(p.invuln, 0.25);
  emit(world, { t: "dash", x: Math.round(p.x), y: Math.round(p.y) });
}

function updateEnemies(world, dt) {
  for (let i = world.enemies.length - 1; i >= 0; i--) {
    const e = world.enemies[i];
    e.flash = Math.max(0, e.flash - dt);
    e.attack -= dt;
    const target = nearestPlayer(world, e.x, e.y);
    if (!target) continue;
    const a = Math.atan2(target.y - e.y, target.x - e.x);
    e.angle = a;
    const d = Math.hypot(target.x - e.x, target.y - e.y);

    if (e.type === "spitter") {
      if (d > 250) {
        e.x += Math.cos(a) * e.speed * dt;
        e.y += Math.sin(a) * e.speed * dt;
      } else if (e.attack <= 0) {
        e.attack = 2.1;
        world.enemyBullets.push({
          x: e.x + Math.cos(a) * 18,
          y: e.y + Math.sin(a) * 18,
          vx: Math.cos(a) * 250,
          vy: Math.sin(a) * 250,
          life: 2,
          r: 6,
          damage: 12,
        });
        emit(world, { t: "spit", x: Math.round(e.x), y: Math.round(e.y) });
      }
    } else {
      e.x += Math.cos(a) * e.speed * dt;
      e.y += Math.sin(a) * e.speed * dt;
    }

    if (d < e.r + target.r + 3 && e.attack <= 0) {
      e.attack = e.type === "boss" ? 0.8 : 0.85;
      hurtPlayer(world, target, e.damage, e.id);
    }
  }
}

function killEnemy(world, e, killerId) {
  const score = ENEMY_STATS[e.type].score;
  world.score += score;
  world.kills++;
  const killer = world.players.find((p) => p.id === killerId);
  if (killer) gainXp(world, killer, e.type === "boss" ? 70 : 12);
  emit(world, {
    t: "kill",
    x: Math.round(e.x),
    y: Math.round(e.y),
    k: e.type,
    boss: e.type === "boss" ? 1 : 0,
  });
  if (e.type === "boss") {
    for (const p of alivePlayers(world)) p.hp = Math.min(p.maxHp, p.hp + 35);
  }
  if (Math.random() < 0.17) {
    world.pickups.push({
      id: world.nextId++,
      x: clamp(e.x, 20, world.w - 20),
      y: clamp(e.y, 20, world.h - 20),
      type: Math.random() < 0.65 ? "health" : "ammo",
      life: 12,
    });
  }
}

function updateBullets(world, dt) {
  for (let i = world.bullets.length - 1; i >= 0; i--) {
    const b = world.bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let hit = false;

    if (world.mode === "coop") {
      for (let j = world.enemies.length - 1; j >= 0; j--) {
        const e = world.enemies[j];
        if (Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r) {
          e.hp -= b.damage;
          e.flash = 0.08;
          emit(world, { t: "impact", x: Math.round(b.x), y: Math.round(b.y) });
          hit = true;
          if (e.hp <= 0) {
            killEnemy(world, e, b.owner);
            world.enemies.splice(j, 1);
          }
          break;
        }
      }
    } else {
      for (const p of world.players) {
        if (p.id === b.owner || !p.alive) continue;
        if (Math.hypot(b.x - p.x, b.y - p.y) < p.r + b.r) {
          hurtPlayer(world, p, b.damage, b.owner);
          emit(world, { t: "impact", x: Math.round(b.x), y: Math.round(b.y) });
          hit = true;
          break;
        }
      }
    }

    if (hit || b.life <= 0 || b.x < -30 || b.x > world.w + 30 || b.y < -30 || b.y > world.h + 30) {
      world.bullets.splice(i, 1);
    }
  }

  for (let i = world.enemyBullets.length - 1; i >= 0; i--) {
    const b = world.enemyBullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let hit = false;
    for (const p of world.players) {
      if (!p.alive) continue;
      if (Math.hypot(b.x - p.x, b.y - p.y) < p.r + b.r) {
        hurtPlayer(world, p, b.damage, null);
        hit = true;
        break;
      }
    }
    if (hit || b.life <= 0) world.enemyBullets.splice(i, 1);
  }
}

function updatePickups(world, dt) {
  for (let i = world.pickups.length - 1; i >= 0; i--) {
    const pk = world.pickups[i];
    pk.life -= dt;
    let taken = false;
    for (const p of world.players) {
      if (!p.alive) continue;
      if (Math.hypot(pk.x - p.x, pk.y - p.y) < p.r + 15) {
        if (pk.type === "health") p.hp = Math.min(p.maxHp, p.hp + 24);
        else
          for (let j = 0; j < WEAPONS.length; j++) {
            p.reserve[j] += j === 1 ? 8 : 24;
          }
        emit(world, { t: "pickup", x: Math.round(pk.x), y: Math.round(pk.y), id: p.id });
        taken = true;
        break;
      }
    }
    if (taken || pk.life <= 0) world.pickups.splice(i, 1);
  }
}

function updateWaves(world, dt) {
  if (world.mode !== "coop") return;
  if (world.waveBreak > 0) {
    world.waveBreak -= dt;
    return;
  }
  world.spawnTimer -= dt;
  if (world.spawnLeft > 0 && world.spawnTimer <= 0) {
    spawnEnemy(world);
    world.spawnLeft--;
    world.spawnTimer = Math.max(0.22, 0.9 - world.wave * 0.035) * rand(0.65, 1.3);
  }
  if (world.spawnLeft === 0 && world.enemies.length === 0) {
    world.wave++;
    world.spawnLeft = 7 + world.wave * 3;
    world.spawnTimer = 1.1;
    world.waveBreak = 0.6;
    if (world.wave % 5 === 0) spawnBoss(world);
    for (const p of alivePlayers(world)) p.hp = Math.min(p.maxHp, p.hp + 8);
    emit(world, { t: "wave", n: world.wave });
  }
}

export function step(world, dt = TICK) {
  if (world.winner) return;
  world.time += dt;
  for (const p of world.players) updatePlayer(world, p, dt);
  if (world.mode === "coop") {
    updateWaves(world, dt);
    updateEnemies(world, dt);
  }
  updateBullets(world, dt);
  updatePickups(world, dt);
}

/** Solo convenience: create a world with one local player already in it. */
export function createSolo(name = "YOU", mode = "coop") {
  const world = createWorld(mode);
  addPlayer(world, 1, name);
  return world;
}
