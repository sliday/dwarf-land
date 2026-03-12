// ============================================================
// DWARF LAND - Game Worker (Simulation Thread)
// ============================================================
const TILE = 20, MAP_W = 2000, MAP_H = 1000;
const T = {
  OCEAN:0,TUNDRA:1,TAIGA:2,FOREST:3,PLAINS:4,DESERT:5,JUNGLE:6,MOUNTAIN:7,
  HILL:8,BEACH:9,FLOOR:10,WALL:11,STOCKPILE:12,BED:13,TABLE:14,DOOR:15,
  MUSHROOM:16,FARM:17,CITY:18,D_MINE:19,D_BUILD:20,D_FARM:21,
  IRON_ORE:22,GOLD_VEIN:23,GEMS:24,BERRY_BUSH:25,HERB_PATCH:26,CLAY:27,
  FISH_SPOT:28,DEER:29,CORAL:30,CRAB:31,ROAD:32,D_ROAD:33,RAILROAD:34
};
const WALKABLE = new Set([
  T.TUNDRA,T.TAIGA,T.FOREST,T.PLAINS,T.DESERT,T.JUNGLE,T.HILL,T.BEACH,T.MOUNTAIN,
  T.FLOOR,T.STOCKPILE,T.BED,T.TABLE,T.DOOR,T.MUSHROOM,T.FARM,T.CITY,
  T.D_MINE,T.D_FARM,T.D_ROAD,T.ROAD,T.RAILROAD,
  T.BERRY_BUSH,T.HERB_PATCH,T.CLAY,T.DEER,T.CRAB
]);
const WILD_FOOD = new Set([T.MUSHROOM,T.BERRY_BUSH,T.CRAB]);
const GATHERABLE = new Set([T.BERRY_BUSH,T.HERB_PATCH,T.IRON_ORE,T.GOLD_VEIN,T.GEMS,T.FISH_SPOT,T.CRAB,T.DEER,T.CLAY,T.CORAL]);
const STARVE_IMMOBILE = 2000, STARVE_DEATH = 2667;
const SEASONS = ['Spring','Summer','Autumn','Winter'];
const TERRAIN_PROPS = {
  [T.OCEAN]:{speed:0},[T.TUNDRA]:{speed:2},[T.TAIGA]:{speed:2},[T.FOREST]:{speed:2},
  [T.PLAINS]:{speed:1},[T.DESERT]:{speed:1.5},[T.JUNGLE]:{speed:3},[T.MOUNTAIN]:{speed:5},
  [T.HILL]:{speed:2},[T.BEACH]:{speed:1},[T.FLOOR]:{speed:1},[T.WALL]:{speed:0},
  [T.STOCKPILE]:{speed:1},[T.BED]:{speed:1},[T.TABLE]:{speed:1},[T.DOOR]:{speed:1},
  [T.MUSHROOM]:{speed:1},[T.FARM]:{speed:1},[T.CITY]:{speed:1},
  [T.D_MINE]:{speed:1},[T.D_BUILD]:{speed:0},[T.D_FARM]:{speed:1},[T.D_ROAD]:{speed:1},
  [T.ROAD]:{speed:0.5},[T.IRON_ORE]:{speed:4},[T.GOLD_VEIN]:{speed:4},[T.GEMS]:{speed:4},
  [T.BERRY_BUSH]:{speed:1},[T.HERB_PATCH]:{speed:1},[T.CLAY]:{speed:1},
  [T.FISH_SPOT]:{speed:0},[T.DEER]:{speed:1},[T.CORAL]:{speed:0},[T.CRAB]:{speed:1},
  [T.RAILROAD]:{speed:0.2},
};
const SHIP_COST = { wood:10, cloth:3, iron:2 }, SHIP_CARGO_MAX = 20;
const MAX_INVENTORY = 6;
const TERRAIN_CRAFT_ITEMS = {
  [T.OCEAN]:{emoji:'💧',name:'Water'},[T.FISH_SPOT]:{emoji:'💧',name:'Water'},
  [T.BEACH]:{emoji:'🌎',name:'Earth'},[T.CLAY]:{emoji:'🌎',name:'Earth'},
  [T.MOUNTAIN]:{emoji:'🌎',name:'Earth'},[T.HILL]:{emoji:'🌎',name:'Earth'},
  [T.IRON_ORE]:{emoji:'🪨',name:'Stone'},[T.FOREST]:{emoji:'🌲',name:'Wood'},
  [T.TAIGA]:{emoji:'🌲',name:'Wood'},[T.JUNGLE]:{emoji:'🌱',name:'Plant'},
  [T.BERRY_BUSH]:{emoji:'🌱',name:'Plant'},[T.HERB_PATCH]:{emoji:'🌱',name:'Plant'},
  [T.DESERT]:{emoji:'🏖️',name:'Sand'},[T.TUNDRA]:{emoji:'💨',name:'Wind'},
  [T.GOLD_VEIN]:{emoji:'🌎',name:'Earth'},[T.GEMS]:{emoji:'🔥',name:'Fire'},
  [T.CORAL]:{emoji:'💧',name:'Water'},[T.CRAB]:{emoji:'💧',name:'Water'},
  [T.DEER]:{emoji:'🌱',name:'Plant'},
};

// Populated from init message
let CITIES = [], CULTURES = {}, DWARF_NAMES = [], SURNAMES = [];
let AI_API_BASE = '';

// Worker state
const G = {
  map:[], tick:0, speed:1, paused:false,
  year:1, season:0,
  dwarves:[], usedNames:new Set(),
  ships:[], stats:{mined:0,built:0,farmed:0},
  homeCity:null, aiCityIndex:0, dwarfGrid:{},
};

// Message buffers
const pendingLogs = [], pendingToasts = [], pendingMapChanges = [];
function log(msg, type) { pendingLogs.push({msg,type}); }
function mapSet(x, y, tile) { G.map[y][x] = tile; pendingMapChanges.push({x,y,tile}); }

// Helpers
function wrapX(x) { return ((x % MAP_W) + MAP_W) % MAP_W; }
function cityById(id) { return CITIES.find(c => c.id === id); }
function cityOf(d) { return cityById(d.cityId) || CITIES[0]; }
function nearestCity(x, y) {
  let best = null, bestDist = Infinity;
  for (const c of CITIES) {
    if (c.mx === undefined) continue;
    const dx = Math.min(Math.abs(c.mx - x), MAP_W - Math.abs(c.mx - x));
    const dy = c.my - y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  return best;
}
function defaultRes() { return {stone:0,wood:0,food:50,iron:0,gold:0,cloth:0,ale:0,herbs:0,beds:0,tables:0}; }

// Pathfinding
function isWalkable(x, y) {
  if (y < 0 || y >= MAP_H) return false;
  const t = G.map[y][wrapX(x)];
  if (WALKABLE.has(t)) return true;
  const props = TERRAIN_PROPS[t];
  return props && props.speed > 0;
}
function terrainCost(x, y) {
  if (y < 0 || y >= MAP_H) return Infinity;
  const t = G.map[y][wrapX(x)];
  const props = TERRAIN_PROPS[t];
  if (!props || props.speed <= 0) return Infinity;
  return props.speed;
}
class MinHeap {
  constructor() { this.h = []; }
  push(node) { this.h.push(node); this._up(this.h.length - 1); }
  pop() {
    const top = this.h[0], last = this.h.pop();
    if (this.h.length > 0) { this.h[0] = last; this._down(0); }
    return top;
  }
  get length() { return this.h.length; }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.h[p][0] <= this.h[i][0]) break;
      [this.h[p], this.h[i]] = [this.h[i], this.h[p]]; i = p;
    }
  }
  _down(i) {
    const n = this.h.length;
    while (true) {
      let s = i, l = 2*i+1, r = 2*i+2;
      if (l < n && this.h[l][0] < this.h[s][0]) s = l;
      if (r < n && this.h[r][0] < this.h[s][0]) s = r;
      if (s === i) break;
      [this.h[s], this.h[i]] = [this.h[i], this.h[s]]; i = s;
    }
  }
}
function bfs(sx, sy, goalFn, walkToGoal) {
  const key = (x, y) => wrapX(x) + y * MAP_W;
  const pq = new MinHeap();
  pq.push([0, sx, sy]);
  const dist = new Map(); dist.set(key(sx, sy), 0);
  const par = new Map();
  const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
  let steps = 0;
  while (pq.length > 0 && steps < 2000) {
    const [cost, cx, cy] = pq.pop(); steps++;
    const ck = key(cx, cy);
    if (cost > (dist.get(ck) ?? Infinity)) continue;
    if (goalFn(wrapX(cx), cy) && !(cx === sx && cy === sy)) {
      const path = []; let cur = [cx, cy];
      while (cur[0] !== sx || cur[1] !== sy) { path.unshift([wrapX(cur[0]), cur[1]]); cur = par.get(key(cur[0], cur[1])); }
      return path;
    }
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      const nk = key(nx, ny);
      const isGoal = walkToGoal && goalFn(wrapX(nx), ny);
      const tc = isGoal ? 1 : terrainCost(nx, ny);
      if (tc === Infinity) continue;
      const nc = cost + tc;
      if (nc < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nc); par.set(nk, [cx, cy]); pq.push([nc, nx, ny]);
      }
    }
  }
  return null;
}
function adjWalkable(tx, ty) {
  for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]])
    if (isWalkable(tx + dx, ty + dy)) return [wrapX(tx + dx), ty + dy];
  return null;
}
function isWater(x, y) {
  if (y < 0 || y >= MAP_H) return false;
  const t = G.map[y][wrapX(x)];
  return t === T.OCEAN || t === T.FISH_SPOT || t === T.CORAL;
}
function isCoastal(x, y) {
  if (!isWalkable(x, y)) return false;
  for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]])
    if (isWater(wrapX(x + dx), y + dy)) return true;
  return false;
}
function bfsWater(sx, sy, goalFn) {
  const key = (x, y) => wrapX(x) + y * MAP_W;
  const queue = [[sx, sy]];
  const visited = new Set([key(sx, sy)]);
  const par = new Map();
  const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
  let steps = 0;
  while (queue.length > 0 && steps < 6000) {
    const [cx, cy] = queue.shift(); steps++;
    if (goalFn(wrapX(cx), cy) && !(cx === sx && cy === sy)) {
      const path = []; let cur = [cx, cy];
      while (cur[0] !== sx || cur[1] !== sy) { path.unshift([wrapX(cur[0]), cur[1]]); cur = par.get(key(cur[0], cur[1])); }
      return path;
    }
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      const nk = key(nx, ny);
      if (visited.has(nk)) continue;
      if (!isWater(nx, ny) && !goalFn(wrapX(nx), ny)) continue;
      visited.add(nk);
      par.set(nk, [cx, cy]);
      queue.push([nx, ny]);
    }
  }
  return null;
}

// Stats
function roll3d6() {
  return (Math.floor(Math.random()*6)+1)+(Math.floor(Math.random()*6)+1)+(Math.floor(Math.random()*6)+1);
}
function statMod(stat) { return 0.5 + ((stat - 3) / 15); }
function ageModifiers(age) {
  if (age < 25) return {STR:0,DEX:1,CON:0,INT:0,WIS:-1,CHA:0};
  if (age <= 50) return {STR:0,DEX:0,CON:0,INT:0,WIS:0,CHA:0};
  if (age <= 70) return {STR:0,DEX:-1,CON:0,INT:1,WIS:1,CHA:0};
  return {STR:-2,DEX:-1,CON:-1,INT:0,WIS:2,CHA:0};
}
function effectiveStat(d, stat) {
  const base = d.stats?.[stat] ?? 10;
  const mod = ageModifiers(d.age || 30);
  return Math.max(3, base + (mod[stat] || 0));
}
function carryCapacity(d) { return 3 + Math.floor(effectiveStat(d, 'STR') / 4); }
function addCarry(d, resource, amount) {
  if (!d.carryItems) d.carryItems = {};
  d.carryItems[resource] = (d.carryItems[resource] || 0) + amount;
  d.carrying = (d.carrying || 0) + amount;
}
function depositCarry(d) {
  if (!d.carryItems || d.carrying <= 0) return;
  const res = cityOf(d).res;
  if (!res) return;
  for (const [k, v] of Object.entries(d.carryItems)) {
    if (res[k] !== undefined) res[k] += v;
  }
  const total = d.carrying;
  d.carryItems = {}; d.carrying = 0;
  return total;
}

// Craft inventory
function addInventoryItem(d, item) {
  if (!d.inventory) d.inventory = [];
  if (d.inventory.length >= MAX_INVENTORY) return false;
  d.inventory.push({emoji:item.emoji,name:item.name});
  return true;
}
function tryCraftInventoryGain(d, tileType) {
  const item = TERRAIN_CRAFT_ITEMS[tileType];
  if (item && Math.random() < 0.5) addInventoryItem(d, item);
}

// Dwarf creation
function createDwarf(x, y, cityId) {
  const city = cityById(cityId);
  const culture = city ? CULTURES[city.culture] : null;
  let first, last;
  if (culture) {
    first = culture.firstNames[Math.floor(Math.random()*culture.firstNames.length)];
    last = culture.lastNames[Math.floor(Math.random()*culture.lastNames.length)];
  } else {
    first = DWARF_NAMES[Math.floor(Math.random()*DWARF_NAMES.length)];
    last = SURNAMES[Math.floor(Math.random()*SURNAMES.length)];
  }
  const culturalTrait = culture ? culture.traits[Math.floor(Math.random()*culture.traits.length)] : null;
  return {
    id:'d_'+Math.random().toString(36).slice(2,8),
    name:first+' '+last, x, y, cityId:cityId||'',
    hunger:80+Math.random()*20, energy:80+Math.random()*20,
    happiness:70+Math.random()*20,
    state:'idle', target:null, path:[], timer:0,
    color:`hsl(${Math.floor(Math.random()*360)},55%,55%)`,
    stats:{STR:roll3d6(),DEX:roll3d6(),CON:roll3d6(),INT:roll3d6(),WIS:roll3d6(),CHA:roll3d6()},
    faith:Math.floor(Math.random()*101),
    morality:Math.floor(Math.random()*101),
    ambition:Math.floor(Math.random()*101),
    traits:culturalTrait?[culturalTrait]:[],
    backstory:'', eventLog:[],
    age:20+Math.floor(Math.random()*30),
    carrying:0, carryItems:{}, inventory:[],
  };
}
function findNearbyLand(cx, cy) {
  if (isWalkable(cx, cy)) return [cx, cy];
  for (let r = 1; r <= 15; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
      const nx = wrapX(cx + dx), ny = cy + dy;
      if (ny >= 0 && ny < MAP_H && isWalkable(nx, ny)) return [nx, ny];
    }
  return null;
}
function spawnDwarfAtCity(city) {
  if (!city || city.mx === undefined) return;
  const cityPop = G.dwarves.filter(d => d.cityId === city.id).length;
  if (cityPop >= 10) return;
  if (G.dwarves.length >= 300) return;
  const hx = city.mx, hy = city.my;
  let x, y, tries = 0;
  do { x = wrapX(hx+Math.floor(Math.random()*6-3)); y = hy+Math.floor(Math.random()*4-2); tries++; }
  while (!isWalkable(x,y) && tries < 80);
  if (!isWalkable(x,y)) {
    const land = findNearbyLand(hx, hy);
    if (!land) return;
    x = land[0]; y = land[1];
  }
  const d = createDwarf(x, y, city.id);
  G.dwarves.push(d);
  log(`${d.name} has arrived at ${city.name}!`, 'system');
  backstoryQueue.push(d);
}
function spawnDwarf() {
  if (!G.homeCity) return;
  spawnDwarfAtCity(G.homeCity);
}

// Backstory queue
const backstoryQueue = [];
let backstoryDraining = false;
async function drainBackstoryQueue() {
  if (backstoryDraining || backstoryQueue.length === 0) return;
  backstoryDraining = true;
  const batch = backstoryQueue.splice(0, Math.min(10, backstoryQueue.length));
  const items = batch.filter(d => !d.backstory).map(d => ({
    id:d.id, name:d.name, stats:d.stats,
    faith:d.faith, morality:d.morality, ambition:d.ambition,
    cityName:cityOf(d)?.name || G.homeCity?.name,
  }));
  if (items.length > 0) {
    try {
      const resp = await fetch(`${AI_API_BASE}/api/backstory/batch`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({dwarves:items}),
      });
      if (resp.ok) {
        const data = await resp.json();
        for (const result of (data.results||[])) {
          const d = batch.find(b => b.id === result.id);
          if (!d) continue;
          if (result.backstory) d.backstory = result.backstory;
          if (result.traits?.length) d.traits = result.traits;
          if (result.name && result.name !== d.name) d.name = result.name;
          addEvent(d, 'born', d.backstory || 'Arrived at the colony');
        }
      }
    } catch (e) {}
  }
  backstoryDraining = false;
}
setInterval(drainBackstoryQueue, 15000);

// Event log
function addEvent(d, type, desc) {
  if (!d.eventLog) d.eventLog = [];
  d.eventLog.push({tick:G.tick, type, description:desc});
  if (d.eventLog.length > 50) d.eventLog.shift();
}

// Dwarf AI
function tickDwarf(d) {
  if (d.state !== 'sailing' && !isWalkable(d.x, d.y)) {
    const city = cityOf(d);
    if (city.mx !== undefined) {
      const land = findNearbyLand(city.mx, city.my) || findNearbyLand(d.x, d.y);
      if (land) {
        d.x = land[0]; d.y = land[1];
        d.state = 'idle'; d.target = null; d.path = [];
        log(`${d.name} was rescued from the sea!`, 'system');
      }
    }
  }
  d.hunger = Math.max(0, d.hunger - 0.03);
  d.energy = Math.max(0, d.energy - 0.02);
  d.happiness = Math.max(0, Math.min(100, d.happiness - 0.005));
  if (d.hunger <= 0) {
    d.starveTicks = (d.starveTicks || 0) + 1;
    if (d.starveTicks >= STARVE_DEATH) {
      log(`${d.name} \u2620\uFE0F starved to death`, 'system');
      addEvent(d, 'death', 'Died of starvation');
      d.dead = true; return;
    }
    if (d.starveTicks >= STARVE_IMMOBILE && d.state !== 'starving') {
      d.state = 'starving'; d.target = null; d.path = [];
      log(`${d.name} \uD83D\uDE35 is too weak to move \u2014 needs food!`, 'system');
    }
  } else { d.starveTicks = 0; }
  if (d.state === 'starving') { tryShareFood(d); return; }
  if (d.hunger < 20 && d.state !== 'eating' && d.state !== 'going_eat'
      && d.state !== 'wander' && d.state !== 'seek_food') {
    d.state = 'seek_food'; d.target = null; d.path = [];
  } else if (d.energy < 15 && d.state !== 'sleeping' && d.state !== 'going_sleep'
      && d.state !== 'wander' && d.state !== 'seek_sleep') {
    d.state = 'seek_sleep'; d.target = null; d.path = [];
  }
  switch (d.state) {
    case 'idle': aiIdle(d); break;
    case 'walk': aiWalk(d); break;
    case 'mining': aiMine(d); break;
    case 'building': aiBuild(d); break;
    case 'farming': aiFarm(d); break;
    case 'gathering': aiGather(d); break;
    case 'seek_food': aiSeekFood(d); break;
    case 'going_eat': aiWalk(d); break;
    case 'eating': aiEat(d); break;
    case 'seek_sleep': aiSeekSleep(d); break;
    case 'going_sleep': aiWalk(d); break;
    case 'sleeping': aiSleep(d); break;
    case 'wander': aiWander(d); break;
    case 'hauling': aiWalk(d); break;
    case 'seek_craft': aiSeekCraft(d); break;
    case 'crafting': aiCraft(d); break;
    case 'sailing': aiSail(d); break;
    case 'going_rescue': aiWalk(d); break;
  }
}

function seekDeposit(d) {
  if ((d.carrying||0) <= 0) return false;
  const sp = bfs(d.x, d.y, (x,y) => G.map[y][x] === T.STOCKPILE || G.map[y][x] === T.CITY, false);
  if (sp) { d.target = {type:'deposit'}; d.path = sp; d.state = 'hauling'; return true; }
  depositCarry(d);
  return false;
}
function nearbyDwarves(x, y) {
  const bx = x >> 3, by = y >> 3, result = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const bucket = G.dwarfGrid?.[`${bx+dx},${by+dy}`];
    if (bucket) for (const d of bucket) result.push(d);
  }
  return result;
}
function tryShareFood(d) {
  if (d.hunger >= 30) return;
  for (const other of nearbyDwarves(d.x, d.y)) {
    if (other.id === d.id || other.cityId !== d.cityId) continue;
    const dx = Math.abs(other.x - d.x), dy = Math.abs(other.y - d.y);
    if (dx > 1 || dy > 1) continue;
    if (!other.carryItems?.food || other.carryItems.food < 1) continue;
    const attractiveness = (d.morality ?? 50) + (d.stats?.CHA ?? 10) * 2;
    const otherGenerosity = (other.morality ?? 50) + (other.stats?.CHA ?? 10);
    const rel = (other.relationships || []).find(r => r.targetId === d.id);
    if (rel && (rel.type === 'enemy' || rel.strength < -50)) continue;
    const threshold = 80 - otherGenerosity * 0.3;
    if (attractiveness < threshold) continue;
    const shareAmt = Math.min(other.carryItems.food, 2);
    other.carryItems.food -= shareAmt; other.carrying -= shareAmt;
    d.hunger = Math.min(100, d.hunger + shareAmt * 12);
    log(`${other.name} \uD83E\uDD1D shared food with ${d.name}`, 'eat');
    addEvent(d, 'social', `${other.name} shared food`);
    addEvent(other, 'social', `Shared food with ${d.name}`);
    d.happiness = Math.min(100, d.happiness + 3);
    other.happiness = Math.min(100, other.happiness + 2);
    return true;
  }
  return false;
}
function tryTrade(d) {
  if (!d.inventory?.length) return false;
  for (const other of nearbyDwarves(d.x, d.y)) {
    if (other.id === d.id || other.cityId === d.cityId) continue;
    if (other.x !== d.x || other.y !== d.y) continue;
    if (other.state !== 'idle' && other.state !== 'wander') continue;
    if (!other.inventory?.length) continue;
    const isHostile = (d.relationships||[]).some(r => r.targetId === other.id && (r.type === 'enemy' || r.strength < -50))
      || (other.relationships||[]).some(r => r.targetId === d.id && (r.type === 'enemy' || r.strength < -50));
    if (isHostile) continue;
    if (Math.random() > 0.3) continue;
    const intD = effectiveStat(d, 'INT'), intO = effectiveStat(other, 'INT');
    const intDiff = intD - intO;
    if (intDiff >= 5) {
      const give = d.inventory.shift();
      const get1 = other.inventory.shift();
      const get2 = other.inventory.length > 0 ? other.inventory.shift() : null;
      if (give) other.inventory.push(give);
      if (get1) d.inventory.push(get1);
      if (get2) d.inventory.push(get2);
      const gaveStr = give ? give.emoji+give.name : '?';
      const gotStr = [get1,get2].filter(Boolean).map(i => i.emoji+i.name).join(', ') || '?';
      log(`${d.name} \uD83E\uDD1D outsmarted ${other.name}: gave ${gaveStr}, got ${gotStr}`, 'trade');
      addEvent(d, 'trade', `Gave ${gaveStr} to ${other.name}, got ${gotStr} (favorable)`);
      addEvent(other, 'trade', `Gave ${gotStr} to ${d.name}, got ${gaveStr} (unfavorable)`);
    } else if (intDiff <= -5) {
      const give1 = d.inventory.shift();
      const give2 = d.inventory.length > 0 ? d.inventory.shift() : null;
      const get = other.inventory.shift();
      if (give1) other.inventory.push(give1);
      if (give2) other.inventory.push(give2);
      if (get) d.inventory.push(get);
      const gaveStr = [give1,give2].filter(Boolean).map(i => i.emoji+i.name).join(', ') || '?';
      const gotStr = get ? get.emoji+get.name : '?';
      log(`${other.name} \uD83E\uDD1D outsmarted ${d.name}: ${d.name} gave ${gaveStr}, got ${gotStr}`, 'trade');
      addEvent(d, 'trade', `Gave ${gaveStr} to ${other.name}, got ${gotStr} (unfavorable)`);
      addEvent(other, 'trade', `Gave ${gotStr} to ${d.name}, got ${gaveStr} (favorable)`);
    } else {
      const give = d.inventory.shift();
      const get = other.inventory.shift();
      if (give) other.inventory.push(give);
      if (get) d.inventory.push(get);
      const gaveStr = give ? give.emoji+give.name : '?';
      const gotStr = get ? get.emoji+get.name : '?';
      log(`${d.name} \uD83E\uDD1D traded with ${other.name}: ${gaveStr} \u2194 ${gotStr}`, 'trade');
      addEvent(d, 'trade', `Traded ${gaveStr} for ${gotStr} with ${other.name}`);
      addEvent(other, 'trade', `Traded ${gotStr} for ${gaveStr} with ${d.name}`);
    }
    d.happiness = Math.min(100, d.happiness + 3);
    other.happiness = Math.min(100, other.happiness + 3);
    return true;
  }
  return false;
}

function aiIdle(d) {
  if (d._tickSlot === undefined) d._tickSlot = G.dwarves.indexOf(d) % 4;
  if (G.tick % 4 !== d._tickSlot) return;
  if (executeIntent(d)) return;
  if (d.carryItems?.food > 0) {
    const starving = G.dwarves.find(o => o.cityId === d.cityId && o.state === 'starving' && o.id !== d.id);
    if (starving) {
      const mp = bfs(d.x, d.y, (x,y) => x === starving.x && y === starving.y, true);
      if (mp && mp.length < 40) {
        d.target = {type:'rescue_feed',dwarfId:starving.id};
        d.path = mp.slice(0,-1);
        d.state = d.path.length > 0 ? 'going_rescue' : 'idle';
        if (d.state === 'idle') {
          const amt = Math.min(d.carryItems.food, 3);
          d.carryItems.food -= amt; d.carrying -= amt;
          starving.hunger = Math.min(100, starving.hunger + amt * 12);
          starving.starveTicks = 0; starving.state = 'idle';
          log(`${d.name} \uD83E\uDD1D rescued ${starving.name} with food!`, 'eat');
          d.target = null;
        }
        return;
      }
    }
  }
  if ((d.carrying||0) >= carryCapacity(d)) { if (seekDeposit(d)) return; }
  if (d.hunger < 20) tryShareFood(d);
  if (d.inventory?.length > 0 && tryTrade(d)) return;
  if ((d.inventory?.length||0) >= 2 && d.hunger > 40 && d.energy > 30 && Math.random() < 0.03) {
    d.state = 'seek_craft'; return;
  }
  const res = cityOf(d).res || {};
  if (d.hunger < 40 && res.food > 0) { d.state = 'seek_food'; return; }
  if (d.energy < 30) { d.state = 'seek_sleep'; return; }

  const minePath = bfs(d.x, d.y, (x,y) => G.map[y][x] === T.D_MINE, false);
  if (minePath) {
    const last = minePath[minePath.length-1];
    if (G.map[last[1]][last[0]] === T.D_MINE) {
      const adj = adjWalkable(last[0], last[1]);
      if (adj) {
        const p = bfs(d.x, d.y, (x,y) => x === adj[0] && y === adj[1], false);
        if (p) { d.target = {type:'mine',x:last[0],y:last[1]}; d.path = p; d.state = 'walk'; return; }
      }
    }
  }
  if (res.stone >= 2) {
    const bp = bfs(d.x, d.y, (x,y) => G.map[y][x] === T.D_BUILD, false);
    if (bp) {
      const last = bp[bp.length-1];
      if (G.map[last[1]][last[0]] === T.D_BUILD) {
        const adj = adjWalkable(last[0], last[1]);
        if (adj) {
          const p = bfs(d.x, d.y, (x,y) => x === adj[0] && y === adj[1], false);
          if (p) { d.target = {type:'build',x:last[0],y:last[1]}; d.path = p; d.state = 'walk'; return; }
        }
      }
    }
  }
  if (res.stone >= 1) {
    const rp = bfs(d.x, d.y, (x,y) => G.map[y][x] === T.D_ROAD, false);
    if (rp) {
      const last = rp[rp.length-1];
      if (G.map[last[1]][last[0]] === T.D_ROAD) {
        d.target = {type:'road',x:last[0],y:last[1]}; d.path = rp; d.state = 'walk'; return;
      }
    }
  }
  if (res.iron >= 3 && res.wood >= 2 && Math.random() < 0.15) {
    const rrp = bfs(d.x, d.y, (x,y) => G.map[y][x] === T.ROAD, false);
    if (rrp && rrp.length < 30) {
      const last = rrp[rrp.length-1];
      if (G.map[last[1]][last[0]] === T.ROAD) {
        d.target = {type:'upgrade_road',x:last[0],y:last[1]}; d.path = rrp; d.state = 'walk'; return;
      }
    }
  }
  const fp = bfs(d.x, d.y, (x,y) => G.map[y][x] === T.D_FARM, false);
  if (fp) {
    const last = fp[fp.length-1];
    if (G.map[last[1]][last[0]] === T.D_FARM) {
      d.target = {type:'farm',x:last[0],y:last[1]}; d.path = fp; d.state = 'walk'; return;
    }
  }
  if (res.wood < 10) {
    const tp = bfs(d.x, d.y, (x,y) => G.map[y][x] === T.TAIGA || G.map[y][x] === T.FOREST, false);
    if (tp) {
      const last = tp[tp.length-1];
      const adj = adjWalkable(last[0], last[1]);
      if (adj) {
        const p = bfs(d.x, d.y, (x,y) => x === adj[0] && y === adj[1], false);
        if (p) { d.target = {type:'chop',x:last[0],y:last[1]}; d.path = p; d.state = 'walk'; return; }
      }
    }
  }
  const gp = bfs(d.x, d.y, (x,y) => GATHERABLE.has(G.map[y][x]), false);
  if (gp && gp.length < 30) {
    const last = gp[gp.length-1];
    const tile = G.map[last[1]][last[0]];
    if (!isWalkable(last[0], last[1])) {
      const adj = adjWalkable(last[0], last[1]);
      if (adj) {
        const p = bfs(d.x, d.y, (x,y) => x === adj[0] && y === adj[1], false);
        if (p) { d.target = {type:'gather',x:last[0],y:last[1],tile}; d.path = p; d.state = 'walk'; return; }
      }
    } else {
      d.target = {type:'gather',x:last[0],y:last[1],tile}; d.path = gp; d.state = 'walk'; return;
    }
  }
  if (Math.random() < 0.005 && (d.carrying||0) >= carryCapacity(d)) {
    if (tryFoundCity(d)) return;
  }
  if (Math.random() < 0.02 && (d.ambition ?? 50) > 60) {
    if (trySeaSailing(d)) return;
  }
  d.state = 'wander'; d.timer = 20 + Math.floor(Math.random() * 40);
}

function aiWalk(d) {
  if (d.path.length === 0) {
    if (!d.target) { d.state = 'idle'; return; }
    const tt = d.target.type;
    if (tt === 'mine' || tt === 'chop') d.state = 'mining';
    else if (tt === 'build' || tt === 'road' || tt === 'upgrade_road') d.state = 'building';
    else if (tt === 'farm') d.state = 'farming';
    else if (tt === 'gather') d.state = 'gathering';
    else if (tt === 'eat') d.state = 'eating';
    else if (tt === 'sleep') d.state = 'sleeping';
    else if (tt === 'craft') d.state = 'crafting';
    else if (tt === 'deposit') {
      const total = depositCarry(d);
      if (total) { log(`${d.name} \uD83D\uDCE6 deposited ${total} items at stockpile`, 'haul'); addEvent(d, 'haul', `Deposited ${total} items`); }
      d.target = null; d.timer = 0; d.state = 'idle'; return;
    } else if (tt === 'rescue_feed') {
      const starving = G.dwarves.find(o => o.id === d.target.dwarfId);
      if (starving && d.carryItems?.food > 0) {
        const amt = Math.min(d.carryItems.food, 3);
        d.carryItems.food -= amt; d.carrying -= amt;
        starving.hunger = Math.min(100, starving.hunger + amt * 12);
        starving.starveTicks = 0; starving.state = 'idle';
        log(`${d.name} \uD83E\uDD1D rescued ${starving.name} with food!`, 'eat');
      }
      d.target = null; d.state = 'idle'; return;
    } else d.state = 'idle';
    d.timer = 0; return;
  }
  const [nx, ny] = d.path.shift();
  if (isWalkable(nx, ny)) { d.x = nx; d.y = ny; }
  else { d.path = []; d.target = null; d.state = 'idle'; }
}

function aiMine(d) {
  if (!d.target) { d.state = 'idle'; return; }
  d.timer++;
  const dur = Math.round(8 / statMod(effectiveStat(d, 'STR')));
  if (d.timer >= dur) {
    const {x,y} = d.target;
    const tile = G.map[y][x];
    if (tile === T.D_MINE || tile === T.MOUNTAIN || tile === T.HILL) {
      mapSet(x, y, T.FLOOR);
      const stoneAmt = 2 + Math.floor(Math.random() * 3);
      addCarry(d, 'stone', stoneAmt);
      G.stats.mined++;
      let extra = '';
      if (tile === T.MOUNTAIN && Math.random() < 0.4) { addCarry(d, 'iron', 1); extra += ' +1 iron!'; }
      if (tile === T.MOUNTAIN && Math.random() < 0.05) { addCarry(d, 'gold', 1); extra += ' +1 gold!'; }
      log(`${d.name} \u26cf\uFE0F mined ${stoneAmt} stone${extra}`, 'mine');
      addEvent(d, 'mine', `Mined ${stoneAmt} stone${extra}`);
      d.happiness = Math.min(100, d.happiness + 2);
      tryCraftInventoryGain(d, tile);
    } else if (d.target.type === 'chop' && (tile === T.FOREST || tile === T.TAIGA || tile === T.JUNGLE)) {
      mapSet(x, y, T.PLAINS);
      addCarry(d, 'wood', 3);
      log(`${d.name} \uD83EA93 chopped wood`, 'haul');
      addEvent(d, 'chop', 'Chopped wood');
      tryCraftInventoryGain(d, tile);
    }
    d.target = null; d.timer = 0;
    if ((d.carrying||0) >= carryCapacity(d)) seekDeposit(d) || (d.state = 'idle');
    else d.state = 'idle';
  }
}

function aiBuild(d) {
  if (!d.target) { d.state = 'idle'; return; }
  d.timer++;
  const dur = Math.round(10 / statMod(effectiveStat(d, 'STR')));
  if (d.timer >= dur) {
    const {x,y} = d.target;
    const res = cityOf(d).res;
    if (!res) { d.state = 'idle'; d.target = null; return; }
    if (G.map[y][x] === T.D_BUILD && res.stone >= 2) {
      res.stone -= 2; mapSet(x, y, T.WALL); G.stats.built++;
      log(`${d.name} 🧱 built a wall`, 'build');
      addEvent(d, 'build', 'Built a wall');
      d.happiness = Math.min(100, d.happiness + 3);
    } else if (G.map[y][x] === T.D_ROAD && res.stone >= 1) {
      res.stone -= 1; mapSet(x, y, T.ROAD); G.stats.built++;
      log(`${d.name} 🛤️ built a road`, 'build');
      addEvent(d, 'build', 'Built a road');
      d.happiness = Math.min(100, d.happiness + 2);
    } else if (d.target.type === 'upgrade_road' && G.map[y][x] === T.ROAD && res.iron >= 3 && res.wood >= 2) {
      res.iron -= 3; res.wood -= 2; mapSet(x, y, T.RAILROAD); G.stats.built++;
      log(`${d.name} 🚂 upgraded road to railroad!`, 'build');
      addEvent(d, 'build', 'Upgraded road to railroad');
      d.happiness = Math.min(100, d.happiness + 5);
    }
    d.target = null; d.timer = 0; d.state = 'idle';
  }
}

function aiFarm(d) {
  if (!d.target) { d.state = 'idle'; return; }
  d.timer++;
  const dur = Math.round(12 / statMod(effectiveStat(d, 'WIS')));
  if (d.timer >= dur) {
    const {x,y} = d.target;
    if (G.map[y][x] === T.D_FARM) {
      mapSet(x, y, T.FARM); G.stats.farmed++;
      log(`${d.name} 🌱 planted a farm`, 'farm');
      addEvent(d, 'farm', 'Planted a farm');
      d.happiness = Math.min(100, d.happiness + 2);
    }
    d.target = null; d.timer = 0; d.state = 'idle';
  }
}

function aiGather(d) {
  if (!d.target) { d.state = 'idle'; return; }
  d.timer++;
  const dur = Math.round(6 / statMod(effectiveStat(d, 'DEX')));
  if (d.timer >= dur) {
    const {x,y,tile} = d.target;
    const currentTile = G.map[y][x];
    if (currentTile === tile) {
      switch (tile) {
        case T.BERRY_BUSH:
          addCarry(d,'food',3); mapSet(x,y,T.PLAINS);
          log(`${d.name} \uD83E\uDED0 gathered berries (+3 food)`, 'farm');
          addEvent(d,'gather','Gathered berries'); d.hunger = Math.min(100,d.hunger+15); break;
        case T.HERB_PATCH:
          addCarry(d,'herbs',2); mapSet(x,y,T.PLAINS);
          log(`${d.name} \uD83C\uDF3F gathered herbs (+2 herbs)`, 'farm');
          addEvent(d,'gather','Gathered herbs'); break;
        case T.IRON_ORE:
          addCarry(d,'iron',2); addCarry(d,'stone',1); mapSet(x,y,T.HILL);
          log(`${d.name} \u2699\uFE0F mined iron ore (+2 iron)`, 'mine');
          addEvent(d,'gather','Mined iron ore'); break;
        case T.GOLD_VEIN:
          addCarry(d,'gold',2); mapSet(x,y,T.MOUNTAIN);
          log(`${d.name} \u2728 found gold (+2 gold)`, 'mine');
          addEvent(d,'gather','Mined gold vein'); break;
        case T.GEMS:
          addCarry(d,'gold',5); mapSet(x,y,T.MOUNTAIN);
          log(`${d.name} \uD83D\uDC8E discovered gems! (+5 gold)`, 'mine');
          addEvent(d,'gather','Discovered gems!'); d.happiness = Math.min(100,d.happiness+10); break;
        case T.FISH_SPOT:
          addCarry(d,'food',4); mapSet(x,y,T.OCEAN);
          log(`${d.name} \uD83D\uDC1F caught fish (+4 food)`, 'farm');
          addEvent(d,'gather','Caught fish'); d.hunger = Math.min(100,d.hunger+10); break;
        case T.CRAB:
          addCarry(d,'food',2); mapSet(x,y,T.BEACH);
          log(`${d.name} \uD83E\uDD80 caught crabs (+2 food)`, 'farm');
          addEvent(d,'gather','Caught crabs'); d.hunger = Math.min(100,d.hunger+8); break;
        case T.DEER:
          addCarry(d,'food',6); addCarry(d,'cloth',1); mapSet(x,y,T.PLAINS);
          log(`${d.name} \uD83E\uDD8C hunted game (+6 food, +1 cloth)`, 'mine');
          addEvent(d,'gather','Hunted wild game'); break;
        case T.CLAY:
          addCarry(d,'stone',2); mapSet(x,y,T.BEACH);
          log(`${d.name} \uD83C\uDFFA gathered clay (+2 stone)`, 'haul');
          addEvent(d,'gather','Gathered clay'); break;
        case T.CORAL:
          addCarry(d,'gold',1); mapSet(x,y,T.OCEAN);
          log(`${d.name} \uD83E\uDEB8 harvested coral (+1 gold)`, 'farm');
          addEvent(d,'gather','Harvested coral'); break;
      }
    }
    tryCraftInventoryGain(d, tile);
    d.happiness = Math.min(100, d.happiness + 2);
    d.target = null; d.timer = 0;
    if ((d.carrying||0) >= carryCapacity(d)) seekDeposit(d) || (d.state = 'idle');
    else d.state = 'idle';
  }
}

function aiSeekCraft(d) {
  if (!d.inventory || d.inventory.length < 2) { d.state = 'idle'; return; }
  const cp = bfs(d.x, d.y, (x,y) => G.map[y][x] === T.CITY || G.map[y][x] === T.TABLE, true);
  if (cp && cp.length < 40) { d.target = {type:'craft'}; d.path = cp; d.state = 'walk'; }
  else d.state = 'idle';
}

const craftQueue = [];
let craftDraining = false;
async function drainCraftQueue() {
  if (craftDraining || craftQueue.length === 0) return;
  craftDraining = true;
  while (craftQueue.length > 0) {
    const {d, item1, item2} = craftQueue.shift();
    try {
      const resp = await fetch(`${AI_API_BASE}/api/craft`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({item1,item2}),
      });
      const res = await resp.json();
      if (res.ok && res.result) {
        d.inventory.splice(0,2);
        addInventoryItem(d, res.result);
        log(`${d.name} \u2728 combined ${item1.emoji}${item1.name} + ${item2.emoji}${item2.name} = ${res.result.emoji}${res.result.name}!`, 'craft');
        addEvent(d, 'craft', `Combined ${item1.name} + ${item2.name} = ${res.result.name}`);
        d.happiness = Math.min(100, d.happiness + 5);
        const city = cityOf(d);
        if (city) { if (!city.discoveries) city.discoveries = new Set(); city.discoveries.add(res.result.name); }
      }
    } catch (e) {
      d.inventory.splice(0,2);
      const emojis = ['\u2728','\uD83D\uDD2E','\u26A1','\uD83C\uDF00','\uD83D\uDCAB'];
      const name = (item1.name.slice(0,3)+item2.name.slice(-3)).slice(0,20);
      const fallback = {emoji:emojis[Math.floor(Math.random()*emojis.length)],name};
      addInventoryItem(d, fallback);
      log(`${d.name} \u2728 crafted ${fallback.emoji}${fallback.name}`, 'craft');
      addEvent(d, 'craft', `Crafted ${fallback.name}`);
    }
    await new Promise(r => setTimeout(r, 1500+Math.random()*2000));
  }
  craftDraining = false;
}
setInterval(drainCraftQueue, 5000);

function aiCraft(d) {
  if (!d.inventory || d.inventory.length < 2) { d.state = 'idle'; return; }
  d.timer++;
  const dur = Math.round(15 / statMod(effectiveStat(d, 'INT')));
  if (d.timer >= dur) {
    craftQueue.push({d, item1:d.inventory[0], item2:d.inventory[1]});
    d.target = null; d.timer = 0; d.state = 'idle';
  }
}

// Ships
function createShip(x, y, captainId, cityId) {
  return { id:'s_'+Math.random().toString(36).slice(2,8), x, y, captainId, cityId, cargo:{}, cargoTotal:0, state:'docked', target:null, path:[] };
}
function shipCargo(ship) { return Object.values(ship.cargo).reduce((s,v) => s+v, 0); }
function tickShip(ship) {
  if (ship.state === 'docked' || ship.state === 'waiting') return;
  if (ship.state === 'sailing' && ship.path.length > 0) {
    const [nx,ny] = ship.path.shift();
    ship.x = nx; ship.y = ny;
    if (G.map[ny][nx] === T.FISH_SPOT && Math.random() < 0.3) {
      ship.cargo.food = (ship.cargo.food||0)+2;
      ship.cargoTotal = shipCargo(ship);
    }
    if (ship.path.length === 0) { ship.state = 'docked'; ship.target = null; }
  }
}
function tickShips() { for (const ship of G.ships) tickShip(ship); }

function tryBuildShip(city) {
  if (!city || !city.res) return null;
  const r = city.res;
  if (r.wood < SHIP_COST.wood || r.cloth < SHIP_COST.cloth || r.iron < SHIP_COST.iron) return null;
  let launchX = null, launchY = null;
  for (let dy = -3; dy <= 3 && launchX === null; dy++)
    for (let dx = -3; dx <= 3 && launchX === null; dx++) {
      const x = wrapX(city.mx+dx), y = city.my+dy;
      if (y >= 0 && y < MAP_H && isWater(x, y)) {
        for (const [ddx,ddy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
          const lx = wrapX(x+ddx), ly = y+ddy;
          if (ly >= 0 && ly < MAP_H && isWalkable(lx, ly)) { launchX = x; launchY = y; break; }
        }
      }
    }
  if (launchX === null) return null;
  r.wood -= SHIP_COST.wood; r.cloth -= SHIP_COST.cloth; r.iron -= SHIP_COST.iron;
  const ship = createShip(launchX, launchY, null, city.id);
  G.ships.push(ship);
  log(`${city.name} ⛵ built a ship!`, 'city');
  return ship;
}

function boardShip(d, ship, destCity) {
  if (!destCity || destCity.mx === undefined) return false;
  let destWX = null, destWY = null;
  for (let dy = -3; dy <= 3 && destWX === null; dy++)
    for (let dx = -3; dx <= 3 && destWX === null; dx++) {
      const x = wrapX(destCity.mx+dx), y = destCity.my+dy;
      if (y >= 0 && y < MAP_H && isWater(x, y)) { destWX = x; destWY = y; }
    }
  if (destWX === null) return false;
  const path = bfsWater(ship.x, ship.y, (x,y) => x === destWX && y === destWY);
  if (!path || path.length === 0) return false;
  ship.captainId = d.id; ship.state = 'sailing'; ship.path = path;
  ship.target = {x:destWX,y:destWY,cityId:destCity.id};
  if (d.carryItems) {
    for (const [k,v] of Object.entries(d.carryItems)) ship.cargo[k] = (ship.cargo[k]||0)+v;
    d.carryItems = {}; d.carrying = 0;
  }
  d.state = 'sailing'; d.target = {type:'sail',shipId:ship.id};
  log(`${d.name} ⛵ set sail from ${cityOf(d).name} to ${destCity.name}!`, 'system');
  addEvent(d, 'sail', `Boarded ship to ${destCity.name}`);
  return true;
}

function aiSail(d) {
  const ship = G.ships.find(s => s.id === d.target?.shipId);
  if (!ship) { d.state = 'idle'; d.target = null; return; }
  d.x = ship.x; d.y = ship.y;
  if (ship.state === 'docked' && ship.target) {
    const destCity = cityById(ship.target.cityId);
    if (destCity) {
      let disembarkX = null, disembarkY = null;
      for (const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
        const nx = wrapX(ship.x+dx), ny = ship.y+dy;
        if (ny >= 0 && ny < MAP_H && isWalkable(nx, ny)) { disembarkX = nx; disembarkY = ny; break; }
      }
      if (disembarkX !== null) { d.x = disembarkX; d.y = disembarkY; }
      else if (destCity.mx !== undefined) { d.x = destCity.mx; d.y = destCity.my; }
      for (const [k,v] of Object.entries(ship.cargo)) {
        if (destCity.res && destCity.res[k] !== undefined) destCity.res[k] += v;
      }
      const cargoAmt = shipCargo(ship);
      ship.cargo = {}; ship.cargoTotal = 0;
      d.cityId = destCity.id; ship.captainId = null;
      log(`${d.name} ⚓ arrived at ${destCity.name}${cargoAmt > 0 ? ` with ${cargoAmt} goods` : ''}!`, 'system');
      addEvent(d, 'sail', `Arrived at ${destCity.name}`);
    }
    d.state = 'idle'; d.target = null;
  } else if (ship.state === 'docked' && !ship.target) {
    d.state = 'idle'; d.target = null; ship.captainId = null;
  }
  if (d.hunger < 30 && (ship.cargo.food||0) > 0) {
    ship.cargo.food--; ship.cargoTotal = shipCargo(ship);
    d.hunger = Math.min(100, d.hunger + 30);
  }
  if (d.energy < 20) d.energy = Math.min(100, d.energy + 1.5);
}

function tryFoundCity(d) {
  if (CITIES.length >= 60) return false;
  if ((d.ambition ?? 50) < 80) return false;
  if ((d.carrying||0) < carryCapacity(d)) return false;
  for (const c of CITIES) {
    if (c.mx === undefined) continue;
    const dx = Math.min(Math.abs(c.mx-d.x), MAP_W-Math.abs(c.mx-d.x));
    const dy = Math.abs(c.my-d.y);
    if (dx+dy < 30) return false;
  }
  const partner = G.dwarves.find(o =>
    o !== d && o.cityId === d.cityId && o.state === 'idle' &&
    (o.carrying||0) >= carryCapacity(o) &&
    Math.abs(o.x-d.x) <= 2 && Math.abs(o.y-d.y) <= 2
  );
  if (!partner) return false;
  if (!isWalkable(d.x, d.y)) return false;
  let land = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = wrapX(d.x+dx), y = d.y+dy;
      if (y >= 0 && y < MAP_H && G.map[y][x] !== T.OCEAN && G.map[y][x] !== T.FISH_SPOT) land++;
    }
  if (land < 6) return false;
  const pooled = {};
  for (const founder of [d, partner]) {
    for (const [k,v] of Object.entries(founder.carryItems||{})) pooled[k] = (pooled[k]||0)+v;
    founder.carrying = 0; founder.carryItems = {};
  }
  const parentCity = cityOf(d);
  const newId = 'colony_'+Math.random().toString(36).slice(2,6);
  const newCity = {
    id:newId, name:d.name.split(' ')[1]+'heim',
    lon:0, lat:0, emoji:'🏕️',
    culture:parentCity.culture||'american',
    mx:d.x, my:d.y,
    res:{stone:0,wood:0,food:20,iron:0,gold:0,cloth:0,ale:0,herbs:0,beds:0,tables:0},
  };
  for (const [k,v] of Object.entries(pooled)) {
    if (newCity.res[k] !== undefined) newCity.res[k] += v;
  }
  CITIES.push(newCity);
  const cx = d.x, cy = d.y;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = wrapX(cx+dx), y = cy+dy;
      if (y < 0 || y >= MAP_H) continue;
      if (dx === 0 && dy === 0) mapSet(x, y, T.CITY);
      else if (dy === -1) { mapSet(x, y, T.BED); newCity.res.beds++; }
      else if (dy === 1) mapSet(x, y, T.STOCKPILE);
      else mapSet(x, y, T.FLOOR);
    }
  d.cityId = newId; partner.cityId = newId;
  d.state = 'idle'; d.target = null; d.path = [];
  partner.state = 'idle'; partner.target = null; partner.path = [];
  log(`🏕️ ${d.name} and ${partner.name} founded ${newCity.name}!`, 'system');
  addEvent(d, 'found', `Founded ${newCity.name}`);
  addEvent(partner, 'found', `Founded ${newCity.name}`);
  return true;
}

function trySeaSailing(d) {
  if (G.ships.length >= 20) return false;
  const city = cityOf(d);
  if (!city || !city.res) return false;
  if (!isCoastal(city.mx, city.my)) {
    let coastal = false;
    for (let dy = -4; dy <= 4 && !coastal; dy++)
      for (let dx = -4; dx <= 4 && !coastal; dx++) {
        const x = wrapX(city.mx+dx), y = city.my+dy;
        if (y >= 0 && y < MAP_H && isCoastal(x, y)) coastal = true;
      }
    if (!coastal) return false;
  }
  let ship = G.ships.find(s => s.cityId === city.id && !s.captainId && s.state === 'docked');
  if (!ship && city.res.wood >= SHIP_COST.wood && city.res.cloth >= SHIP_COST.cloth && city.res.iron >= SHIP_COST.iron)
    ship = tryBuildShip(city);
  if (!ship) return false;
  const otherCities = CITIES.filter(c => c.id !== city.id && c.mx !== undefined);
  const coastalCities = otherCities.filter(c => {
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const x = wrapX(c.mx+dx), y = c.my+dy;
        if (y >= 0 && y < MAP_H && isWater(x, y)) return true;
      }
    return false;
  });
  if (!coastalCities.length) return false;
  const dest = coastalCities[Math.floor(Math.random()*coastalCities.length)];
  const coastPath = bfs(d.x, d.y, (x,y) => {
    for (const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]])
      if (isWater(wrapX(x+dx), y+dy)) return true;
    return false;
  }, false);
  if (coastPath && coastPath.length < 20) return boardShip(d, ship, dest);
  return false;
}

function aiSeekFood(d) {
  if (d._tickSlot === undefined) d._tickSlot = G.dwarves.indexOf(d) % 4;
  if (G.tick % 4 !== d._tickSlot) return;
  const res = cityOf(d).res || {food:0};
  const mp = bfs(d.x, d.y, (x,y) => WILD_FOOD.has(G.map[y][x]), true);
  if (mp && mp.length < 25) {
    const last = mp[mp.length-1];
    const ft = G.map[last[1]][last[0]];
    d.target = {type:'eat',x:last[0],y:last[1],src:ft===T.MUSHROOM?'mushroom':ft===T.BERRY_BUSH?'berry':'crab'};
    d.path = mp.slice(0,-1);
    d.state = d.path.length > 0 ? 'going_eat' : 'eating';
    d.timer = 0; return;
  }
  if (res.food > 0) { d.target = {type:'eat',src:'stockpile'}; d.state = 'eating'; d.timer = 0; return; }
  log(`${d.name} \uD83D\uDE2B is starving!`, 'system');
  addEvent(d, 'starve', 'Starving - no food available');
  d.state = 'wander'; d.timer = 40+Math.floor(Math.random()*40);
}

function aiEat(d) {
  d.timer++;
  if (d.timer >= 5) {
    const res = cityOf(d).res || {food:0};
    const src = d.target?.src;
    if (src === 'mushroom' || src === 'berry' || src === 'crab') {
      const {x,y} = d.target;
      const expected = src === 'mushroom' ? T.MUSHROOM : src === 'berry' ? T.BERRY_BUSH : T.CRAB;
      const revert = src === 'crab' ? T.BEACH : T.PLAINS;
      if (G.map[y] && G.map[y][x] === expected) {
        mapSet(x, y, revert);
        const amt = src === 'mushroom' ? 40 : src === 'berry' ? 35 : 25;
        d.hunger = Math.min(100, d.hunger + Math.round(amt * statMod(effectiveStat(d, 'WIS'))));
        const emoji = src === 'mushroom' ? '🍄' : src === 'berry' ? '🫐' : '🦀';
        log(`${d.name} ${emoji} ate ${src === 'mushroom' ? 'a mushroom' : src === 'berry' ? 'berries' : 'crabs'}`, 'eat');
        addEvent(d, 'eat', `Ate ${src}`);
      }
    } else if (res.food > 0) {
      res.food--;
      d.hunger = Math.min(100, d.hunger + Math.round(35 * statMod(effectiveStat(d, 'WIS'))));
      log(`${d.name} 🍖 ate from stockpile`, 'eat');
      addEvent(d, 'eat', 'Ate from stockpile');
    }
    d.happiness = Math.min(100, d.happiness + 5);
    d.target = null; d.timer = 0; d.state = 'idle';
  }
}

function aiSeekSleep(d) {
  const bp = bfs(d.x, d.y, (x,y) => G.map[y][x] === T.BED, true);
  if (bp) {
    const last = bp[bp.length-1];
    d.target = {type:'sleep',x:last[0],y:last[1]}; d.path = bp;
    d.state = 'going_sleep'; d.timer = 0; return;
  }
  d.target = {type:'sleep'}; d.state = 'sleeping'; d.timer = 0;
}

function aiSleep(d) {
  d.timer++;
  const recoveryRate = 1.5 * statMod(effectiveStat(d, 'CON'));
  d.energy = Math.min(100, d.energy + recoveryRate);
  if (d.energy >= 90 || d.timer >= 40) {
    log(`${d.name} 😴 woke up`, 'sleep');
    addEvent(d, 'sleep', 'Slept and recovered energy');
    d.happiness = Math.min(100, d.happiness + 5);
    d.target = null; d.timer = 0; d.state = 'idle';
  }
}

function aiWander(d) {
  d.timer--;
  if (d.timer <= 0) { d.state = 'idle'; return; }
  if (Math.random() < 0.3) {
    const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
    const [dx,dy] = dirs[Math.floor(Math.random()*4)];
    const nx = wrapX(d.x+dx), ny = d.y+dy;
    if (isWalkable(nx, ny)) { d.x = nx; d.y = ny; }
  }
}

// Seasons
function tickSeason() {
  if (G.tick % 2000 === 0 && G.tick > 0) {
    G.season = (G.season + 1) % 4;
    if (G.season === 0) {
      G.year++;
      const deadIds = [];
      for (const d of G.dwarves) {
        d.age = (d.age || 20) + 1;
        if (d.age >= 70 && Math.random() < 0.03 * (d.age - 69)) {
          log(`${d.name} \u2620\uFE0F passed away at age ${d.age}`, 'system');
          addEvent(d, 'death', `Died of old age at ${d.age}`);
          deadIds.push(d.id);
        }
      }
      if (deadIds.length) G.dwarves = G.dwarves.filter(dw => !deadIds.includes(dw.id));
    }
    const name = SEASONS[G.season];
    log(`🌍 ${name} of Year ${G.year}`, 'system');
    pendingToasts.push({type:'info', title:name+', Year '+G.year, message:'The seasons turn across Dwarf Land...'});

    if (G.season === 0 || G.season === 1) {
      for (const city of CITIES) {
        if (!city.res || city.mx === undefined) continue;
        let farmCount=0, fishCount=0, berryCount=0, herbCount=0;
        const r = 15;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const fx = wrapX(city.mx+dx), fy = city.my+dy;
            if (fy < 0 || fy >= MAP_H) continue;
            const t = G.map[fy][fx];
            if (t === T.FARM) farmCount++;
            else if (t === T.FISH_SPOT || t === T.CRAB) fishCount++;
            else if (t === T.BERRY_BUSH) berryCount++;
            else if (t === T.HERB_PATCH) herbCount++;
          }
        const cityPop = G.dwarves.filter(d => d.cityId === city.id).length;
        const harvest = 10 + farmCount*3 + fishCount*2 + berryCount + cityPop*2;
        city.res.food += harvest;
        if (herbCount > 0) city.res.herbs += Math.ceil(herbCount/2);
        if (farmCount >= 3) city.res.cloth += Math.floor(farmCount/3);
        if (city.res.food > 50 + cityPop*5) city.res.ale += Math.min(5, Math.floor((city.res.food-50)/20));
      }
      log(`🌾 Harvest season! Cities gather from farms, fisheries, and foraging.`, 'farm');

      for (const city of CITIES) {
        if (!city.res || city.mx === undefined) continue;
        const cityPop = G.dwarves.filter(d => d.cityId === city.id).length;
        const r = city.res;
        if (cityPop >= (r.beds||1) && r.stone >= 8 && r.wood >= 4) {
          let expanded = 0;
          const cx = city.mx, cy = city.my;
          const expandable = new Set([T.PLAINS,T.FOREST,T.TAIGA,T.DESERT,T.TUNDRA,T.BEACH,T.HILL,T.FLOOR]);
          for (let radius = 2; radius <= 6 && expanded < 3; radius++)
            for (let dy = -radius; dy <= radius && expanded < 3; dy++)
              for (let dx = -radius; dx <= radius && expanded < 3; dx++) {
                if (Math.abs(dx) < radius && Math.abs(dy) < radius) continue;
                const x = wrapX(cx+dx), y = cy+dy;
                if (y < 0 || y >= MAP_H) continue;
                if (!expandable.has(G.map[y][x])) continue;
                let adjBuilding = false;
                for (const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
                  const wx = wrapX(nx);
                  if (ny >= 0 && ny < MAP_H) {
                    const nt = G.map[ny][wx];
                    if (nt===T.BED||nt===T.STOCKPILE||nt===T.TABLE||nt===T.FLOOR||nt===T.CITY||nt===T.WALL) { adjBuilding = true; break; }
                  }
                }
                if (!adjBuilding) continue;
                const pick = (expanded+cityPop) % 4;
                if (pick === 0 && r.stone >= 3 && r.wood >= 1) { mapSet(x,y,T.BED); r.stone -= 2; r.wood -= 1; r.beds++; expanded++; }
                else if (pick === 1 && r.stone >= 2) { mapSet(x,y,T.STOCKPILE); r.stone -= 2; expanded++; }
                else if (pick === 2 && r.wood >= 2) { mapSet(x,y,T.TABLE); r.wood -= 2; r.tables++; expanded++; }
                else if (r.stone >= 1) { mapSet(x,y,T.FLOOR); r.stone -= 1; expanded++; }
              }
          if (expanded > 0) log(`🏘️ ${city.name} expanded! (+${expanded} structures)`, 'city');
        }
      }

      for (let i = 0; i < 80; i++) {
        const rx = Math.floor(Math.random()*MAP_W);
        const ry = 10+Math.floor(Math.random()*(MAP_H-20));
        const t = G.map[ry][rx];
        if ((t===T.FOREST||t===T.JUNGLE||t===T.TAIGA) && Math.random()<0.3) mapSet(rx,ry,T.MUSHROOM);
        if ((t===T.FOREST||t===T.TAIGA||t===T.PLAINS) && Math.random()<0.15) mapSet(rx,ry,T.BERRY_BUSH);
        if ((t===T.PLAINS||t===T.JUNGLE) && Math.random()<0.12) mapSet(rx,ry,T.HERB_PATCH);
        if (t===T.OCEAN && Math.random()<0.2) {
          let nearLand = false;
          for (let dy=-2;dy<=2&&!nearLand;dy++)
            for (let dx=-2;dx<=2&&!nearLand;dx++) {
              const nx=wrapX(rx+dx),ny=ry+dy;
              if (ny>=0&&ny<MAP_H&&G.map[ny][nx]!==T.OCEAN&&G.map[ny][nx]!==T.FISH_SPOT) nearLand=true;
            }
          if (nearLand) mapSet(rx,ry,T.FISH_SPOT);
        }
        if (t===T.BEACH && Math.random()<0.15) mapSet(rx,ry,T.CRAB);
        if ((t===T.FOREST||t===T.PLAINS||t===T.TAIGA) && Math.random()<0.04) mapSet(rx,ry,T.DEER);
      }
    }
  }
}

// AI Client
const AI = {
  intentCache: new Map(),
  lastCallTime: {simple:0,medium:0,complex:0,premium:0},
  intervals: {simple:10000,medium:30000,complex:120000,premium:600000},
  enabled: true,
  stats: {calls:0,fallbacks:0,errors:0},
};

function aiClientContext(cityDwarves, city) {
  const res = city?.res || defaultRes();
  return {
    dwarves: (cityDwarves||G.dwarves).map(d => ({
      id:d.id,name:d.name,hunger:d.hunger,energy:d.energy,happiness:d.happiness,
      state:d.state,x:d.x,y:d.y,stats:d.stats,faith:d.faith,traits:d.traits,
      eventLog:d.eventLog?.slice(-10),cityId:d.cityId,
    })),
    resources:res, cityName:city?.name, culture:city?.culture,
    season:SEASONS[G.season]||'Spring', year:G.year,
  };
}

async function aiCall(tier, cityDwarves, city) {
  const now = Date.now();
  if (now - AI.lastCallTime[tier] < AI.intervals[tier]) return;
  AI.lastCallTime[tier] = now;
  if (!AI.enabled || G.paused) return;
  try {
    const resp = await fetch(`${AI_API_BASE}/api/decide/${tier}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify(aiClientContext(cityDwarves, city)),
    });
    if (!resp.ok) { AI.stats.fallbacks++; return; }
    const data = await resp.json();
    AI.stats.calls++;
    if (data.decisions?.decisions) {
      for (const dec of data.decisions.decisions)
        AI.intentCache.set(dec.dwarfId, {action:dec.action,targetDwarfId:dec.targetDwarfId,reason:dec.reason,timestamp:now,tier});
    } else if (data.decisions) {
      const decisions = Array.isArray(data.decisions) ? data.decisions : [];
      for (const dec of decisions)
        AI.intentCache.set(dec.dwarfId, {action:dec.action,targetDwarfId:dec.targetDwarfId,reason:dec.reason,timestamp:now,tier});
    }
    if (data.sponsoredDwarfIds?.length) {
      for (const id of data.sponsoredDwarfIds) {
        const dw = G.dwarves.find(d => d.id === id);
        if (dw) dw.sponsored = true;
      }
    }
  } catch (e) { AI.stats.errors++; }
}

function aiTickAll() {
  const activeCities = CITIES.filter(c => c.mx !== undefined && c.res);
  if (!activeCities.length) return;
  for (let i = 0; i < 4; i++) {
    const city = activeCities[G.aiCityIndex % activeCities.length];
    G.aiCityIndex = (G.aiCityIndex + 1) % activeCities.length;
    const idleDwarves = G.dwarves.filter(d => d.cityId === city.id && d.state === 'idle');
    if (idleDwarves.length > 0) { aiCall('simple', idleDwarves, city); break; }
  }
}

function executeIntent(d) {
  const intent = AI.intentCache.get(d.id);
  if (!intent) return false;
  if (Date.now() - intent.timestamp > 60000) { AI.intentCache.delete(d.id); return false; }
  const action = intent.action;
  AI.intentCache.delete(d.id);
  switch (action) {
    case 'eat':
      d.state = 'seek_food'; d.target = null; d.path = [];
      log(`${d.name} 🤖 AI: ${intent.reason}`, 'system'); return true;
    case 'sleep': case 'rest':
      d.state = 'seek_sleep'; d.target = null; d.path = [];
      log(`${d.name} 🤖 AI: ${intent.reason}`, 'system'); return true;
    case 'mine': return aiSeekTask(d, T.D_MINE, T.MOUNTAIN, 'mine', intent.reason);
    case 'build': return aiSeekTask(d, T.D_BUILD, null, 'build', intent.reason);
    case 'farm': return aiSeekFarmTask(d, intent.reason);
    case 'chop': {
      const tp = bfs(d.x,d.y,(x,y)=>G.map[y][x]===T.TAIGA||G.map[y][x]===T.FOREST,false);
      if (tp) {
        const last = tp[tp.length-1]; const adj = adjWalkable(last[0],last[1]);
        if (adj) {
          const p = bfs(d.x,d.y,(x,y)=>x===adj[0]&&y===adj[1],false);
          if (p) { d.target={type:'chop',x:last[0],y:last[1]}; d.path=p; d.state='walk'; log(`${d.name} 🤖 AI: ${intent.reason}`,'system'); return true; }
        }
      }
      return false;
    }
    case 'explore': case 'wander':
      d.state = 'wander'; d.timer = 30+Math.floor(Math.random()*50);
      log(`${d.name} 🤖 AI: ${intent.reason}`, 'system'); return true;
    case 'pray':
      d.state = 'wander'; d.timer = 10;
      d.happiness = Math.min(100, d.happiness + 3);
      log(`${d.name} 🙏 prays: ${intent.reason}`, 'system'); return true;
    default: return false;
  }
}

function aiSeekTask(d, designationType, naturalType, taskType, reason) {
  const path = bfs(d.x,d.y,(x,y)=>G.map[y][x]===designationType||(naturalType&&G.map[y][x]===naturalType),false);
  if (path) {
    const last = path[path.length-1]; const adj = adjWalkable(last[0],last[1]);
    if (adj) {
      const p = bfs(d.x,d.y,(x,y)=>x===adj[0]&&y===adj[1],false);
      if (p) { d.target={type:taskType,x:last[0],y:last[1]}; d.path=p; d.state='walk'; log(`${d.name} 🤖 AI: ${reason}`,'system'); return true; }
    }
  }
  return false;
}

function aiSeekFarmTask(d, reason) {
  const fp = bfs(d.x,d.y,(x,y)=>G.map[y][x]===T.D_FARM,false);
  if (fp) {
    const last = fp[fp.length-1];
    if (G.map[last[1]][last[0]] === T.D_FARM) {
      d.target={type:'farm',x:last[0],y:last[1]}; d.path=fp; d.state='walk';
      log(`${d.name} 🤖 AI: ${reason}`,'system'); return true;
    }
  }
  return false;
}

// State serialization
function getSerializableState() {
  const cityRes = {};
  for (const c of CITIES) { if (c.res) cityRes[c.id] = c.res; }
  return {
    tick:G.tick, year:G.year, season:G.season, speed:G.speed,
    cityResources:cityRes,
    dwarves:G.dwarves.map(d => ({
      id:d.id,name:d.name,x:d.x,y:d.y,cityId:d.cityId,
      hunger:d.hunger,energy:d.energy,happiness:d.happiness,
      state:d.state,timer:d.timer,color:d.color,
      stats:d.stats,faith:d.faith,morality:d.morality,ambition:d.ambition,
      traits:d.traits,backstory:d.backstory,eventLog:d.eventLog?.slice(-50),age:d.age,
      carrying:d.carrying||0,carryItems:d.carryItems||{},
      inventory:d.inventory||[],
    })),
    stats:G.stats,
    homeCity:G.homeCity?{name:G.homeCity.name,mx:G.homeCity.mx,my:G.homeCity.my}:null,
    ships:G.ships.map(s => ({
      id:s.id,x:s.x,y:s.y,captainId:s.captainId,cityId:s.cityId,
      cargo:s.cargo,state:s.state,
    })),
  };
}

// ---- Worker Message Handler ----
self.onmessage = function(e) {
  const data = e.data;
  switch (data.type) {
    case 'init': {
      const flat = new Uint8Array(data.map);
      G.map = [];
      for (let y = 0; y < MAP_H; y++) G.map.push(flat.slice(y * MAP_W, (y+1) * MAP_W));
      CITIES = data.cities;
      CULTURES = data.cultures;
      DWARF_NAMES = data.dwarfNames;
      SURNAMES = data.surnames;
      AI_API_BASE = data.apiBase || '';
      G.dwarves = data.dwarves || [];
      G.ships = (data.ships || []).map(s => ({...s, path:s.path||[], target:s.target||null}));
      G.tick = data.state?.tick || 0;
      G.year = data.state?.year || 1;
      G.season = data.state?.season || 0;
      G.speed = data.state?.speed || 1;
      G.paused = data.state?.paused || false;
      G.stats = data.state?.stats || G.stats;
      G.homeCity = CITIES.find(c => c.id === data.state?.homeCityId) || CITIES[0];
      G.aiCityIndex = data.state?.aiCityIndex || 0;
      // Restore dwarf paths/targets to empty (they were stripped for transfer)
      for (const d of G.dwarves) {
        if (!d.path) d.path = [];
        if (!d.target) d.target = null;
        if (!d.eventLog) d.eventLog = [];
        if (!d.carryItems) d.carryItems = {};
        if (!d.inventory) d.inventory = [];
        d.state = d.state || 'idle';
      }
      startTickLoop();
      break;
    }
    case 'control':
      if (data.speed !== undefined) G.speed = data.speed;
      if (data.paused !== undefined) G.paused = data.paused;
      break;
    case 'designate':
      for (const ch of data.changes) G.map[ch.y][ch.x] = ch.tile;
      break;
    case 'save_request':
      self.postMessage({type:'save_response', state:getSerializableState()});
      break;
    case 'restore': {
      const saved = data.state;
      if (!saved) break;
      G.tick = saved.tick || 0;
      G.year = saved.year || 1;
      G.season = saved.season || 0;
      G.stats = {...G.stats, ...saved.stats};
      if (saved.cityResources) {
        for (const [cityId, res] of Object.entries(saved.cityResources)) {
          const city = cityById(cityId);
          if (city && city.res) Object.assign(city.res, res);
        }
      }
      if (saved.dwarves?.length > 0) {
        G.dwarves = saved.dwarves.map(sd => {
          const d = createDwarf(sd.x, sd.y, sd.cityId || '');
          Object.assign(d, {
            id:sd.id, name:sd.name, hunger:sd.hunger, energy:sd.energy, happiness:sd.happiness,
            state:sd.state||'idle', timer:sd.timer||0, color:sd.color, cityId:sd.cityId||'',
            stats:sd.stats||d.stats, faith:sd.faith??d.faith, morality:sd.morality??d.morality,
            ambition:sd.ambition??d.ambition, traits:sd.traits||d.traits,
            backstory:sd.backstory||d.backstory, eventLog:sd.eventLog||[], age:sd.age??d.age,
            carrying:sd.carrying||0, carryItems:sd.carryItems||{}, inventory:sd.inventory||[],
          });
          d.target = null; d.path = [];
          if (!isWalkable(d.x, d.y)) {
            const city = CITIES.find(c => c.id === d.cityId);
            const land = city?.mx !== undefined ? findNearbyLand(city.mx, city.my) : findNearbyLand(d.x, d.y);
            if (land) { d.x = land[0]; d.y = land[1]; d.state = 'idle'; }
          }
          return d;
        });
      }
      if (saved.homeCity) G.homeCity = CITIES.find(c => c.name === saved.homeCity.name) || G.homeCity;
      if (saved.ships?.length) {
        G.ships = saved.ships.map(s => ({
          ...createShip(s.x, s.y, s.captainId, s.cityId),
          id:s.id, cargo:s.cargo||{}, state:s.state||'docked',
          cargoTotal:Object.values(s.cargo||{}).reduce((a,b)=>a+b,0),
          path:[], target:null,
        }));
      }
      // Ensure min population
      for (const city of CITIES) {
        if (city.mx === undefined) continue;
        const pop = G.dwarves.filter(d => d.cityId === city.id).length;
        if (pop < 2) for (let i = 0; i < 2+Math.floor(Math.random()*2)-pop; i++) spawnDwarfAtCity(city);
      }
      break;
    }
  }
};

// ---- Tick Loop ----
let tickTimer = null;
function startTickLoop() {
  function doTick() {
    if (G.paused) { tickTimer = setTimeout(doTick, 100); return; }
    const TICK_BATCH = 3;
    for (let i = 0; i < TICK_BATCH; i++) {
      G.tick++;
      G.dwarfGrid = {};
      for (const d of G.dwarves) {
        const key = `${d.x >> 3},${d.y >> 3}`;
        (G.dwarfGrid[key] ??= []).push(d);
      }
      for (const d of G.dwarves) tickDwarf(d);
      G.dwarves = G.dwarves.filter(d => !d.dead);
      tickShips();
      tickSeason();
    }
    aiTickAll();

    // Post snapshot to main thread
    self.postMessage({
      type:'snapshot',
      tick:G.tick, year:G.year, season:G.season,
      stats:{...G.stats},
      dwarves:G.dwarves.map(d => ({
        id:d.id,name:d.name,x:d.x,y:d.y,cityId:d.cityId,color:d.color,
        hunger:d.hunger,energy:d.energy,happiness:d.happiness,
        state:d.state, target:d.target?{type:d.target.type}:null,
        stats:d.stats,faith:d.faith,morality:d.morality,ambition:d.ambition,age:d.age,
        traits:d.traits,backstory:d.backstory,eventLog:d.eventLog?.slice(-50),
        carrying:d.carrying||0,carryItems:d.carryItems||{},
        carryMax:carryCapacity(d),
        inventory:d.inventory||[],
        sponsored:d.sponsored,sponsorTier:d.sponsorTier,sponsorCallsRemaining:d.sponsorCallsRemaining,
        starveTicks:d.starveTicks||0,
        relationships:d.relationships,
      })),
      ships:G.ships.map(s => ({
        id:s.id,x:s.x,y:s.y,captainId:s.captainId,cityId:s.cityId,
        cargo:s.cargo,cargoTotal:s.cargoTotal||0,state:s.state,
        target:s.target?{cityId:s.target.cityId}:null,
        pathLength:s.path?.length||0,
      })),
      cities:CITIES.filter(c => c.res).map(c => ({id:c.id,res:{...c.res},mx:c.mx,my:c.my,name:c.name,emoji:c.emoji})),
      logs:pendingLogs.splice(0),
      toasts:pendingToasts.splice(0),
      mapChanges:pendingMapChanges.splice(0),
    });

    const interval = Math.max(33, Math.floor(100 / G.speed));
    tickTimer = setTimeout(doTick, interval);
  }
  doTick();
}
