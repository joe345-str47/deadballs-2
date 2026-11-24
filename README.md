# DEADBALLS 2 — Build 0.2.0

**Studio:** Mad Purple Hat Games
**Format:** HTML5 Canvas game with online co-op and PvP deathmatch, hostable on Cloudflare
**Target retail price:** $8.99 (planning value only; no checkout in this build)

Wave-based zombie survival arena with original pixel-art sprites, playable solo,
in online co-op with up to four players, or in online PvP deathmatch.

## Game modes

| Mode | Players | Rules |
| --- | --- | --- |
| Solo Survival | 1 local | Endless waves, escalating hordes and a boss every fifth wave |
| Online Co-op | 1–4 | The same horde, shared world, shared enemies, shared XP curve |
| Online PvP | 2–4 | Deathmatch on the same arena; first to 15 kills wins |

Rooms are joined with a four-character code (`A–Z`, `0–9`) or an invite link
(`/?room=CODE`).

## What's in this build

- Server-authoritative simulation: the shared `public/js/sim.js` runs on the
  server, clients only send input and interpolate 15 Hz snapshots
- Waves of walkers, runners, spitters and brutes, plus a boss every fifth wave
- Three weapons: Sidearm, Breacher shotgun, Ripper automatic rifle (reload,
  ammo reserves, `1`/`2`/`3` or mouse wheel)
- Procedurally generated original sprite sheets in `public/assets` (players,
  enemies, boss, bullets, effects, tiles, pickups); regenerate with `npm run sprites`
- Camera, particles, screen shake, off-screen threat arrows, hit markers
- Desktop keyboard/mouse and touch controls, pause, game over, respawn and a
  rematch flow
- Cloudflare Worker + Durable Object rooms, serving the game and the sockets
  from one deployment

## Run locally

```bash
npm install          # no runtime dependencies; nothing is fetched
npm run dev          # http://127.0.0.1:8787
```

`npm run dev` starts a dependency-free Node server that serves `public/` and
provides the same room protocol as production (hand-rolled WebSocket, one room
object per code). Set `PORT` and `HOST` to change the address.

Open the page, pick **SOLO SURVIVAL** to play offline in the browser, or
**PLAY ONLINE**, enter a name and either create a room or join a code.

## Tests

```bash
npm test             # simulation + room protocol (node:test, no dependencies)
```

Browser end-to-end (two clients, co-op and PvP, movement and ammo replication,
leave handling) needs a browser and puppeteer-core, which is intentionally not a
project dependency:

```bash
npm i -D puppeteer-core
CHROME_PATH=/usr/bin/chromium npm run test:e2e
```

## Deploy to Cloudflare

The Worker (`worker/src/index.js`) serves `public/` as static assets and routes
`/ws` and `/api/room/:code` to a `Room` Durable Object. One Durable Object per
room code keeps the world authoritative and single-threaded.

```bash
npx wrangler login
npm run deploy       # wrangler deploy --config worker/wrangler.toml
```

`worker/wrangler.toml` already points the assets binding at `../public` and
declares the `v1` migration with `new_sqlite_classes`. Replace the `name` there
if you want a different Worker name. Nothing in this repo contains credentials.

## Controls

- **Desktop:** WASD or arrows to move, mouse to aim, click/hold to fire,
  `R` reload, `1`/`2`/`3` or wheel to switch weapons, `Space` dash, `Esc` pause.
- **Touch:** left pad to move, FIRE and DASH buttons, weapon keys in the HUD.
  Aiming is automatic at the nearest target; drag on the canvas to aim manually.

## Project layout

```
public/            the game (index.html, style.css, js/, assets/)
public/js/sim.js   authoritative simulation shared by client, dev server and Worker
shared/room.js     room protocol: join/leave/input/snapshot, shared by both servers
worker/            Cloudflare Worker + Durable Object + wrangler config
server/dev.mjs     local Node dev server with the same protocol
test/              node:test suites and the browser e2e script
tools/             sprite generator and PNG encoder
```

## Notes

This is a development build. Before selling: device/browser testing, balance
and difficulty tuning, accessibility review, performance testing, final audio,
privacy/legal review and storefront packaging. The visuals are original
procedurally generated art; no third-party assets are included. The $8.99
target price is a planning value only and no checkout integration exists.
