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
