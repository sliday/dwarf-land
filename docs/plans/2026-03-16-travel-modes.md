# Travel Modes: Replace Ships & Vehicles with Dwarf Capabilities

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace separate ship/vehicle entities with travel modes that dwarves "equip" when traveling between cities — like mining, but for transport.

**Architecture:** When a dwarf decides to travel, check what transport the origin city supports (coastal = ship, road type = cart/car/train). Set `d.travelMode` on the dwarf, which controls speed multiplier, cargo bonus, and emoji. No separate G.ships[] or G.vehicles[] arrays. Ships/vehicles become a city capability, not map objects.

**Tech Stack:** Vanilla JS (game-worker.js + index.html), Vitest for tests.

---

## Travel Mode Config

```js
const TRAVEL_MODES = {
  walk:  { emoji:'🚶', speed:1,  cargoBonus:0,  label:'Walking' },
  cart:  { emoji:'🐴', speed:2,  cargoBonus:8,  label:'Horse Cart',  requires:'path' },
  car:   { emoji:'🚗', speed:4,  cargoBonus:15, label:'Car',          requires:'asphalt' },
  train: { emoji:'🚂', speed:6,  cargoBonus:40, label:'Train',        requires:'railroad' },
  ship:  { emoji:'⛵', speed:3,  cargoBonus:10, label:'Ship',         requires:'coastal' },
};
```

**Rules:**
- City is "coastal" if any water tile within 4 tiles of city center
- Road connection checked via existing `G.roadGraph[pairKey]`
- Best mode selected: train > car > cart > ship > walk
- Ship mode only if no land route exists AND both cities are coastal
- Speed = tiles moved per tick (walk=1 currently, so cart=2/tick etc.)
- cargoBonus = extra carry capacity while traveling

---

### Task 1: Write travel mode tests

**Files:**
- Create: `tests/travel-modes.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

const MAP_W = 500, MAP_H = 250;
const T = {
  OCEAN:0, TUNDRA:1, TAIGA:2, FOREST:3, PLAINS:4, DESERT:5, JUNGLE:6, MOUNTAIN:7,
  HILL:8, BEACH:9, FLOOR:10, WALL:11, STOCKPILE:12, BED:13, TABLE:14, DOOR:15,
  MUSHROOM:16, FARM:17, CITY:18, FISH_SPOT:23, CORAL:24,
  PATH:25, ROAD:26, ASPHALT:27, RAILROAD:28,
};

const TRAVEL_MODES = {
  walk:  { emoji:'\uD83D\uDEB6', speed:1,  cargoBonus:0,  label:'Walking' },
  cart:  { emoji:'\uD83D\uDC34', speed:2,  cargoBonus:8,  label:'Horse Cart',  requires:'path' },
  car:   { emoji:'\uD83D\uDE97', speed:4,  cargoBonus:15, label:'Car',          requires:'asphalt' },
  train: { emoji:'\uD83D\uDE82', speed:6,  cargoBonus:40, label:'Train',        requires:'railroad' },
  ship:  { emoji:'\u26F5',       speed:3,  cargoBonus:10, label:'Ship',         requires:'coastal' },
};

function wrapX(x: number) { return ((x % MAP_W) + MAP_W) % MAP_W; }
function isWater(x: number, y: number, map: number[][]) {
  const t = map[y]?.[wrapX(x)];
  return t === T.OCEAN || t === T.FISH_SPOT || t === T.CORAL;
}

function isCityCoastal(cx: number, cy: number, map: number[][]) {
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const x = wrapX(cx+dx), y = cy+dy;
      if (y >= 0 && y < MAP_H && isWater(x, y, map)) return true;
    }
  return false;
}

function bestTravelMode(
  originCity: any, destCity: any,
  roadGraph: Record<string, any>,
  map: number[][]
): string {
  const pairKey = [originCity.id, destCity.id].sort().join('-');
  const tiers = roadGraph[pairKey];
  // Land routes preferred over sea
  if (tiers?.railroad) return 'train';
  if (tiers?.asphalt) return 'car';
  if (tiers?.gravel || tiers?.path) return 'cart';
  // Sea route if both cities are coastal
  if (isCityCoastal(originCity.mx, originCity.my, map) &&
      isCityCoastal(destCity.mx, destCity.my, map)) return 'ship';
  return 'walk';
}

let map: number[][] = [];

function buildMap() {
  map = [];
  for (let y = 0; y < MAP_H; y++) {
    const row = [];
    for (let x = 0; x < MAP_W; x++) {
      if (y <= 4) row.push(T.OCEAN);
      else row.push(T.PLAINS);
    }
    map.push(row);
  }
}

beforeEach(() => buildMap());

describe('isCityCoastal', () => {
  it('returns true for city near water', () => {
    expect(isCityCoastal(10, 7, map)).toBe(true); // y=7, water at y<=4, within 4
  });
  it('returns false for inland city', () => {
    expect(isCityCoastal(10, 50, map)).toBe(false);
  });
});

describe('bestTravelMode', () => {
  const cityA = { id:'a', mx:10, my:7 };   // coastal
  const cityB = { id:'b', mx:50, my:7 };   // coastal
  const cityC = { id:'c', mx:10, my:50 };  // inland
  const cityD = { id:'d', mx:50, my:50 };  // inland

  it('returns train when railroad exists', () => {
    expect(bestTravelMode(cityC, cityD, {'c-d':{railroad:true,asphalt:true,gravel:true}}, map)).toBe('train');
  });
  it('returns car when asphalt exists but no railroad', () => {
    expect(bestTravelMode(cityC, cityD, {'c-d':{asphalt:true,gravel:true}}, map)).toBe('car');
  });
  it('returns cart when gravel/path exists', () => {
    expect(bestTravelMode(cityC, cityD, {'c-d':{gravel:true}}, map)).toBe('cart');
  });
  it('returns ship when both coastal and no road', () => {
    expect(bestTravelMode(cityA, cityB, {}, map)).toBe('ship');
  });
  it('returns walk when inland and no road', () => {
    expect(bestTravelMode(cityC, cityD, {}, map)).toBe('walk');
  });
  it('prefers land route over ship', () => {
    expect(bestTravelMode(cityA, cityB, {'a-b':{gravel:true}}, map)).toBe('cart');
  });
});

describe('TRAVEL_MODES config', () => {
  it('has speed >= 1 for all modes', () => {
    for (const m of Object.values(TRAVEL_MODES)) expect(m.speed).toBeGreaterThanOrEqual(1);
  });
  it('walk has no requirements', () => {
    expect(TRAVEL_MODES.walk).not.toHaveProperty('requires');
  });
  it('each non-walk mode has a requires field', () => {
    for (const [k, m] of Object.entries(TRAVEL_MODES)) {
      if (k !== 'walk') expect(m).toHaveProperty('requires');
    }
  });
});

describe('travel mode on dwarf', () => {
  it('dwarf gains travelMode and cargoBonus when traveling', () => {
    const d = { id:'d1', state:'idle', travelMode:null as string|null, carrying:3, carryItems:{wood:3} };
    // Simulate starting travel
    const mode = 'car';
    d.travelMode = mode;
    d.state = 'traveling';
    expect(d.travelMode).toBe('car');
    expect(TRAVEL_MODES[mode].cargoBonus).toBe(15);
    expect(TRAVEL_MODES[mode].speed).toBe(4);
  });
  it('dwarf clears travelMode on arrival', () => {
    const d = { state:'traveling', travelMode:'ship' as string|null };
    d.state = 'idle';
    d.travelMode = null;
    expect(d.travelMode).toBeNull();
  });
});
```

**Step 2: Run tests to verify they pass (these are unit-testing pure functions we define in the test)**

Run: `npx vitest run tests/travel-modes.test.ts`
Expected: ALL PASS (these tests are self-contained with inline implementations)

**Step 3: Commit**

```bash
git add tests/travel-modes.test.ts
git commit -m "test: add travel mode unit tests"
```

---

### Task 2: Add TRAVEL_MODES config and helper functions to game-worker.js

**Files:**
- Modify: `public/game-worker.js` (top of file, near VEHICLE_TYPES)

**Step 1: Add TRAVEL_MODES constant and bestTravelMode function**

Replace `VEHICLE_TYPES` and `MAX_VEHICLES` (lines 39-44) with:

```js
const TRAVEL_MODES = {
  walk:  { emoji:'\uD83D\uDEB6', speed:1,  cargoBonus:0,  label:'Walking' },
  cart:  { emoji:'\uD83D\uDC34', speed:2,  cargoBonus:8,  label:'Horse Cart',  requires:'path' },
  car:   { emoji:'\uD83D\uDE97', speed:4,  cargoBonus:15, label:'Car',          requires:'asphalt' },
  train: { emoji:'\uD83D\uDE82', speed:6,  cargoBonus:40, label:'Train',        requires:'railroad' },
  ship:  { emoji:'\u26F5',       speed:3,  cargoBonus:10, label:'Ship',         requires:'coastal' },
};

function isCityCoastal(city) {
  if (!city || city.mx === undefined) return false;
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const x = wrapX(city.mx+dx), y = city.my+dy;
      if (y >= 0 && y < MAP_H && isWater(x, y)) return true;
    }
  return false;
}

function bestTravelMode(origin, dest) {
  const pairKey = [origin.id, dest.id].sort().join('-');
  const tiers = G.roadGraph?.[pairKey];
  if (tiers?.railroad) return 'train';
  if (tiers?.asphalt) return 'car';
  if (tiers?.gravel || tiers?.path) return 'cart';
  if (isCityCoastal(origin) && isCityCoastal(dest)) return 'ship';
  return 'walk';
}
```

Keep `VEHICLE_TYPES` temporarily for backward compat during migration (will remove in Task 5).

**Step 2: Run tests**

Run: `npm test`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add public/game-worker.js
git commit -m "feat: add TRAVEL_MODES config and bestTravelMode helper"
```

---

### Task 3: Implement `tryTravel` and `aiTravel` — the new travel system

**Files:**
- Modify: `public/game-worker.js`

**Step 1: Write `tryTravel(d)` — replaces trySeaSailing + tryBoardVehicle + tryDriveVehicle**

Add after `bestTravelMode`:

```js
function tryTravel(d) {
  const city = cityOf(d);
  if (!city || !city.res) return false;
  // Pick a destination city
  const others = CITIES.filter(c => c.id !== city.id && c.mx !== undefined);
  if (!others.length) return false;
  // Prefer closer cities, weighted random
  others.sort((a,b) => {
    const da = Math.min(Math.abs(a.mx-city.mx), MAP_W-Math.abs(a.mx-city.mx)) + Math.abs(a.my-city.my);
    const db = Math.min(Math.abs(b.mx-city.mx), MAP_W-Math.abs(b.mx-city.mx)) + Math.abs(b.my-city.my);
    return da - db;
  });
  const pool = others.slice(0, 5);
  const dest = pool[Math.floor(Math.random() * pool.length)];
  const mode = bestTravelMode(city, dest);
  const tm = TRAVEL_MODES[mode];
  // For ship mode: need BFS water path
  if (mode === 'ship') {
    // Find water near origin and destination
    let originW = null, destW = null;
    for (let dy = -4; dy <= 4 && !originW; dy++)
      for (let dx = -4; dx <= 4 && !originW; dx++) {
        const x = wrapX(city.mx+dx), y = city.my+dy;
        if (y >= 0 && y < MAP_H && isWater(x, y)) originW = {x, y};
      }
    for (let dy = -4; dy <= 4 && !destW; dy++)
      for (let dx = -4; dx <= 4 && !destW; dx++) {
        const x = wrapX(dest.mx+dx), y = dest.my+dy;
        if (y >= 0 && y < MAP_H && isWater(x, y)) destW = {x, y};
      }
    if (!originW || !destW) return false;
    const waterPath = bfsWater(originW.x, originW.y, (x,y) => x === destW.x && y === destW.y);
    if (!waterPath || waterPath.length === 0) return false;
    d.path = waterPath;
  } else if (mode !== 'walk') {
    // Land vehicle: use road pathfinding
    const minRoad = mode === 'train' ? T.RAILROAD : mode === 'car' ? T.ASPHALT : T.PATH;
    const vPath = findVehicleRoute(city, dest, minRoad);
    if (!vPath || vPath.length === 0) return false;
    d.path = vPath;
  } else {
    // Walk: BFS to destination city
    const wp = bfs(d.x, d.y, (x,y) => Math.abs(x-dest.mx) <= 2 && Math.abs(y-dest.my) <= 2 && isWalkable(x,y), false);
    if (!wp || wp.length > 200) return false;
    d.path = wp;
  }
  d.state = 'traveling';
  d.travelMode = mode;
  d.target = { type:'travel', destCityId:dest.id };
  // Load cargo for trade
  if (city.res && d.carrying > 0 && d.carryItems) {
    // Already carrying goods — take them along
  }
  log(`${d.name} ${tm.emoji} traveling to ${dest.name} by ${tm.label}`, 'system', 2, null, d.x, d.y);
  addEvent(d, 'travel', `${tm.label} to ${dest.name}`);
  return true;
}
```

**Step 2: Write `aiTravel(d)` — replaces aiSail + aiDrive + aiRide**

```js
function aiTravel(d) {
  if (!d.path || d.path.length === 0) {
    // Arrived
    const dest = CITIES.find(c => c.id === d.target?.destCityId);
    if (dest) {
      d.cityId = dest.id;
      if (d.travelMode === 'ship') {
        // Place dwarf on land near destination
        const dirs = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[-1,-1],[1,1],[-1,1]];
        for (const [ddx,ddy] of dirs) {
          const lx = wrapX(dest.mx+ddx), ly = dest.my+ddy;
          if (ly >= 0 && ly < MAP_H && isWalkable(lx, ly)) { d.x = lx; d.y = ly; break; }
        }
      }
      // Deliver carried goods
      if (d.carryItems && dest.res) {
        for (const [k,v] of Object.entries(d.carryItems)) {
          if (dest.res[k] !== undefined) dest.res[k] += v;
        }
        const amt = d.carrying || 0;
        if (amt > 0) {
          log(`${d.name} delivered ${amt} goods to ${dest.name}`, 'trade', 2, null, d.x, d.y);
        }
        d.carryItems = {}; d.carrying = 0;
      }
      log(`${d.name} arrived at ${dest.name}`, 'system', 2, null, d.x, d.y);
      addEvent(d, 'travel', `Arrived at ${dest.name}`);
    }
    d.state = 'idle'; d.target = null; d.travelMode = null;
    return;
  }
  // Move along path — speed = tiles per tick
  const mode = TRAVEL_MODES[d.travelMode] || TRAVEL_MODES.walk;
  const steps = Math.min(mode.speed, d.path.length);
  for (let i = 0; i < steps; i++) {
    const [nx, ny] = d.path.shift();
    d.x = nx; d.y = ny;
  }
  // Needs while traveling
  if (d.hunger < 30 && d.carryItems?.food > 0) {
    d.carryItems.food--; d.carrying = Math.max(0, (d.carrying||0)-1);
    d.hunger = Math.min(100, d.hunger + 30);
  }
  if (d.energy < 20) d.energy = Math.min(100, d.energy + 1);
}
```

**Step 3: Wire `aiTravel` into the state machine**

In the `switch(d.state)` block (around line 560-580), add:
```js
case 'traveling': aiTravel(d); break;
```

Replace the `trySeaSailing` and `tryBoardVehicle` calls in `aiIdle` (lines ~1055-1062) with:
```js
if (Math.random() < 0.12 && tryTravel(d)) return;
```

**Step 4: Run tests**

Run: `npm test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add public/game-worker.js
git commit -m "feat: implement tryTravel and aiTravel — dwarf travel modes"
```

---

### Task 4: Remove old ship/vehicle entity systems from game-worker.js

**Files:**
- Modify: `public/game-worker.js`

**Step 1: Remove these functions entirely:**

- `createShip` (line ~1433)
- `shipCargo` (line ~1436)
- `tickShip` (line ~1437)
- `tickShips` (line ~1449)
- `findShoreSpot` (line ~1450)
- `boardShip` (line ~1758)
- `aiSail` (line ~1782)
- `trySeaSailing` (line ~1965)
- `findNearbyShip` (line ~1952)
- `tryBuildShip` (line ~1734)
- `shipNameForCity` (line ~1412)
- `SHIP_NAMES` (line ~1383)
- `SHIP_COST` (line ~1381)
- `beachShip`/`launchShip` (already removed, but check)
- `createVehicle` (line ~45)
- `vehicleCargo` (line ~1603)
- `tickVehicle` (line ~1605)
- `tickVehicles` (line ~1655)
- `spawnVehicles` (line ~1657)
- `tickFreight` (line ~1692)
- `aiDrive` (line ~1066)
- `aiRide` (line ~1104)
- `tryBoardVehicle` (line ~882)
- `tryTradeCaravan` (line ~735) - if it uses vehicles
- `VEHICLE_TYPES` (line ~39)
- `MAX_VEHICLES` (line ~44)

**Step 2: Remove from state:**

In the `G` object initialization (line ~132):
- Remove `ships:[]` and `vehicles:[]`

In the state machine switch:
- Remove `case 'sailing':`, `case 'driving':`, `case 'riding':`

In state snapshot (save/serialize, lines ~2890-2910):
- Remove `ships:G.ships.map(...)`
- Remove `vehicles:G.vehicles.map(...)`

In state load (lines ~2827-2840):
- Remove ship/vehicle restoration

**Step 3: Clean up references:**

- In `tickAll` or main loop: remove `tickShips()`, `tickVehicles()`, `spawnVehicles()`, `tickFreight()` calls
- In `aiIdle`: remove `trySeaSailing`, `tryBoardVehicle`, `tryTradeCaravan` calls (replaced by `tryTravel` in Task 3)
- Any `d.state === 'sailing'` or `d.state === 'driving'` or `d.state === 'riding'` checks

**Step 4: Run tests**

Run: `npm test`
Expected: Some tests may fail (ship-beaching tests, vehicle-transport tests). Delete those test files.

**Step 5: Delete obsolete test files**

- Delete: `tests/ship-beaching.test.ts`
- Delete: `tests/vehicle-transport.test.ts`

**Step 6: Run tests again**

Run: `npm test`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove ship/vehicle entity systems, replaced by travel modes"
```

---

### Task 5: Update index.html — remove ship/vehicle rendering, update HUD

**Files:**
- Modify: `public/index.html`

**Step 1: Remove ship rendering (lines ~4006-4032)**

Delete the "Draw ships" block.

**Step 2: Remove vehicle rendering (lines ~4036-4052)**

Delete the "Draw vehicles" block.

**Step 3: Update dwarf emoji rendering**

Where dwarf emoji is selected (line ~3979), add `'traveling'` state:
```js
d.state === 'traveling' ? (TRAVEL_MODES[d.travelMode]?.emoji || '\uD83D\uDEB6') : ...
```

Note: `TRAVEL_MODES` needs to be defined in index.html too (or sent from worker). Simplest: duplicate the emoji map:
```js
const TRAVEL_EMOJIS = { walk:'\uD83D\uDEB6', cart:'\uD83D\uDC34', car:'\uD83D\uDE97', train:'\uD83D\uDE82', ship:'\u26F5' };
```

**Step 4: Update HUD**

Replace the Ships HUD stat (line 339):
```html
<div class="hud-stat" id="hud-travel-wrap" title="Traveling dwarves"><div class="label">Travel</div><div class="value" id="h-travel">0</div></div>
```

Update the HUD refresh (line ~4155) to show traveling count:
```js
const travelers = G.dwarves.filter(d => d.state === 'traveling');
document.getElementById('h-travel').textContent = travelers.length > 0
  ? travelers.length + ' traveling' : '0';
```

**Step 5: Remove ships panel click handler (lines ~5869-5904)**

Replace with travel panel showing traveling dwarves:
```js
document.getElementById('hud-travel-wrap').onclick = () => {
  positionInspectorBelow(document.getElementById('hud-travel-wrap'));
  const travelers = G.dwarves.filter(d => d.state === 'traveling');
  inspTitle.textContent = 'Travel (' + travelers.length + ')';
  // ... show list of traveling dwarves with mode emoji and destination
};
```

**Step 6: Remove ship inspector (`showShipInspector`)**

Remove the function and any calls to it.

**Step 7: Remove ship/vehicle references from:**
- Save/load in index.html (lines ~5684, ~6226, ~6232, ~6362-6363, ~6435-6436)
- Click handler for map tiles (line ~4280-4288)
- Search results (line ~5428-5432)
- `centerOnShip` function
- `VEHICLE_EMOJIS`
- Fallback tick functions for ships/vehicles
- `POP_STATE_EMOJIS` — add `traveling` emoji, remove `sailing`/`driving`/`riding`
- Mobile CSS hiding ships panel (line 232)

**Step 8: Run tests**

Run: `npm test`
Expected: ALL PASS

**Step 9: Commit**

```bash
git add public/index.html
git commit -m "feat: update UI for travel modes, remove ship/vehicle rendering"
```

---

### Task 6: Update serialization for travel mode

**Files:**
- Modify: `public/game-worker.js`

**Step 1: Add travelMode to dwarf serialization**

In the state snapshot (where dwarves are serialized), add `travelMode` field:
```js
travelMode: d.travelMode || null,
```

In the load/restore, add:
```js
travelMode: sd.travelMode || null,
```

**Step 2: Remove ships/vehicles from worker→main state sync**

In the `postMessage` that sends state to main thread, remove `ships` and `vehicles` arrays.

**Step 3: Run tests**

Run: `npm test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add public/game-worker.js
git commit -m "feat: serialize travelMode on dwarves, remove ship/vehicle state"
```

---

### Task 7: Update README, bump version, test, deploy

**Files:**
- Modify: `README.md`
- Modify: `package.json`

**Step 1: Update README Ships & Sea Travel section**

Replace the "Ships & Sea Travel" section with:
```markdown
### Travel Modes
- Dwarves travel between cities using the best available transport
- **Walking** (default): speed 1x, no cargo bonus
- **Horse Cart**: requires PATH/gravel road, speed 2x, +8 cargo
- **Car**: requires ASPHALT road, speed 4x, +15 cargo
- **Train**: requires RAILROAD, speed 6x, +40 cargo
- **Ship**: requires both cities coastal (no land route), speed 3x, +10 cargo
- Land routes always preferred over sea routes
- Dwarf emoji changes to match travel mode while in transit
- Goods carried are delivered to destination city on arrival
```

**Step 2: Bump version to 2.13.0**

**Step 3: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 4: Commit, push, deploy**

```bash
git add -A
git commit -m "docs: update README for travel modes, bump to v2.13.0"
git push
npm run deploy
```

**Step 5: Tag release**

```bash
git tag v2.13.0
git push --tags
```
