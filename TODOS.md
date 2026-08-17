# TODOs

Deferred work, with enough context to pick up cold. Each item records why it was
deferred, not just what it is.

Created 2026-07-26 from `/plan-ceo-review` and `/plan-eng-review`.

---

## P1 — Re-enable road scrapping with a correct orphan check

**What:** `isOrphanRoad` (`public/game-worker.js`, and the copy in `public/index.html`)
gives up after 8 visited tiles and then returns `true`. Any point in the middle of a long
intercity road is therefore classified as an orphan, and dwarves were scrapping working
roads. All three scrap call sites are commented out as of 2026-07-26.

**Why it matters:** road scrapping is a real feature. Stub roads left behind by abandoned
designations should get cleaned up. Right now nothing cleans them up.

**Where to start:** `rebuildRoadGraph()` already computes which roads connect which cities.
A correct check is "is this tile reachable from any city through road-like tiles", which the
graph can answer without a fresh BFS per tile.

**Watch out:** the current bug is *masking* a performance problem. `bfs` evaluates
`isOrphanRoad` as its goal function on every expanded node, and `bfs` is capped at 30,000
expansions. The broken check returns `true` almost immediately, so the search ends fast.
A correct check will not, so measure before re-enabling.

**Also:** `tests/smart-roads.test.ts:61` mirrors `isOrphanRoad` in TypeScript rather than
importing it, and its test maps are small enough that a city is always within 8 tiles, which
is why the suite never caught this. Fix the mirror or delete it when the sim is extracted.

**Depends on:** nothing. Independent of the extraction, though easier after it.

---

## P2 — Harden the save load path against malformed data

**What:** `fromSave()` should reject truncated or malformed D1 JSON with a visible message
instead of building a world with holes in it.

**Why it matters:** the last unrescued silent failure in the error map. A corrupted save
currently presents as a mysteriously empty civilisation.

**Where to start:** `getSerializableState()` at `public/index.html:5740` writes; loading
happens via `GET /api/state/load` (`src/db/state.ts`). Neither side validates.

**Depends on:** the `SAVE_VERSION` discriminator, which gives validation something to hang
off. Do that first.

---

## P3 — Report worker crashes to the backend

**What:** POST crash reason, browser, world seed and tick to a new endpoint so worker
failures are visible without a player reporting them.

**Why it matters:** once the main-thread fallback is deleted, a crash is visible to the
player and invisible to you. A browser that cannot run module workers would show those
players a dead end you never hear about.

**Where to start:** Hono routes in `src/worker.ts`, D1 table pattern in
`migrations/0001_init.sql` (`budget_log` is the closest shape).

**Needs a decision:** what you are willing to collect from players.

**Depends on:** seeds existing, so that a crash report can actually reproduce the world.

---

## P3 — Roadwright job claiming

**What:** nothing claims a road tile, so several dwarves can target the same one. The first
arrival upgrades `PATH -> ROAD` and clears the designation; later arrivals see `ROAD` and
keep upgrading, so one designation can escalate to `ASPHALT` and then `RAILROAD`, spending
city stone and iron at each step.

**Undecided:** whether this is a bug or intended progression. Roads improving under repeated
attention is a defensible simulation rule. Nobody has chosen.

**Where to start:** `tryRoadwrightWork` and `bestUpgradeTarget` in `public/game-worker.js`.

**Watch out:** a claim system needs release on death, starvation, travel and world load, or
it leaks permanently claimed tiles.

**Depends on:** easier once the simulation lives in `public/sim/` with real tests.

---

## P3 — Split view state out of `index.html`'s `G` object

**What:** `public/index.html:999` declares one object mixing 19 simulation fields with 9 view
fields (`cam`, `zoom`, `drag`, `sel`, `hovTile`, `mapDirty`, `mode`, `followDwarf`,
`routeDwarfId`), across 656 references.

**Why it matters:** the render layer stays as tangled as the simulation used to be.

**Watch out:** the snapshot merge at `public/index.html:6464` blends the two on purpose, so
that movement interpolates smoothly between ticks. Read that before touching anything.

**Depends on:** the simulation extraction landing first.

---

## Findings from the 2026-08-17 deep review, not yet fixed

Six reviewers (Claude and Codex, three surfaces). What was fixed that day is in the commit
log; everything below was found, verified, and deliberately left. Ordered by severity.

### P1 — Cities founded by the worker never reach the page, and are destroyed on reload

`tryFoundCity` (`public/game-worker.js:1790`) and `checkSuburbPromotion` (`:536`) push into
the *worker's* `CITIES`. The snapshot handler only updates cities it already knows
(`public/index.html:6517`, `const city = cityById(cd.id); if (city) city.res = cd.res;` with
no `else`). So a colony founded during play is invisible to the page, `restoreState` discards
its `cityResources`, and `initWorker` re-seeds the worker with the original hard-coded cities.
Restored colonists keep `cityId: 'colony_xxxx'`, so `cityOf(d)` falls through to `CITIES[0]`
and they eat from a city on the other side of the planet. A promoted suburb is worse: it is
spliced out of `G.suburbs` and exists only in the worker's `CITIES`, so the settlement
disappears entirely. Fix: push unknown city ids in the snapshot handler; the snapshot already
carries `id/name/emoji/mx/my/res`.

### P1 — The main-thread fallback throws on every tick once it takes over

`public/index.html:6485` merges snapshots as `{...previousDwarves.get(d.id), ...d}`. A dwarf
born inside the worker has no previous entry and so never gets a `path`, and the worker strips
`target` to `{type}` for all but the route-focused dwarf (`game-worker.js:2799`). The fallback
loop then hits `d.path.length` and `G.map[y][x]` on undefined. The `try/catch` at `:6410`
swallows it and aborts the whole dwarf loop each tick, so the game burns CPU and never
advances until reload. The tick guard added 2026-08-17 keeps the *worker* alive, which makes
this path much rarer, but it is still wrong. Best fixed by deleting the fallback sim, which is
what the extraction plan does anyway.

### P2 — Two performance cliffs that grow with the world

- `aiIdle` runs 4-6 `bfs` calls per idle dwarf (`game-worker.js:1231, 1243, 1272, 1280, 1290`),
  each capped only at 30,000 expansions. Measured on the real 2000x1000 map: ~45 ms per failed
  search, ~215 ms for five. `aiIdle` covers a quarter of the population per tick, so at 300
  dwarves that is far beyond the 33-100 ms tick budget. Fix: keep a live Set of designation
  coordinates (the `designate` handler already sees every one) and skip the search when empty;
  add a `maxSteps` argument for opportunistic scans.
- `rebuildRoadGraph` (`:1703-1740`) is a full-map, multi-tier BFS doing a linear `CITIES.find`
  per visited tile: ~437 ms at 28 cities, ~913 ms at 60. Every completed road tile sets
  `roadGraphDirty`, and the next `tryTravel` pays it inline. Fix: index cities in a Map by
  `mx,my` and debounce rebuilds.

### P2 — Save payload keeps growing (this is what broke persistence)

Beyond `mapDeltas`: `G.graves` gains an entry per death forever (`game-worker.js:356`),
`G.yearResolutions` gains one record per year per city (`:2243`), per-dwarf `eventLog` is
serialized at `.slice(-50)` and measured at roughly 39% of the whole save, and
`AI.intentCache` entries for dwarves that die before executing are never deleted. Any real fix
for the D1 size limit has to prune these, not just cap the request.

### P2 — Money paths that lose or misreport value

- **Failed model attempts are never billed.** `src/ai/router.ts:107-120` discards the usage on
  a caught error, and the AI SDK retries twice per model, so one `/api/decide` can pay for up
  to nine generations and log one. Schema-validation failures on cheap models are the common
  case, and the model was already paid.
- **A response with no `usage` records zero cost** (`router.ts:96-97, 181, 253, 330`).
  OpenRouter does not always return it, so real spend can miss `budget_log` entirely, which
  also means `checkBudget` never trips.
- **No refund handling.** The webhook handles only `order.paid` (`src/worker.ts:435`), so a
  refunded or charged-back sponsorship keeps its remaining premium calls and stays counted in
  `/api/sponsor/total`. There is also no check that the amount paid matches `amount_cents`.
- **Webhook idempotency is accidental**, resting entirely on `AND status='pending'`. Polar
  retries are at-least-once; the first non-status-guarded write will double-apply. A
  `processed_webhooks(webhook_id PRIMARY KEY)` insert-or-abort fixes the class.
- **The checkout is created before the local row is written** (`:404` then `:412`). If the
  insert fails the caller gets a 502 but a payable checkout URL already exists, and the webhook
  will later match zero rows with no reconciliation.
- **The claim token is returned exactly once** (`:420`) and is recoverable from nowhere, so a
  customer who clears storage loses their purchase with no support path. `/success` already
  looks the row up and could surface it.

### P3 — Smaller correctness issues

- `G.upgradeFrom` is never persisted, so after a reload a pending upgrade on asphalt or
  railroad rebuilds it as gravel, or reverts it to a path. Permanent infrastructure loss.
- A promoted town keeps its `suburb_` id prefix (`game-worker.js:529-536`), and
  `settlementPopCap` sniffs that prefix, so promoted towns stay capped at 4 residents forever.
- Any designation posts the page's whole `cityResources` (`index.html:5186`) and the worker
  does `Object.assign`, discarding everything the worker produced in the meantime.
- Sponsorships bought mid-session never reach the worker: there is no message type carrying
  sponsor state, so the dwarf sends an empty claim token for the rest of the session.
- `pendingTilePatches` / `pendingMmPatches` are drained only from `requestAnimationFrame`,
  which is suspended in a background tab while the worker keeps producing. They grow without
  bound.
- `craftQueue` is unbounded and holds strong references to dwarves that have already died.
- The harvest scan wraps at the poles (`game-worker.js:2276`) where every comparable scan
  clamps, so a city near `y=0` counts farms and beds from `y≈999` as its own.
- `/api/health` full-scans `budget_log`: the unique index is `(tier, hour)` but the query
  filters on `hour` alone. `budget_log` also has no retention.
- Model-output schemas are unbounded where values reach D1 (`src/ai/schemas.ts:76-80`).

### P1 — The test suite cannot see most of the code

Proven by mutation against a scratch copy, baseline 453 passing:

| Mutation | Result |
|---|---|
| Delete all of `public/game-worker.js` | 425 still pass |
| Delete both client files (81% of the codebase) | 412 still pass |
| Invert `isOrphanRoad` (the real shipped bug) | 453 still pass |
| Replace `src/ai/router.ts` with throwing stubs | 453 still pass |

250 of 453 tests execute no shipped code; they re-implement the logic they claim to test.
Six constant tables in the tests have already drifted from the shipped values, including
`MAX_ANIMALS` (test asserts 400, shipped is 800), `TERRAIN_SPEEDS`, and the tile ids in
`tests/travel-modes.test.ts`, where the test's RAILROAD collides with the shipped FISH_SPOT.
A parity gate landed 2026-08-17 for the two shipped copies; the test mirrors are still wrong.
Fix: migrate the mirrors onto the `node:vm` harness that `tests/road-repair.test.ts:67-92`
already uses, or delete them. They are worse than no tests, because they read as coverage.

---

## P2 — Cap the size of the state save payload

**What:** `POST /api/state/save` accepts any body length and writes it to the single
`game_state` row via `saveState()` (`src/db/state.ts`). Nothing checks how big the JSON is.

**Why it matters:** one oversized POST can fill the row that every player loads from. The
origin check on the route stops cross-site browser requests, but `Origin` is trivially set
by a non-browser client, so it is not a real authorization boundary.

**Where to start:** `src/worker.ts` `/api/state/save`. Reject on `Content-Length` above a
ceiling picked from a real save (log a few first), before parsing.

**Depends on:** nothing. Pairs naturally with the P2 malformed-save item above, since both
want the same validation layer.

---

## P3 — Rate limit sponsorship checkout creation

**What:** `POST /api/sponsor/checkout` inserts a `dwarf_sponsorships` row per call with no
per-caller limit. Input length and error handling were fixed 2026-08-17; call volume was not.

**Why it matters:** each call also creates a live Polar checkout. Polar throttles upstream,
so this is row spam rather than a spend risk, but the table is unbounded.

**Where to start:** `checkRateLimit` is keyed by AI tier and shares buckets with the model
budget, so do not reuse it directly — a checkout limiter needs its own bucket.

---

## P3 — Bump the Worker compatibility date

**What:** `wrangler.jsonc` pins `compatibility_date` to `2025-01-01`.

**Why it matters:** the runtime keeps old behaviour flags alive for that date. Newer Workers
APIs and fixes stay off until it moves.

**Watch out:** a compatibility date bump changes runtime semantics. Deliberately not done as
part of a review pass — do it on its own, deploy, and watch the logs.

---

## Deferred scope from the design doc

These were considered and consciously cut. See
`~/.gstack/projects/sliday-dwarf-land/stas-main-design-20260725-225918.md`.

- **Full save migration chain.** A `SAVE_VERSION` discriminator is in scope; a
  `migrate0to1 / migrate1to2` framework is not. Exactly one migration exists so far.
- **Command log, rewind, fork a timeline** (Approach C). Needs versioning and grows the save
  payload. Build it on the extraction, not inside it.
- **CI soak tests** over thousands of simulated years. Becomes cheap once `createWorld(seed)`
  exists.
- **Miniplex or any ECS.** Two structural changes at once make a regression unattributable.
- **Per-entity, per-tick derived randomness.** Named streams give the cross-system isolation
  that matters. Revisit only if call-order sensitivity actually bites.
- **Worker message protocol redesign.** The existing messages work; epoch and checkpoint are
  additive.
