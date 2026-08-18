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

### ~~P1 — Cities founded by the worker never reach the page~~ HALF FIXED 2026-08-18

The in-session half is fixed. The snapshot handler in `index.html` now adopts a city id it does
not recognise, building a page-side record from the fields the snapshot already carried
(`id/name/emoji/mx/my/res`) and deriving `lon`/`lat` from `mx`/`my`. A colony founded during
play is therefore visible to the page, renders, and is included by `getCityResourcesSnapshot`,
so `cityOf` no longer falls through to `CITIES[0]` and its colonists stop eating from a city on
the other side of the planet.

`tests/city-snapshot-merge.test.ts` runs the merge block straight out of `index.html` rather
than restating it: seven cases covering adoption, idempotency across repeated snapshots, the
lon/lat derivation, several colonies in one payload, and the guard that refuses a city with no
position. Three mutations verified — reverting the handler, dropping the position guard, and
dropping the `continue` that stops a known city being duplicated.

Review caught a second path into the same bug. `checkSuburbPromotion` reuses the suburb's id
for the promoted city and sends the new city and the shrunk suburb list in one snapshot, while
`cityById` falls back to `G.suburbs`. With the suburbs assignment still running *after* the
cities loop, the lookup matched the suburb being promoted away, updated a doomed object and
skipped adoption, leaving the town in neither collection for that cycle and its residents
falling through to `CITIES[0]`. The assignment now runs before the loop. Two more tests cover
it; note that the regression is caught structurally, because the test extracts the block
starting at the suburbs line, so moving that line fails the harness guard rather than an
assertion.

**The reload half is NOT fixed** — see the next item.

### ~~P1 — The save has no city list, so colonies die on reload~~ FIXED 2026-08-18

The save now carries a `colonies` array beside `cityResources`, holding the identity a city
needs to come back: `id/name/emoji/mx/my/lon/lat/culture/res`. Cities adopted from a worker
snapshot are marked `founded: true`, which is what the filter selects, so the hard-coded table
is never mistaken for a colony. `restoreState` rebuilds them into `CITIES` before the
`cityResources` loop that looks each city up by id and silently drops what it cannot find, and
before `initWorker` seeds the worker from that same list.

`tests/colony-persistence.test.ts` runs the shipped `getSerializableState`, the shipped rebuild
block and the shipped snapshot-merge block — twelve cases, including a full found-save-reload
round trip that never sets `founded` by hand, so the link between adoption and persistence is
covered rather than assumed.

Four mutations verified: reverting the file, moving the rebuild after the resource loop,
dropping the position guard, and removing the `founded` mark. The last one initially survived,
because the tests built city objects directly instead of going through adoption — the
end-to-end chain was added to close that.

**The first attempt at this fix was dead code, and review caught it.** `saveGameState` posts
`save_request` to the worker whenever one exists, and the worker replies with its *own*
`getSerializableState` in `game-worker.js`. That is what reaches `/api/state/save` in every
browser with `Worker` support, so editing only the page's serializer changed nothing in
practice. The worker now marks the cities it creates — both `tryFoundCity` and
`checkSuburbPromotion` — and carries the same `colonies` array. Two further mutations cover it.

### ~~P1 — The save has two serializers and only one of them is live~~ GUARDED 2026-08-18

`tests/save-shape-parity.test.ts` now holds the contract between all three parties: the live
worker serializer, the page's fallback serializer, and what `restoreState` actually reads back.
Four assertions — the two serializers write the same fields, everything restored is written,
everything written is restored, and the fields the simulation cannot be rebuilt without are
named explicitly.

Measured before writing it: the three already agree, 15 keys each, nothing read-but-unwritten
and nothing written-but-unread. So there was no second silent loss hiding behind the first —
the guard is there to stop the next one.

Four mutations verified, including the exact mistake that motivated it (adding a field to the
page serializer only, which is invisible in every browser with a worker) and dropping
`colonies` from the live worker copy. A fourth confirms a comment containing a colon is not
mistaken for a field — that false positive appeared while writing the parser, off a comment
reading "the hard-coded table: colonies founded by ...", so the parser strips comments first.

**This guards the shape, not the values.** Both serializers writing a `dwarves` key says
nothing about whether they write the same dwarves. See the item below.

### P1 — The tab-close save is fired in a way that cannot finish

**What:** on `beforeunload`, with a worker active — the normal case — the chain is
`postMessage({type:'save_request'})` to the worker, the worker computes state, `postMessage`
back, and then the page performs a plain `fetch()` POST in the `save_response` handler. That
fetch has no `keepalive` and is not a beacon, and the whole round trip starts *after*
`beforeunload` has already returned. Nothing in it is likely to survive page teardown.

`sendBeacon` exists in the file but sits in the *else* branch, so it only runs when there is no
worker. The code already knows: the comment on the worker branch reads "Worker save_request is
async; best-effort via auto-save every 60s".

**Why it matters:** closing the tab can silently discard up to a minute of play. The 60-second
auto-save is the only thing actually protecting the session, and it is being relied on as a
safety net rather than as a periodic checkpoint.

**Where to start:** the cheap half is `keepalive: true` on the `save_response` fetch, which at
least lets an in-flight request outlive the page. The sound fix is to stop routing through
`postMessage` at unload time: keep the worker's most recent `save_response` payload on the page
and `sendBeacon` that directly from `beforeunload`, so no round trip is needed. Consider
`pagehide` too — there is no handler for it, and it fires in cases `beforeunload` does not,
including mobile tab eviction.

**Watch out:** a beacon has a payload size cap (~64 KB in most browsers) and the save is already
recorded as growing without bound, so this wants doing alongside the save-size work rather than
before it.

**Correction:** an earlier version of this item claimed the tab-close save wrote the page's
degraded view state over the worker's authoritative state. That was wrong, and review caught
it. `sendBeacon` is unreachable while a worker is active, and in the no-worker case the page
runs the full simulation itself, so its state is authoritative rather than a mirror. The probe
that produced the wrong reading looked at 120 characters either side of `sendBeacon` and missed
the enclosing conditional.

**What:** `getSerializableState` exists in both `public/index.html` and `public/game-worker.js`,
with independently maintained key lists. `saveGameState` uses the worker's whenever a worker
exists, which is effectively always; the page's runs only in the no-worker fallback and on
`beforeunload` when `!workerActive`.

**Why it matters:** anything added to the page's save silently does nothing. That just happened
with `colonies` and was caught only because a reviewer checked which serializer the save path
actually reaches. The commit log records the same class of failure before ("silent save loss"),
so this is the second time round.

**Where to start:** a parity test in the shape of the terrain-speed one added 2026-08-18 —
extract the returned object's top-level keys from both files and assert the sets are equal.
That is cheap and would have failed the moment `colonies` went into one and not the other.
Extracting each function by brace matching already works; `tests/colony-persistence.test.ts`
does exactly that for both files.

**Watch out:** the two are not meant to be identical in *value* — the worker holds the
authoritative simulation state and the page holds view state — so compare key sets, not
contents, and allow a documented exception list rather than forcing them to converge.

**Better still:** delete the page's copy along with the main-thread fallback, which the
fallback-throws item above already argues for.

### P1 — The save has no city list, so colonies still die on reload (superseded)

**What:** `getSerializableState` persists these keys and no others:

`tick, cityResources, dwarves, animals, stats, homeCity, mapDeltas, graves, yearResolutions,
suburbs, dirtTiles`

`cityResources` is `{ [cityId]: res }` and nothing else — `getCityResourcesSnapshot` is three
lines and keeps only resources. There is no record of a colony's id, name, emoji, position or
culture anywhere in the save.

**Why it matters:** on the next load `CITIES` is the hard-coded list again. The saved
`cityResources` entry for `colony_ab12` has no city to attach to and is dropped, `initWorker`
re-seeds the worker from the hard-coded list, and the colony is gone — along with every dwarf
that called it home, who revert to `cityOf` falling through to `CITIES[0]`. The 2026-08-18 fix
above makes the colony real for the rest of the session only.

**Where to start:** `suburbs` already shows the shape. It is saved as full records
(`id/name/emoji/mx/my/parentCityId/culture/res`) and restored wholesale, which is exactly what
colonies need. Persist a `colonies` array of the same shape — cities whose id is not in the
hard-coded table — and rebuild them into `CITIES` in `restoreState` *before* `initWorker` runs,
since the worker is seeded from the page's list.

**Watch out:** ordering. `init()` calls `generateMap()`, then `restoreState()`, then
`initWorker()`, so the rebuild has a window, but city placement has already run by then and
will not place a colony for you — set `mx`/`my` straight from the save. Also decide what
happens when a saved colony's tile is now ocean, which is possible while the world is still
non-deterministic (see the seeded-RNG item).

**Depends on:** nothing strictly, but it wants doing alongside `SAVE_VERSION`, because it
changes the save shape and an old save will have no `colonies` key.

### P1 — Cities founded by the worker never reach the page, and are destroyed on reload (original entry)

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

### ~~P2 — Two performance cliffs that grow with the world~~ FIXED 2026-08-17

Both landed with `tests/idle-scan-cost.test.ts` (28 tests), which runs the shipped worker
through the `node:vm` harness rather than mirroring it. Measured before and after on the real
2000x1000 map: `aiIdle` 315.8 ms -> 5.6 ms per idle dwarf (56x); `rebuildRoadGraph` 262 ms ->
226 ms at 60 cities, producing the identical 1770 pairs. 13 mutations were applied to the
shipped file one at a time; 12 failed a test, and the survivor was semantically equivalent
(the `startCity.id` guard, unreachable because the start tile is pre-visited).

**Residual risk worth watching:** the tree scan has no post-search distance filter, so its
8000-step cap does narrow the search from roughly 122 tiles to 63 when a city drops below 10
wood. The gather scan is unaffected — its result was already discarded past 30 steps, and 4000
steps reaches about 44. If playtesting shows dwarves idling next to visible forest, that cap is
the first thing to raise.

- `aiIdle`: added a `designationIndex` (tile id -> Set of `x,y`) fed by every writer that can
  put a designation into `G.map` — `mapSet`, the `designate` handler, the `restore` mapDeltas
  replay, and a full-map `rebuildDesignationIndex()` on `init`. `anyDesignation()` answers in
  O(1) and self-heals by verifying `G.map` and dropping stale keys on read. `bfs` gained a
  `maxSteps` argument: gather 4000, upgrade 2500, tree 8000, roadwright 12000.
- The `init` pass was missed on the first attempt and caught by adversarial review. `init` is
  the only bootstrap message `index.html` sends (nothing in `public/` or `src/` ever posts
  `restore`), and it replaces `G.map` wholesale, so without that pass the index started empty
  on every reload and dwarves ignored all pre-existing designations. The one-off scan measures
  20 ms on the full 2000x1000 map.
- `rebuildRoadGraph`: replaced the per-tile `CITIES.find` with a `cityAt` Map keyed
  `mx + my*MAP_W`, and `queue.shift()` with a head index. `tryTravel` now coalesces rebuilds
  behind `ROAD_GRAPH_MIN_TICKS = 120` instead of paying one per completed road tile.
- Two latent bugs fell out: `tryFoundCity` pushed a city without setting `roadGraphDirty`, and
  `restore` carried the previous session's road graph and `roadGraphBuiltTick` into a freshly
  loaded world.

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

## World generation review, 2026-08-17

Full report: `docs/reviews/2026-08-17-worldgen.md`. Every number in it was measured by running
the extracted pipeline in Node, not estimated. Three details in it are wrong and are corrected
below: `LAND` holds **91** ellipses (not ~110), `restoreState()` does **not** re-run
`generateMap()` (`init()` runs it fresh on every load, before restore replays deltas — same
conclusion, different mechanism), and `index.html:424` is the About modal, not the splash.

### ~~P0-1 — `generateMap()` blocks the main thread~~ PARTLY FIXED 2026-08-17

Measured 15,975 ms -> 5,559 ms median (2.87x) over an interleaved A/B run, with the generated
world byte-identical (same SHA-256 over all 2,000,000 tiles, same 620,119 land and 43,976 beach
tiles). Exactness is the whole point: saves store deltas against this map, so a world that
shifts by one tile corrupts every existing save. `tests/worldgen-land-index.test.ts` pins it.

- `isLandAt` scanned all 91 ellipses per call and is called ~4.28M times. Ellipses are now
  bucketed by longitude once (`buildLandBuckets`), so a call tests only the few that can
  contain the point, plus a latitude early-reject before the divisions. Stage 1: 10.3s -> 4.7s.
- Stage 2 computed both noise samples for all 2,000,000 tiles, including the 1.38M ocean ones
  that only need them when they border land. Ocean is handled first and skips the rest:
  4.0M noise calls -> 1.31M, 4.8s -> 2.6s.
- `prand` is pure and only called by `noise`, which samples four lattice corners. Generation
  steps across a lattice cell every 3 to 185 tiles, so the same corners were recomputed
  millions of times. Memoised by coordinate, with a range guard because the packed key stops
  being injective outside it.

**Still to do, and the reason this is only half fixed:** 5.6s of synchronous work before the
first paint is still a dead tab. The loader at `index.html:319-324` exists but its bar is a 4s
CSS keyframe unrelated to real progress, and it freezes along with everything else. The next
step is the review's second suggestion — yield every N rows so the loader animates, or move
generation into the worker. Deliberately not done here: `generateMap()` is called once from
`init()` (`:6694`) before `restoreState()` and `initWorker()`, and making it async reorders
startup in ways this session had no browser to verify.

### ~~P0-2 — 9 of 125 cities are silently dropped~~ FIXED 2026-08-17

All 125 now place. Nine ellipses were added to `LAND` for the landmasses that were simply
absent: Luzon, Java, the South African cape, Florida, Jamaica, the Ecuador coast, the West
African bulge, the Guinea coast, and Madagascar. The bare `continue` at the drop site now
`console.warn`s, so the next missing continent says so. `tests/city-placement-coverage.test.ts`
runs the real terrain and placement blocks and asserts 125/125.

All nine cities sat in open water with zero of their nine surrounding tiles on land, so this
was missing geography, not a marginal miss. Dakar was 99 tiles from the nearest land.

The new ellipses are checked for both failure directions, since the cheap way to place a city
is to draw land that welds two continents together:

- islands that must stay islands (Jamaica vs Cuba and the isthmus, Madagascar vs Africa, Luzon
  vs the mainland, Britain vs France as a control);
- coastal additions that must stay attached (Florida, the Cape, Dakar, Accra, Quito);
- and a global check that no pair of landmasses which were separate before the change came out
  joined after. Land components went 1087 -> 1140, a net increase.

**Correction to the review's "26 cities nudged up to 19 tiles":** all three figures in
circulation are right, they just use different metrics. Chebyshev displacement maxes at 10,
which is exactly the nudge cap, so nothing violates it; Euclidean maxes at 13.45 and Manhattan
at 19 (Damascus, dx -10 dy +9). 31 cities now sit off their true tile, up from 26.

**Note for whoever does the save work:** adding land changes the base map, so deltas saved
against the old world no longer line up. That is survivable today only because the world is
already non-deterministic (P0-3 below). Once the seed lands, a change like this needs a
`SAVE_VERSION` bump.

### P2 — Narrowing the beaches moved the food inland, and nobody has decided whether that is right

**What:** beach tiles are where stage 2 scatters crab, clay and some fish spots. Shrinking the
beach belt from 47,238 tiles to 10,788 cut those resources roughly in proportion. Measured over
the same seed, before and after the 2026-08-17 beach fix:

| tile | before | after | change |
|---|---|---|---|
| CRAB | 1,218 | 300 | -75% |
| CLAY | 1,356 | 902 | -33% |
| FISH_SPOT | 2,255 | 1,851 | -18% |
| BERRY_BUSH | 2,190 | 2,400 | +10% |
| DEER | 775 | 862 | +11% |
| HERB_PATCH | 1,385 | 1,616 | +17% |

**Why it matters:** total edible tiles fell about 10%, which is unremarkable, but the
distribution moved: coastal food (crab plus fish) is down 38% while inland food is up, because
former beach tiles became forest and plains. Coastal cities now have noticeably less on their
doorstep. Crab is beach-only, so it took the whole hit.

**The decision nobody has made:** whether the beach fix was meant to be purely cosmetic. If so,
the per-tile spawn chances on beach tiles should rise to hold the absolute counts roughly
steady — crab is `Math.random() < 0.05` in the beach branch of stage 2, and about 0.2 would
restore the old count. If instead thinner coasts are meant to make coastal living harder, then
this is working as intended and only needs saying out loud.

**Where to start:** the beach branch of stage 2 in `generateMap`. Re-measure with the resource
census rather than guessing; the numbers above came from counting tiles over a fixed seed.

**Watch out:** raising the rates to compensate puts a crab on roughly one beach tile in five,
which reads as dense. Splitting the difference is probably better than restoring the old total.

**Two things that soften this, and one that does not.** Crabs respawn on beach tiles during
play at a 15% per-tile roll (`game-worker.js:2472`), so the world-gen count is a starting stock
rather than the ceiling. Ships and the coastal city nudge test adjacency to `T.OCEAN` directly,
not to `T.BEACH`, so harbour access is unaffected. But turtles spawn only on beach and
crocodiles only on jungle or beach, so the same 75% cut applies to their spawn candidates —
check whether coastal fauna thins out noticeably before deciding the resource rates.

---

### ~~P1 — City placement never checks that a dwarf can stand on the tile~~ WITHDRAWN

Written 2026-08-17 on a false premise: that MOUNTAIN is impassable. It is in `WALKABLE` in both
copies of the simulation and costs `speed: 5`. Nothing needs adding to the placement check on
those grounds. Left here rather than deleted because the reasoning is worth not repeating.

### ~~P1 — Every grave is a permanent pathfinding wall~~ FIXED 2026-08-18

Added `[T.GRAVE]:{speed:1}` to `game-worker.js` and `[T.PATH]: { speed: 1 }` to `index.html`,
each matching the value the sibling file already used, so neither is a new tuning decision.

`tests/constants-parity.test.ts` grew the invariant that would have caught both: every member of
`WALKABLE` must have a speed-table entry with `speed > 0`, checked in both files, plus a
cross-file agreement check on every shared speed. Four mutations verified against it — removing
either entry, setting a walkable tile to speed 0, and making the two copies disagree.

Bonus: `buildRoad` reads the same table with a fallback of 5 for unknown tiles, so the missing
PATH row is also why the world-gen review saw new roads routing around existing paths as if
they were mountains. That is fixed. Merging is *not*, and review confirmed why — `buildRoad`
scores tiles as:

```js
else if (t === T.RAILROAD) tc = 0.1;
else if (t === T.ASPHALT)  tc = 0.2;
else if (t === T.ROAD)     tc = 0.4;
else { const p = TERRAIN_PROPS[t]; tc = p ? Math.max(p.speed, 0.5) : 5; }
```

PATH has no branch of its own, so it lands on `Math.max(1, 0.5) = 1` — exactly what open plains
cost. New roads no longer route *around* paths, but nothing steers them *onto* one either. A
PATH branch around 0.5, or a lower speed in the shared table, is what would make corridors
form. Deliberately not changed here: the speed is shared with the movement pathfinder, so
lowering it makes dwarves walk faster on dirt paths too, which is a balance call.

### P2 — Two traversability predicates that are allowed to disagree

**What:** the codebase decides "can something cross this tile" in three different places.

```js
function isWalkable(x, y) {
  const t = G.map[wrapY(y)][wrapX(x)];
  if (WALKABLE.has(t)) return true;
  const props = TERRAIN_PROPS[t];
  return props && props.speed > 0;      // the fallback does the real work
}
function terrainCost(x, y) { ... if (!props || props.speed <= 0) return Infinity; return props.speed; }
```

plus `buildRoad`'s own cost function with its fallback of 5.

**Why it matters:** `WALKABLE` is not authoritative and reads as though it is. `IRON_ORE`,
`GOLD_VEIN` and `GEMS` are absent from it in both files yet traversable, because they have
speed 4 and the fallback clause lets them through. Meanwhile a tile that is in `WALKABLE` but
missing a speed was traversable by `isWalkable` and impassable to `bfs` — that was the grave
bug, now fixed and guarded. The guard closes one direction of a gap that should not exist at
all: there is no reason for two predicates.

**Where to start:** derive `isWalkable` from the cost function — `terrainCost(x, y) !== Infinity`
— and delete the `WALKABLE` set, or keep the set purely as documentation and assert it equals
the positive-speed tiles. Either way one table becomes the single source of truth. The parity
test added on 2026-08-18 already extracts both and can assert the stronger equality once the
three ore tiles are reconciled.

**Watch out:** `isWalkable` has around 20 call sites in `index.html` and 25 in the worker, and
some use it as a `bfs` goal predicate where the current permissiveness may be load-bearing.
Change the definition, then re-run the city and world-gen suites, which now exercise real
placement and terrain rather than mirrors.

**What:** `terrainCost` returns `Infinity` for any tile missing from `TERRAIN_PROPS`:

```js
const props = TERRAIN_PROPS[t];
if (!props || props.speed <= 0) return Infinity;
```

Both files declare 33 walkable tiles and 40 `TERRAIN_PROPS` keys, and in each one a different
walkable tile has no entry:

| file | tile in `WALKABLE` with no `TERRAIN_PROPS` | effect |
|---|---|---|
| `public/game-worker.js` | `T.GRAVE` | graves are impassable to the pathfinder |
| `public/index.html` | `T.PATH` | dirt paths are impassable to the pathfinder |

**Why it matters:** the worker is the live simulation, so the grave gap is the one players hit.
`placeGrave` writes `T.GRAVE` wherever a dwarf dies, `isWalkable` returns true for it, and
`bfs` refuses to enter it. A dwarf can stand on a tile the pathfinder will not route through,
which is the classic stuck-dwarf signature, and it gets worse over a long game because graves
only accumulate — `G.graves` is already recorded as growing forever in the save-size item.

The `index.html` gap is the same bug pointed the other way: the roads dwarves build are walls
to the main-thread pathfinder. That copy is the dead fallback, so it bites less, but it is the
same missing-key class.

**Where to start:** add the two missing entries. Grave should cost about what floor costs;
`PATH` already has a speed in the worker to copy. Then assert the invariant rather than the two
specific tiles: every member of `WALKABLE` must have a `TERRAIN_PROPS` entry with `speed > 0`,
checked in both files. That is a parity test the existing gate cannot express — see the
parity-gate item below, which compares the tile enum and four scalars and would never have
caught this.

**How this surfaced:** looking for something else entirely, while checking whether MOUNTAIN was
impassable. Note that `grep` in this environment silently drops matching lines, which is how
the MOUNTAIN question got the wrong answer twice; both findings here were confirmed by parsing
the files rather than grepping them.

### P2 — Four cities still have no farmland within reach

**What:** `farmable` is `{FLOOR, PLAINS, BEACH, DESERT, TUNDRA}` (`index.html:5169`). Delhi,
Nairobi, Santiago and Boise have zero farmable tiles within 20 tiles, once the 3x3 fortress
they write for themselves is discounted — and that fortress is the only reason the naive check
"can this city reach a farmable tile" passes for every city: `FLOOR` is farmable, so each city
sits on four tiles of it. Capacity, not existence, is the thing to measure.

**Why it matters:** those cities can never grow their food supply past the starting plot.

**What has already been done:** the equatorial rainforest, the Pacific North West and the
tropical fallback each gained a farmable outcome on 2026-08-18, which took the zero-farmland
count from 5 to 4 and the under-20 count from 12 to 6. Reverting either the Pacific North West
valleys or the rainforest clearings now fails a test.

**Where to start:** find which rule each of the four cities lands in and give it a farmable
outcome, the same way. Delhi is the interesting one — it sits just south of the Himalaya box at
lat 29 and may be getting nudged into it during placement, so check its final tile rather than
its declared coordinates.

**Watch out:** measure, do not reason. Every attempt at this so far has had a second-order
effect that only showed up in a census: widening a region's farmable band moves the global
biome mix, and the three-pass biome scatter erodes small patches so a high-frequency noise
threshold does much less than it looks like it will.

---

### P1 — The coast noise is wider than several real straits, so islands weld to continents

**What:** `generateMap` warps the land lookup by up to about 4 degrees — `isLandAt(lon + cn,
lat + cn * 0.4)` where `cn = noise(...) * 4` — which is roughly 22 tiles at 0.18 degrees per
tile. Any sea gap narrower than that closes somewhere along its length, so the two coasts fuse.

**Why it matters:** it is already true in the shipped map, not a risk introduced by the city
work. Measured by labelling 4-connected land components: **Sumatra, Borneo and Bangkok are one
landmass**, so a dwarf can walk from mainland Thailand to Borneo. That silently changes what
`tryTravel`, the road graph and land-only A* mean — a sea crossing that should need a ship is
just a walk. It also makes island placement unpredictable: an ellipse drawn 2 degrees off a
coast may or may not attach depending on where the noise happens to land.

**Where to start:** the warp exists to make coastlines organic, and it succeeds at that, so the
fix is not to delete it. Options in rough order of effort: scale `cn` down near a strait by
sampling the unwarped distance to the nearest other landmass; drop the amplitude from 4 to
about 1.5 degrees and add a second higher-frequency octave to keep the coast ragged; or keep
the warp and accept the fused geography, but then say so in the About copy rather than
implying a real-world map.

**How to check any fix:** label land components and assert the pairs that should be separate
are separate. `tests/city-placement-coverage.test.ts` already has the machinery; the probe
script used to compare two versions of `index.html` is worth promoting out of the scratchpad.

**Watch out:** narrowing the warp changes every coastline, so it moves the base map for every
existing save. Sequence it with the `SAVE_VERSION` work, not before it.

---

### ~~P0-3 — The world is non-deterministic while saves store only deltas~~ FIXED 2026-08-18

Measured before, running the shipped generator twice with real `Math.random` available:
**33,891 tiles differed, 1.695% of the map.** The top changes name the mechanism exactly —
`FISH_SPOT<->OCEAN`, `HILL<->IRON_ORE`, `FOREST<->MUSHROOM` — so iron a player had mined out
reappeared somewhere else every session. The worst single call picked `G.homeCity` at random,
which relocates the entire starting fortress.

All 22 `Math.random()` calls inside `generateMap` now go through a seeded `genRandom()`
(mulberry32, `WORLD_SEED = 20260726`), reseeded at the top of the function so a second call
repeats the first. The other 66 calls in the file — dwarf creation, spawning, animals, the AI —
are deliberately untouched: gameplay should stay random.

**Measured after: 0 differing tiles.**

**It was worse than one player's world drifting between sessions.** `migrations/0001_init.sql`
declares `game_state` with `id INTEGER PRIMARY KEY DEFAULT 1` and `src/db/state.ts` upserts that
single row, so there is exactly one shared save for everyone — while each client generated its
own base map locally. The one shared set of deltas was landing on a *different world in every
browser*. A fixed seed is the whole fix precisely because the save is shared; nothing needs to
choose a seed per world. The save records `worldSeed` in both serializers and `restoreState`
warns when it does not match the running build.

Pinned by `tests/worldgen-determinism.test.ts`, which generates twice with real `Math.random`
in the sandbox — a stubbed sandbox would have hidden the very bug under test — plus a
source-level assertion that no `Math.random` remains inside `generateMap`, and `WORLD_SEED`
added to the shared list in `tests/constants-parity.test.ts`. Four mutations verified: one site
reverted to `Math.random`, the reseed removed, the two files' seeds made to disagree (which
fails in both gates), and the PRNG made to ignore its seed argument.

**Three harnesses broke and were right to.** `drift`, `city-placement-coverage` and
`colony-persistence` all extract shipped functions into a sandbox, and the new helpers sit
outside the spans they were extracting. Each needed widening rather than stubbing — the
placement harness is now deterministic too, which is what lets its thresholds be exact numbers.

### P1 — The save records a world seed the loader cannot honour

**What:** `init()` calls `generateMap()` at line ~6894 and `await restoreState()` at ~6912 —
generation happens 18 lines before the save is even fetched. So the `worldSeed` now written
into the save can be compared against the running build, and warned about, but never acted on.
If a save was written against a different seed, the loader will still generate the current
world and drop the player's deltas onto it.

**Why it matters:** it is fine while the seed is a fixed constant, which is why the warning is
enough today. It stops being fine the moment anyone changes `WORLD_SEED`, adds per-world seeds,
or ships a generator change — and the failure is silent terrain corruption, which is what the
fix above was for.

**Where to start:** two changes, not one. `generateMap()` takes no seed argument — it calls
`resetWorldRng(WORLD_SEED)` internally — so honouring a saved seed needs both a
`generateMap(seed)` signature and `loadGameState()` moved ahead of it in `init()`. That reorders
startup, so it wants a browser to verify rather than only the Node harnesses.

**Worth knowing first:** a seed change does *not* redraw the continents. `noise` and `prand` are
hash functions over hardcoded constants and take no seed, so the landmasses, biomes and
coastlines are fixed by the `LAND` table and the noise functions regardless. `WORLD_SEED` only
moves the scattered things — mushrooms, ores, fish spots, the biome-border bleed and the home
city. Anyone expecting "new seed, new world" will be surprised, and if that is wanted, the noise
functions need a seed parameter too.

**What:** two runs of `generateMap()` differ on 45,478 tiles (2.27%). Mushrooms, the resource
overlay and the biome scatter all use unseeded `Math.random()`.

**Why it matters:** `init()` regenerates the base world on every load and `restoreState()`
replays `saved.mapDeltas` on top, so the iron a player mined last session may never have
existed this session.

**Where to start:** a seeded PRNG for every `Math.random()` inside generation, with `worldSeed`
stored in the save. Pairs with the `SAVE_VERSION` work already queued below. The review
recommends doing this first because it makes everything else testable.

### P1 — Geography and systems quality

- ~~**Beaches average 6 tiles deep.**~~ FIXED 2026-08-17. The coast test asked "is there ocean
  within ±2°", which at 0.18° per tile means 11 tiles. Measured before: 47,238 beach tiles,
  mean distance-to-ocean 5.92, max 17, 61.5% at least 5 tiles inland, and a histogram almost
  flat from depth 1 to 8 — a belt, not a shoreline. The probe is now a named `BEACH_PROBE`
  of 0.4° (a little over 2 tiles). After: 10,788 tiles, mean 1.78, max 7, 0.4% at least 5 deep,
  83% at depth 1-2. Generation time is unchanged. Pinned by four assertions in
  `tests/city-placement-coverage.test.ts`, including one that the coast stays broken rather
  than becoming a solid drawn outline (sand covers 0.334 of depth-1 tiles with the noise gate,
  0.504 without, so the bound sits between them).
  A 0.4° probe reaches about 2.2 tiles, so it does not by itself explain the max of 7. The rest
  comes from the stage 1.5 biome-border scatter, which treats BEACH as a scatterable biome and
  can carry it one hop further inland on each of its three passes. That is pre-existing and
  untouched, but it means beach depth is set by two mechanisms, not one, and tightening the
  probe further would hit diminishing returns until the scatter excludes BEACH.
- ~~**Australia renders as a mountain range and central Brazil gets a Sahara.**~~ FIXED
  2026-08-17. The root cause was ordering: the global altitude test ran *above* the regional
  overrides and returned early, so no region could ever claim its own high ground. The proof is
  the Great Plains, which had an override returning nothing but plains and forest and still
  came out 36.2% hill. The altitude test now runs after the regional block, and four regions
  were added: Andes, Himalayas and Tibet, Australia, and the Brazilian cerrado.

  | region | before | after |
  |---|---|---|
  | Australia | MOUNTAIN 50.3% | MOUNTAIN 6.0%, DESERT 30.9%, PLAINS 41.8% |
  | US Midwest | HILL 36.2% | HILL 0.6%, PLAINS 91.6% |
  | Himalaya | MOUNTAIN 0%, FOREST 63.5% | MOUNTAIN 26.9%, HILL 33.3% |
  | Andes | MOUNTAIN 0% | high ground 77% |
  | central Brazil | DESERT 18.7% | DESERT 0.1%, PLAINS 86.2% |
  | Sahara | DESERT 77.3%, HILL 16.7% | DESERT 77.7%, HILL 18.0% |

  Three things the change turned up that were not in the review, all now fixed:

  - **The reorder is not free.** Region rules had been written assuming the global test already
    took the high ground, so running them first made them over-claim. The Rockies' `alt > 0.1`
    went from meaning "0.1 to 0.35" to meaning "0.1 to 1.0" and walled Los Angeles, Las Vegas,
    Boise and Salt Lake City into pockets of about 40 walkable tiles. Thresholds are now set
    near the old global ones.
  - **Two cities fell between region boxes by exactly zero.** Los Angeles sits at lon -118 and
    the SW Desert box tested `lon > -118`; New Orleans sits at lon -90 with the SE box at
    `lon > -90` and Great Plains at `lon < -90`. Both belonged to no region at all and took
    whatever the altitude noise gave them. The boxes were widened by a degree.
  - **A range with no low ground starves the cities inside it.** `farmable` covers neither HILL
    nor MOUNTAIN, and the first Himalaya and Andes boxes could emit nothing else, which left
    Delhi and Lima with no farmland in reach. Caught in review. The Himalaya box now starts
    north of the Indo-Gangetic plain, carves out the Tarim Basin as desert, and both ranges have
    valley floors.

  **Correction, 2026-08-18.** The paragraph that used to sit here said MOUNTAIN is absent from
  `WALKABLE` and therefore a wall, and reported a "cities sealed into a walkable pocket" figure
  built on that. That was wrong. `T.MOUNTAIN` is in the `WALKABLE` set in both
  `public/index.html` and `public/game-worker.js`, and `TERRAIN_PROPS` gives it `speed: 5` —
  slow, not impassable. Only speed-0 tiles (OCEAN, WALL) block movement. The retuning above
  still stands on its own terms, and cutting the Rockies' over-claim was still worth doing
  because MOUNTAIN costs five times what plains cost, but "walled in" overstated it.

  The measurement that survives contact with the shipped constants is farmland: `farmable`
  covers FLOOR, PLAINS, BEACH, DESERT and TUNDRA, so a region emitting only JUNGLE, FOREST,
  HILL or MOUNTAIN leaves its cities nowhere to grow food. Cities with no farmable tile within
  20 tiles went from 5 on the original map to 4; cities under 20 farmable tiles went from 12 to
  6. Pinned in `tests/city-placement-coverage.test.ts`, which now reads both `farmable` and
  `WALKABLE` out of the shipped source instead of retyping them.
- **The road graph is 95 disconnected groups**, largest chain 5 cities, 6,746 PATH tiles. Each
  city links only its 2 nearest. A per-landmass MST would guarantee connectivity at similar
  total length. This is a design call, not a bug, if roads are meant as local flavour.
- **`buildRoad` cost bugs.** `T.PATH` is missing from `TERRAIN_PROPS` so it falls to the default
  cost 5, the same as mountain, and new roads route *around* existing paths instead of merging.
  The heuristic counts tiles while the minimum step cost is 0.1-0.5, so A* is inadmissible and
  degenerates to greedy. `T.FLOOR` is not in the no-overwrite list, so roads pave city plazas.

### P2 — Polish

- Scatter pass has a fixed neighbour order with `break` on first difference, so northern tiles
  bleed preferentially and in-place mutation smears along the scan direction.
- Single-octave value noise over a `sin()` hash gives blobby features; 2-3 octaves of fBm is a
  few lines.
- `biomeStartRes` re-derives biome from lon/lat and can disagree with the terrain actually
  generated under the city. Sampling the placed tiles would stay truthful.
- The About copy (`index.html:424`) still says "500×250 tile planet … 29 real-world cities".
  Actual: 2000×1000 and 125 cities, 116 placed. `CLAUDE.local.md` repeats the 500×250 figure.
- Pole wrap is inconsistent: `isWalkable` uses `wrapY` so walking off the north edge teleports
  to Antarctica, while `bfs`/`terrainCost` treat `y < 0` as blocked.
- City placement requires `countLandTiles >= 6` but the coastal nudge accepts `>= 5`.

---

## P2 — The parity gate cannot see the two simulations diverging

**What:** `tests/constants-parity.test.ts` compares the tile enum and four scalars between
`public/game-worker.js` and `public/index.html`. It does not compare function bodies, and the
bodies have already drifted further than the constants ever did.

**Why it matters:** `bfs` exists in both files. The worker caps it at 30,000 expansions; the
`index.html` copy at `:1910` caps it at 2,000, and nothing has ever flagged that. `aiIdle` is
duplicated at `index.html:2489` with a `D_BUILD` branch the worker has never had and different
road predicates. The designation index and the `maxSteps` argument added 2026-08-17 went into
the worker only, so the two copies now disagree about how work is found as well as how far it
searches. Anyone reading `index.html` to understand the simulation reads the wrong file.

**Where to start:** the honest fix is deleting the main-thread fallback, which the P1 item
above already argues for on correctness grounds — a fallback that throws on every tick is not
a fallback. Short of that, extend the gate to compare the shared function bodies by name and
fail on any divergence, the way the tile enum check works now.

**Watch out:** `index.html` genuinely needs some of these functions for rendering (the snapshot
merge at `:6464` interpolates movement between ticks). Deleting the fallback is not the same as
deleting every duplicated function, so the two jobs need separating before either starts.

**Depends on:** nothing. Gets much easier once the simulation lives in `public/sim/`.

---

### ~~The save exceeded the server cap, so a played-in world stopped persisting~~ FIXED 2026-08-18

Measured from a real save sitting in the local D1: **2,196,897 bytes** against
`MAX_STATE_BYTES = 1_500_000`. Every save of a world with any history in it was rejected 413.
Where it went:

| key | bytes |
|---|---|
| dwarves | 1,102,683 — of which `eventLog` alone was 869,670, 40% of the whole save |
| mapDeltas | 900,223 — 71,250 entries at ~13 bytes as `{"x,y":tile}` |
| animals | 126,699 |
| everything else | 67,292 |

Two changes, both in the worker and the page:

- `mapDeltas` is packed at the save boundary only — 3 bytes of tile index plus 1 byte of tile
  id, base64'd, about 5.3 bytes an entry instead of 13. The in-memory shape is untouched, so
  `mapSet`, the snapshot path and the worker init payload all still pass the plain object;
  only two emitters and two restore readers changed. `unpackMapDeltas` accepts the old object
  form, so existing saves still load and no `SAVE_VERSION` bump was needed.
- Per-dwarf history in the save is capped by a named `SAVED_EVENT_LOG = 10` rather than a
  hardcoded 50.

Result, measured against the same real payload: **996,183 bytes, 55% smaller, 503,817 under the
cap**, with the deltas round-tripping exactly.

**What the log trim costs:** nothing during a session. The in-memory log is capped at 50 either
way, the snapshot still sends 50, and the AI prompt path already used `slice(-10)`. The only
visible change is that the dwarf panel, which renders `slice(-50)`, shows ten entries instead
of fifty for a dwarf whose history came back from a save.

Pinned by `tests/save-size.test.ts`, which runs the shipped packer and measures the real
payload when one is present on disk. Four mutations verified, including the `slice(-0)` trap —
setting the cap to 0 keeps the whole array rather than none of it, which the sizing model hit
for real before the test existed.

### P2 — The save now has headroom, not a bound

**What:** packing bought room; it did not stop the growth. At about 5.3 bytes per map delta and
503,817 bytes of headroom, the cap comes back at roughly **166,000 deltas**, against 71,250 in
the sample — a bit over twice as much play. Several structures still only grow: `G.graves`
gains an entry per death forever, `yearResolutions` gains one per year per city, and
`AI.intentCache` never drops entries for dwarves that died before executing.

**Why it matters:** the failure mode is the one just fixed, and it returns silently. The 413 is
reported by `reportSaveResult` on the periodic path, but the `beforeunload` beacon path
discards the response entirely.

**Where to start:** bound the unbounded things rather than shrinking the bounded ones. Graves
and `yearResolutions` want a cap with the oldest dropped; `intentCache` wants eviction on
death. For `mapDeltas` the honest answer is that a delta which restores a tile to the value
`generateMap` would produce anyway is dead weight, and once the world is seeded and
deterministic that becomes checkable.

**Measure, do not estimate:** the sizing above came from a real 2.19 MB row in
`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/`. There are two sqlite files there and only
one holds a played-in world — the other has a 329-byte row, which is what a naive first look
finds.

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
