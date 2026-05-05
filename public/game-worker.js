// ============================================================
// DWARF LAND - Game Worker (Simulation Thread)
// ============================================================
const TILE = 20, MAP_W = 2000, MAP_H = 1000;
const T = {
  OCEAN:0,TUNDRA:1,TAIGA:2,FOREST:3,PLAINS:4,DESERT:5,JUNGLE:6,MOUNTAIN:7,
  HILL:8,BEACH:9,FLOOR:10,WALL:11,STOCKPILE:12,BED:13,TABLE:14,DOOR:15,
  MUSHROOM:16,FARM:17,CITY:18,D_MINE:19,D_BUILD:20,D_FARM:21,
  IRON_ORE:22,GOLD_VEIN:23,GEMS:24,BERRY_BUSH:25,HERB_PATCH:26,CLAY:27,
  FISH_SPOT:28,DEER:29,CORAL:30,CRAB:31,ROAD:32,D_ROAD:33,RAILROAD:34,
  GRAVE:35,ASPHALT:36,FACTORY:37,PATH:38,DIRT:39,D_UPGRADE:40
};
const WALKABLE = new Set([
  T.TUNDRA,T.TAIGA,T.FOREST,T.PLAINS,T.DESERT,T.JUNGLE,T.HILL,T.BEACH,T.MOUNTAIN,
  T.FLOOR,T.STOCKPILE,T.BED,T.TABLE,T.DOOR,T.MUSHROOM,T.FARM,T.CITY,
  T.D_MINE,T.D_FARM,T.D_ROAD,T.D_UPGRADE,T.PATH,T.ROAD,T.ASPHALT,T.RAILROAD,
  T.BERRY_BUSH,T.HERB_PATCH,T.CLAY,T.DEER,T.CRAB,
  T.GRAVE,T.FACTORY,T.DIRT
]);
const WILD_FOOD = new Set([T.MUSHROOM,T.BERRY_BUSH,T.CRAB]);
const GATHERABLE = new Set([T.BERRY_BUSH,T.HERB_PATCH,T.IRON_ORE,T.GOLD_VEIN,T.GEMS,T.FISH_SPOT,T.CRAB,T.DEER,T.CLAY,T.CORAL]);
const STARVE_IMMOBILE = 2000, STARVE_DEATH = 2667;
const WORLD_POP_HARD_CAP = 300, TOWN_POP_CAP = 10, SUBURB_POP_CAP = 4, EMPTY_TOWN_MOVE_RADIUS = 80;
const SEASONS = ['Spring','Summer','Autumn','Winter'];
const TERRAIN_PROPS = {
  [T.OCEAN]:{speed:0},[T.TUNDRA]:{speed:2},[T.TAIGA]:{speed:2},[T.FOREST]:{speed:2},
  [T.PLAINS]:{speed:1},[T.DESERT]:{speed:1.5},[T.JUNGLE]:{speed:3},[T.MOUNTAIN]:{speed:5},
  [T.HILL]:{speed:2},[T.BEACH]:{speed:1},[T.FLOOR]:{speed:1},[T.WALL]:{speed:0},
  [T.STOCKPILE]:{speed:1},[T.BED]:{speed:1},[T.TABLE]:{speed:1},[T.DOOR]:{speed:1},
  [T.MUSHROOM]:{speed:1},[T.FARM]:{speed:1},[T.CITY]:{speed:1},
  [T.D_MINE]:{speed:1},[T.D_BUILD]:{speed:0},[T.D_FARM]:{speed:1},[T.D_ROAD]:{speed:1},[T.D_UPGRADE]:{speed:0.7},
  [T.PATH]:{speed:1},[T.ROAD]:{speed:0.7},[T.ASPHALT]:{speed:0.4},[T.IRON_ORE]:{speed:4},[T.GOLD_VEIN]:{speed:4},[T.GEMS]:{speed:4},
  [T.BERRY_BUSH]:{speed:1},[T.HERB_PATCH]:{speed:1},[T.CLAY]:{speed:1},
  [T.FISH_SPOT]:{speed:0},[T.DEER]:{speed:1},[T.CORAL]:{speed:0},[T.CRAB]:{speed:1},
  [T.RAILROAD]:{speed:0.2},
  [T.FACTORY]:{speed:1},
  [T.DIRT]:{speed:1.2},
};
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

function roadTierScore(tiers) {
  if (tiers?.railroad) return 4;
  if (tiers?.asphalt) return 3;
  if (tiers?.gravel) return 2;
  if (tiers?.path) return 1;
  return 0;
}

function findCityWater(city) {
  if (!city || city.mx === undefined) return null;
  let fallback = null, best = null, bestDist = Infinity;
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const x = wrapX(city.mx+dx), y = city.my+dy;
      if (y < 0 || y >= MAP_H || !isWater(x, y)) continue;
      if (!fallback) fallback = {x, y};
      let hasLand = false;
      for (const [ddx, ddy] of [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[-1,-1],[1,1],[-1,1]]) {
        const lx = wrapX(x + ddx), ly = y + ddy;
        if (ly >= 0 && ly < MAP_H && isWalkable(lx, ly)) { hasLand = true; break; }
      }
      if (!hasLand) continue;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist < bestDist) {
        best = {x, y};
        bestDist = dist;
      }
    }
  return best || fallback;
}

function tryShipPath(city, dest) {
  const originW = findCityWater(city);
  const destW = findCityWater(dest);
  if (!originW || !destW) return null;
  const waterPath = bfsWater(originW.x, originW.y, (x,y) => x === destW.x && y === destW.y);
  return (waterPath && waterPath.length > 0) ? waterPath : null;
}

function tryRoadPath(city, dest, mode) {
  const minRoad = mode === 'train' ? T.RAILROAD : mode === 'car' ? T.ASPHALT : T.PATH;
  const vPath = findVehicleRoute(city, dest, minRoad);
  return (vPath && vPath.length > 0) ? vPath : null;
}

function tryWalkPath(d, dest) {
  const wp = bfs(d.x, d.y, (x,y) => Math.abs(x-dest.mx) <= 2 && Math.abs(y-dest.my) <= 2 && isWalkable(x,y), false);
  if (!wp || wp.length === 0 || wp.length > 2000) return null;
  return wp;
}

function tryRouteAccessPath(d, targets) {
  for (const [tx, ty] of targets) {
    if (d.x === tx && d.y === ty) return [];
  }
  const targetKeys = new Set(targets.map(([tx, ty]) => `${tx},${ty}`));
  const accessPath = bfs(d.x, d.y, (x,y) => targetKeys.has(`${x},${y}`), false);
  return (accessPath && accessPath.length > 0) ? accessPath : null;
}

function routeIndex(route, x, y) {
  return route.findIndex(([rx, ry]) => rx === x && ry === y);
}

function tryVehicleTravelPath(d, city, dest, mode) {
  const route = tryRoadPath(city, dest, mode);
  if (!route) return null;
  if (d.x === city.mx && d.y === city.my) return route;
  const accessPath = tryRouteAccessPath(d, [[city.mx, city.my], ...route.slice(0, -1)]);
  if (accessPath == null) return null;
  if (accessPath.length === 0) {
    const idx = routeIndex(route, d.x, d.y);
    return idx >= 0 ? route.slice(idx + 1) : route;
  }
  const [tx, ty] = accessPath[accessPath.length - 1];
  if (tx === city.mx && ty === city.my) return accessPath.concat(route);
  const idx = routeIndex(route, tx, ty);
  return idx >= 0 ? accessPath.concat(route.slice(idx + 1)) : accessPath.concat(route);
}

function tryShipTravelPath(d, city, dest) {
  const route = tryShipPath(city, dest);
  if (!route) return null;
  if (d.x === city.mx && d.y === city.my) return route;
  const originW = findCityWater(city);
  if (!originW) return null;
  const embarkTargets = [];
  for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[-1,-1],[1,1],[-1,1]]) {
    const x = wrapX(originW.x + dx), y = originW.y + dy;
    if (y >= 0 && y < MAP_H && isWalkable(x, y)) embarkTargets.push([x, y]);
  }
  if (!embarkTargets.length) return null;
  const accessPath = tryRouteAccessPath(d, embarkTargets);
  if (accessPath == null) return null;
  const waterEntry = [[originW.x, originW.y]];
  return accessPath.length > 0 ? accessPath.concat(waterEntry, route) : waterEntry.concat(route);
}

// Mode chain — when preferred mode pathfind fails, downshift to next-best.
const TRAVEL_DOWNSHIFT = ['train', 'car', 'cart', 'walk'];

function tryTravelTo(d, city, dest) {
  const preferred = bestTravelMode(city, dest);
  const candidates = [];
  if (preferred === 'ship') {
    candidates.push('ship', 'walk');
  } else {
    const startIdx = TRAVEL_DOWNSHIFT.indexOf(preferred);
    for (let i = startIdx >= 0 ? startIdx : TRAVEL_DOWNSHIFT.length - 1; i < TRAVEL_DOWNSHIFT.length; i++) {
      candidates.push(TRAVEL_DOWNSHIFT[i]);
    }
  }
  for (const mode of candidates) {
    let path = null;
    if (mode === 'ship') path = tryShipTravelPath(d, city, dest);
    else if (mode === 'walk') path = tryWalkPath(d, dest);
    else path = tryVehicleTravelPath(d, city, dest, mode);
    if (!path) continue;
    const tm = TRAVEL_MODES[mode];
    d.path = path;
    d.state = 'traveling';
    d.travelMode = mode;
    d.target = { type:'travel', destCityId:dest.id };
    log(`${d.name} ${tm.emoji} traveling to ${dest.name} by ${tm.label}`, 'system', 2, null, d.x, d.y);
    addEvent(d, 'travel', `${tm.label} to ${dest.name}`);
    return true;
  }
  return false;
}

function tryTravel(d) {
  const city = cityOf(d);
  if (!city || !city.res) return false;
  if (d.hunger < 30 || d.energy < 25) return false;
  if (!G.roadGraph || G.roadGraphDirty) rebuildRoadGraph();
  const others = CITIES.filter(c => c.id !== city.id && c.mx !== undefined);
  if (!others.length) return false;
  others.sort((a,b) => {
    const pairA = [city.id, a.id].sort().join('-');
    const pairB = [city.id, b.id].sort().join('-');
    const tierA = roadTierScore(G.roadGraph?.[pairA]);
    const tierB = roadTierScore(G.roadGraph?.[pairB]);
    if (tierA !== tierB) return tierB - tierA;
    const da = Math.min(Math.abs(a.mx-city.mx), MAP_W-Math.abs(a.mx-city.mx)) + Math.abs(a.my-city.my);
    const db = Math.min(Math.abs(b.mx-city.mx), MAP_W-Math.abs(b.mx-city.mx)) + Math.abs(b.my-city.my);
    return da - db;
  });
  const pool = others.slice(0, 12);
  for (const dest of pool) {
    if (tryTravelTo(d, city, dest)) return true;
  }
  return false;
}

function aiTravel(d) {
  if (!d.path || d.path.length === 0) {
    const dest = CITIES.find(c => c.id === d.target?.destCityId);
    if (dest) {
      d.cityId = dest.id;
      if (d.travelMode === 'ship') {
        const dirs = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[-1,-1],[1,1],[-1,1]];
        for (const [ddx,ddy] of dirs) {
          const lx = wrapX(dest.mx+ddx), ly = dest.my+ddy;
          if (ly >= 0 && ly < MAP_H && isWalkable(lx, ly)) { d.x = lx; d.y = ly; break; }
        }
      }
      if (d.carryItems && dest.res) {
        for (const [k,v] of Object.entries(d.carryItems)) {
          if (dest.res[k] !== undefined) dest.res[k] += v;
        }
        const amt = d.carrying || 0;
        if (amt > 0) log(`${d.name} delivered ${amt} goods to ${dest.name}`, 'trade', 2, null, d.x, d.y);
        d.carryItems = {}; d.carrying = 0;
      }
      log(`${d.name} arrived at ${dest.name}`, 'system', 2, null, d.x, d.y);
      addEvent(d, 'travel', `Arrived at ${dest.name}`);
    }
    d.state = 'idle'; d.target = null; d.travelMode = null;
    return;
  }
  const mode = TRAVEL_MODES[d.travelMode] || TRAVEL_MODES.walk;
  const steps = Math.min(mode.speed, d.path.length);
  for (let i = 0; i < steps; i++) {
    const [nx, ny] = d.path.shift();
    d.x = nx; d.y = ny;
  }
  if (d.hunger < 30 && d.carryItems?.food > 0) {
    d.carryItems.food--; d.carrying = Math.max(0, (d.carrying||0)-1);
    d.hunger = Math.min(100, d.hunger + 30);
  }
  if (d.energy < 20) d.energy = Math.min(100, d.energy + 1);
}
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

// Animal types
const ANIMAL_TYPES = {
  cat:     {emoji:'\uD83D\uDC31',hp:4, ac:12,atk:0,dmg:0,       speed:0.3,food:1, danger:false,pet:true, terrain:[T.PLAINS,T.FOREST,T.PATH,T.ROAD]},
  dog:     {emoji:'\uD83D\uDC36',hp:6, ac:11,atk:0,dmg:0,       speed:0.4,food:2, danger:false,pet:true, terrain:[T.PLAINS,T.FOREST,T.PATH,T.ROAD,T.DESERT]},
  monkey:  {emoji:'\uD83D\uDC12',hp:5, ac:13,atk:3,dmg:'1d4',   speed:0.5,food:2, danger:true, pet:false,terrain:[T.JUNGLE]},
  wolf:    {emoji:'\uD83D\uDC3A',hp:11,ac:13,atk:4,dmg:'2d4',   speed:0.6,food:3, danger:true, pet:false,terrain:[T.FOREST,T.TUNDRA]},
  bear:    {emoji:'\uD83D\uDC3B',hp:19,ac:11,atk:5,dmg:'2d6',   speed:0.3,food:8, danger:true, pet:false,terrain:[T.FOREST,T.MOUNTAIN]},
  snake:   {emoji:'\uD83D\uDC0D',hp:3, ac:14,atk:3,dmg:'1d4+poison',speed:0.2,food:1,danger:true,pet:false,terrain:[T.JUNGLE,T.DESERT]},
  rabbit:  {emoji:'\uD83D\uDC07',hp:2, ac:14,atk:0,dmg:0,       speed:0.7,food:2, danger:false,pet:false,terrain:[T.PLAINS,T.FOREST]},
  fox:     {emoji:'\uD83E\uDD8A',hp:6, ac:13,atk:3,dmg:'1d6',   speed:0.6,food:3, danger:true, pet:false,terrain:[T.PLAINS,T.FOREST]},
  eagle:   {emoji:'\uD83E\uDD85',hp:5, ac:14,atk:4,dmg:'1d6',   speed:0.8,food:2, danger:true, pet:false,terrain:[T.MOUNTAIN,T.HILL]},
  penguin: {emoji:'\uD83D\uDC27',hp:4, ac:10,atk:0,dmg:0,       speed:0.3,food:3, danger:false,pet:false,terrain:[T.TUNDRA]},
  camel:   {emoji:'\uD83D\uDC2A',hp:15,ac:10,atk:0,dmg:0,       speed:0.4,food:6, danger:false,pet:false,terrain:[T.DESERT]},
  gorilla: {emoji:'\uD83E\uDD8D',hp:20,ac:12,atk:6,dmg:'2d6',   speed:0.4,food:5, danger:true, pet:false,terrain:[T.JUNGLE]},
  boar:    {emoji:'\uD83D\uDC17',hp:11,ac:12,atk:3,dmg:'1d6',   speed:0.5,food:4, danger:true, pet:false,terrain:[T.FOREST,T.PLAINS]},
  scorpion:{emoji:'\uD83E\uDD82',hp:3, ac:15,atk:2,dmg:'1d4+poison',speed:0.2,food:0,danger:true,pet:false,terrain:[T.DESERT]},
  bee:     {emoji:'\uD83D\uDC1D',hp:1, ac:16,atk:1,dmg:'1d2+poison',speed:0.9,food:0,danger:true,pet:false,terrain:[T.JUNGLE,T.FOREST]},
  crocodile:{emoji:'\uD83D\uDC0A',hp:18,ac:12,atk:5,dmg:'2d8',speed:0.3,food:6,danger:true,pet:false,terrain:[T.JUNGLE,T.BEACH]},
  turtle:  {emoji:'\uD83D\uDC22',hp:8, ac:16,atk:0,dmg:0,       speed:0.1,food:3, danger:false,pet:false,terrain:[T.BEACH]},
  parrot:  {emoji:'\uD83E\uDD9C',hp:3, ac:14,atk:0,dmg:0,       speed:0.8,food:1, danger:false,pet:true, terrain:[T.JUNGLE]},
  spider:  {emoji:'\uD83D\uDD77\uFE0F',hp:2, ac:15,atk:2,dmg:'1d4+poison',speed:0.3,food:0,danger:true,pet:false,terrain:[T.JUNGLE,T.TAIGA]},
  deer:    {emoji:'\uD83E\uDD8C',hp:8, ac:12,atk:0,dmg:0,       speed:0.7,food:5, danger:false,pet:false,terrain:[T.FOREST,T.PLAINS,T.TAIGA]},
  owl:     {emoji:'\uD83E\uDD89',hp:4, ac:14,atk:2,dmg:'1d4',   speed:0.7,food:1, danger:false,pet:false,terrain:[T.FOREST,T.TAIGA]},
  shark:   {emoji:'\uD83E\uDD88',hp:22,ac:12,atk:6,dmg:'2d8',   speed:0.8,food:0, danger:true,pet:false,terrain:[T.OCEAN],water:true},
  whale:   {emoji:'\uD83D\uDC0B',hp:40,ac:10,atk:0,dmg:0,       speed:0.5,food:0, danger:false,pet:false,terrain:[T.OCEAN],water:true},
  dolphin: {emoji:'\uD83D\uDC2C',hp:12,ac:13,atk:0,dmg:0,       speed:0.9,food:0, danger:false,pet:false,terrain:[T.OCEAN],water:true},
};
const MAX_ANIMALS = 800;

function rollD(n) { return 1 + Math.floor(Math.random() * n); }
function rollDmg(str) {
  if (!str || str === 0) return 0;
  const s = String(str);
  const poison = s.includes('+poison');
  const base = s.replace('+poison','');
  const m = base.match(/(\d+)d(\d+)/);
  if (!m) return 0;
  let total = 0;
  for (let i = 0; i < parseInt(m[1]); i++) total += rollD(parseInt(m[2]));
  return total;
}

function createAnimal(type, x, y) {
  const t = ANIMAL_TYPES[type];
  return {
    id:'a_'+Math.random().toString(36).slice(2,8),
    type, x, y, hp:t.hp, maxHp:t.hp, ac:t.ac,
    state:'idle', target:null, path:[], timer:0, moveTimer:0,
    owner:null, followTicks:0,
  };
}

// Populated from init message
let CITIES = [], CULTURES = {}, DWARF_NAMES = [], SURNAMES = [];
let AI_API_BASE = '';

// Worker state
const G = {
  map:[], tick:0, speed:1, paused:false,
  year:1, season:0,
  dwarves:[], usedNames:new Set(),
  animals:[], animalGrid:{},
  stats:{mined:0,built:0,farmed:0},
  graves:{}, yearResolutions:[], suburbs:[], dirtTiles:[], upgradeFrom:{},
  homeCity:null, aiCityIndex:0, dwarfGrid:{},
  mapDeltas:{},
  routeDwarfId:null,
  popRebalancePending:true,
};

// Message buffers
const pendingLogs = [], pendingToasts = [], pendingMapChanges = [], pendingGraves = [];
function log(msg, type, rarity, cityEmoji, lx, ly) { pendingLogs.push({msg,type,rarity:rarity||1,season:G.season,cityEmoji:cityEmoji||null,lx:lx??null,ly:ly??null}); }
function mapSet(x, y, tile) { G.map[y][x] = tile; G.mapDeltas[`${x},${y}`] = tile; pendingMapChanges.push({x,y,tile}); }
const GRAVE_EMOJIS = ['🪦','💀','☠️','⚰️','🕯️'];
function placeGrave(d, cause) {
  const wx = wrapX(d.x);
  if (G.map[d.y] && G.map[d.y][wx] !== T.OCEAN) {
    mapSet(wx, d.y, T.GRAVE);
    const gd = {name:d.name, emoji:GRAVE_EMOJIS[Math.floor(Math.random()*GRAVE_EMOJIS.length)], cause:cause||'Unknown', age:d.age??20, cityId:d.cityId};
    G.graves[`${wx},${d.y}`] = gd;
    pendingGraves.push({x:wx, y:d.y, ...gd});
  }
}

// Helpers
function wrapX(x) { return ((x % MAP_W) + MAP_W) % MAP_W; }
function wrapY(y) { return ((y % MAP_H) + MAP_H) % MAP_H; }
function cityById(id) { return CITIES.find(c => c.id === id) || G.suburbs.find(s => s.id === id); }
function cityOf(d) { return cityById(d.cityId) || CITIES[0]; }
function townPopulation(town) { return G.dwarves.filter(d => d.cityId === town.id).length; }
function settlementPopCap(town) { return town.id?.startsWith('suburb_') ? SUBURB_POP_CAP : TOWN_POP_CAP; }
function cityPopulationCounts() {
  const counts = new Map();
  for (const d of G.dwarves) if (!d.dead) counts.set(d.cityId, (counts.get(d.cityId) || 0) + 1);
  return counts;
}
function rebalanceEmptyCities() {
  const counts = cityPopulationCounts();
  let fixed = 0;
  for (const city of CITIES) {
    if (!city.res || city.mx === undefined || (counts.get(city.id) || 0) > 0) continue;
    if (G.dwarves.length < WORLD_POP_HARD_CAP) {
      const before = G.dwarves.length;
      spawnDwarfAtCity(city);
      if (G.dwarves.length > before) {
        counts.set(city.id, 1);
        fixed++;
        continue;
      }
    }
    const donor = G.dwarves
      .filter(d => !d.dead && (d.age ?? 20) >= 20 && d.cityId !== city.id && (counts.get(d.cityId) || 0) > 1)
      .sort((a, b) => (counts.get(b.cityId) || 0) - (counts.get(a.cityId) || 0))[0];
    if (!donor) continue;
    const oldCityId = donor.cityId;
    const land = findNearbyLand(city.mx, city.my);
    if (!land) continue;
    counts.set(oldCityId, (counts.get(oldCityId) || 1) - 1);
    donor.cityId = city.id; donor.x = land[0]; donor.y = land[1];
    donor.target = null; donor.path = []; donor.state = 'idle'; donor.travelMode = null;
    donor.hunger = Math.max(donor.hunger || 80, 70);
    donor.energy = Math.max(donor.energy || 80, 70);
    donor.happiness = Math.min(100, (donor.happiness || 70) + 5);
    counts.set(city.id, 1);
    fixed++;
    log(`🏘️ ${donor.name} resettled ${city.name}`, 'system', 3, city.emoji, city.mx, city.my);
    addEvent(donor, 'home', `Resettled ${city.name}`);
  }
  return fixed;
}
function hasEmptyCities() {
  const counts = cityPopulationCounts();
  return CITIES.some(c => c.res && c.mx !== undefined && (counts.get(c.id) || 0) === 0);
}
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
function defaultRes() { return {stone:0,wood:0,food:50,iron:0,gold:0,cloth:0,ale:0,herbs:0,tools:0,relics:0,beds:0,tables:0}; }

const INDUSTRY_NAMES = { ale:'ale', cloth:'cloth', iron:'iron', gold:'gold', tools:'tools', relics:'relics' };
const INDUSTRY_RECIPES = [
  { out: 'ale', amount: 1, cost: { food: 32, herbs: 4 } },
  { out: 'cloth', amount: 1, cost: { food: 64, herbs: 8 } },
  { out: 'iron', amount: 1, cost: { stone: 128, wood: 32 } },
  { out: 'gold', amount: 1, cost: { iron: 64, ale: 32 } },
  { out: 'tools', amount: 1, cost: { iron: 128, wood: 64, cloth: 16 } },
  { out: 'relics', amount: 1, cost: { gold: 16, tools: 8, ale: 128, stone: 256 } },
];

function industryReserve(key, cityPop) {
  if (key === 'food') return 50 + cityPop * 8;
  if (key === 'wood' || key === 'stone') return 8;
  if (key === 'iron' || key === 'cloth' || key === 'ale' || key === 'herbs') return 4;
  if (key === 'gold' || key === 'tools') return 1;
  return 0;
}

function industryCapacity(counts) {
  return Math.max(0, Math.min(8, (counts.tableCount || 0) + (counts.factoryCount || 0) * 4));
}

function industryScale(owned, produced) {
  const ownedTier = Math.max(0, Math.floor(Math.log2((owned || 0) + 1)) - 4);
  return 2 ** Math.min(6, ownedTier + produced);
}

function scaleIndustryCost(cost, owned, produced) {
  const scale = industryScale(owned, produced);
  const scaled = {};
  for (const [key, amount] of Object.entries(cost)) scaled[key] = amount * scale;
  return scaled;
}

function canPayIndustry(res, cost, cityPop) {
  for (const [key, amount] of Object.entries(cost)) {
    if ((res[key] || 0) - amount < industryReserve(key, cityPop)) return false;
  }
  return true;
}

function payIndustry(res, cost) {
  for (const [key, amount] of Object.entries(cost)) res[key] = (res[key] || 0) - amount;
}

function runCityIndustry(city, counts, cityPop) {
  const res = city.res;
  const capacity = industryCapacity(counts);
  if (!res || capacity <= 0) return null;
  const made = {};
  let total = 0;
  for (const recipe of INDUSTRY_RECIPES) {
    let batches = 0;
    while (batches < capacity) {
      const cost = scaleIndustryCost(recipe.cost, res[recipe.out] || 0, made[recipe.out] || 0);
      if (!canPayIndustry(res, cost, cityPop)) break;
      payIndustry(res, cost);
      res[recipe.out] = (res[recipe.out] || 0) + recipe.amount;
      made[recipe.out] = (made[recipe.out] || 0) + recipe.amount;
      batches++;
      total++;
    }
  }
  return total > 0 ? made : null;
}

function formatIndustry(made) {
  return Object.entries(made).map(([key, amount]) => `+${amount} ${INDUSTRY_NAMES[key] || key}`).join(', ');
}

function createSuburb(x, y, parentCityId, founderName) {
  const parent = cityById(parentCityId);
  return {
    id: 'suburb_' + Math.random().toString(36).slice(2, 8),
    parentCityId,
    culture: parent?.culture || 'american',
    name: founderName.split(' ')[1] + ' Homestead',
    emoji: '🏠',
    mx: x, my: y,
    res: defaultRes(),
    foundedSeason: G.season + G.year * 4,
  };
}

function checkSuburbPromotion() {
  const BUILDING_TILES = new Set([T.BED, T.STOCKPILE, T.TABLE, T.FLOOR, T.FACTORY]);
  for (let i = G.suburbs.length - 1; i >= 0; i--) {
    const sub = G.suburbs[i];
    const age = (G.season + G.year * 4) - sub.foundedSeason;
    if (age < 2) continue;
    let buildings = 0;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const x = wrapX(sub.mx + dx), y = sub.my + dy;
        if (y >= 0 && y < MAP_H && BUILDING_TILES.has(G.map[y][x])) buildings++;
      }
    if (buildings < 3) continue;
    const residents = G.dwarves.filter(d => d.cityId === sub.id).length;
    if (residents < 2) continue;
    if (CITIES.length >= 60) continue;
    mapSet(sub.mx, sub.my, T.CITY);
    const cityName = sub.name.replace(' Homestead', 'burg');
    const newCity = {
      id: sub.id, name: cityName, emoji: '🏘️',
      lon: 0, lat: 0,
      culture: sub.culture,
      mx: sub.mx, my: sub.my,
      res: {...sub.res},
    };
    CITIES.push(newCity);
    G.suburbs.splice(i, 1);
    G.roadGraphDirty = true;
    log(`🏘️ ${cityName} has grown into a town!`, 'system', 5, null, sub.mx, sub.my);
  }
}

// Pathfinding
function isWalkable(x, y) {
  const t = G.map[wrapY(y)][wrapX(x)];
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
  while (pq.length > 0 && steps < 30000) {
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
      if (ny < 0 || ny >= MAP_H) continue;
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
  const t = G.map[wrapY(y)][wrapX(x)];
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
  while (queue.length > 0 && steps < 20000) {
    const [cx, cy] = queue.shift(); steps++;
    if (goalFn(wrapX(cx), cy) && !(cx === sx && cy === sy)) {
      const path = []; let cur = [cx, cy];
      while (cur[0] !== sx || cur[1] !== sy) { path.unshift([wrapX(cur[0]), cur[1]]); cur = par.get(key(cur[0], cur[1])); }
      return path;
    }
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (ny < 0 || ny >= MAP_H) continue;
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
  const sex = Math.random() < 0.5 ? 'M' : 'F';
  let first, last;
  if (culture) {
    const gendered = culture.firstNames.filter((_,i) => sex === 'M' ? i%2===0 : i%2===1);
    first = gendered.length ? gendered[Math.floor(Math.random()*gendered.length)] : culture.firstNames[Math.floor(Math.random()*culture.firstNames.length)];
    last = culture.lastNames[Math.floor(Math.random()*culture.lastNames.length)];
  } else {
    first = DWARF_NAMES[Math.floor(Math.random()*DWARF_NAMES.length)];
    last = SURNAMES[Math.floor(Math.random()*SURNAMES.length)];
  }
  const culturalTrait = culture ? culture.traits[Math.floor(Math.random()*culture.traits.length)] : null;
  const stats = {STR:roll3d6(),DEX:roll3d6(),CON:roll3d6(),INT:roll3d6(),WIS:roll3d6(),CHA:roll3d6()};
  const maxHp = 8 + Math.floor(stats.CON / 3);
  return {
    id:'d_'+Math.random().toString(36).slice(2,8),
    name:first+' '+last, x, y, cityId:cityId||'',
    hunger:80+Math.random()*20, energy:80+Math.random()*20,
    happiness:70+Math.random()*20,
    state:'idle', target:null, path:[], timer:0,
    color:`hsl(${Math.floor(Math.random()*360)},55%,55%)`,
    stats,
    hp:maxHp, maxHp, ac:10+Math.floor((stats.DEX-10)/2), poisonTicks:0, combatTarget:null,
    faith:Math.floor(Math.random()*101),
    morality:Math.floor(Math.random()*101),
    ambition:Math.floor(Math.random()*101),
    traits:culturalTrait?[culturalTrait]:[],
    backstory:'', eventLog:[],
    age:20+Math.floor(Math.random()*30),
    carrying:0, carryItems:{}, inventory:[],
    sex,
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
  if (cityPop >= settlementPopCap(city)) return;
  if (G.dwarves.length >= WORLD_POP_HARD_CAP) return;
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
  log(`${d.name} has arrived at ${city.name}!`, 'system', 3, null, d.x, d.y);
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
  if (d.state !== 'traveling' && !isWalkable(d.x, d.y)) {
    const city = cityOf(d);
    if (city.mx !== undefined) {
      const land = findNearbyLand(city.mx, city.my) || findNearbyLand(d.x, d.y);
      if (land) {
        d.x = land[0]; d.y = land[1];
        d.state = 'idle'; d.target = null; d.path = [];
        log(`${d.name} was rescued from the sea!`, 'system', 3, null, d.x, d.y);
      }
    }
  }
  // HP system
  if (!d.maxHp) { d.maxHp = 8 + Math.floor((d.stats?.CON||10)/3); d.hp = d.hp ?? d.maxHp; d.ac = d.ac ?? 10+Math.floor(((d.stats?.DEX||10)-10)/2); }
  if (d.hp <= 0) { d.state = 'dead'; d.dead = true; placeGrave(d, 'Died in combat'); log(`${d.name} \u2620\uFE0F has died!`, 'system', 4, null, d.x, d.y); addEvent(d, 'death', 'Died in combat'); return; }
  if (d.poisonTicks > 0) { d.hp -= 1; d.poisonTicks--; if (d.poisonTicks === 0) log(`${d.name} recovered from poison`, 'system', 2, null, d.x, d.y); }
  if (d.hp < d.maxHp && d.hunger > 20 && d.energy > 30 && G.tick % 50 === 0) d.hp = Math.min(d.maxHp, d.hp + 1);

  // Flee from dangerous animals (low HP or weak STR)
  if (d.state !== 'fleeing' && d.state !== 'traveling' && d.hp <= d.maxHp * 0.6) {
    const nearby = nearbyAnimals(d.x, d.y);
    for (const a of nearby) {
      if (a.dead) continue;
      const at = ANIMAL_TYPES[a.type];
      if (!at || !at.danger) continue;
      const dx = Math.abs(d.x - a.x), dy = Math.abs(d.y - a.y);
      if (dx <= 3 && dy <= 3) {
        d.state = 'fleeing'; d.target = null; d.path = []; d.fleeFrom = {x:a.x, y:a.y}; d.timer = 8 + rollD(6);
        break;
      }
    }
  }
  if (d.state === 'fleeing') {
    d.timer--;
    if (d.timer <= 0) { d.state = 'idle'; d.fleeFrom = null; return; }
    if (d.fleeFrom && Math.random() < 0.7) {
      const fx = d.x > d.fleeFrom.x ? 1 : d.x < d.fleeFrom.x ? -1 : (Math.random()<0.5?1:-1);
      const fy = d.y > d.fleeFrom.y ? 1 : d.y < d.fleeFrom.y ? -1 : (Math.random()<0.5?1:-1);
      const nx = wrapX(d.x + fx), ny = d.y + fy;
      if (ny >= 0 && ny < MAP_H && isWalkable(nx, ny)) { d.x = nx; d.y = ny; }
    }
    return;
  }

  // Children (age 0-19): reduced needs drain, wander near city, no work
  const isChild = (d.age ?? 20) < 20;
  d.hunger = Math.max(0, d.hunger - (isChild ? 0.015 : 0.03));
  d.energy = Math.max(0, d.energy - (isChild ? 0.01 : 0.02));
  d.happiness = Math.max(0, Math.min(100, d.happiness - 0.005));
  if (d.hunger <= 0) {
    d.starveTicks = (d.starveTicks || 0) + 1;
    if (d.starveTicks >= STARVE_DEATH) {
      log(`${d.name} \u2620\uFE0F starved to death`, 'system', 4, null, d.x, d.y);
      addEvent(d, 'death', 'Died of starvation');
      placeGrave(d, 'Starved to death'); d.dead = true; return;
    }
    if (d.starveTicks >= STARVE_IMMOBILE && d.state !== 'starving') {
      d.state = 'starving'; d.target = null; d.path = [];
      log(`${d.name} \uD83D\uDE35 is too weak to move \u2014 needs food!`, 'system', 3, null, d.x, d.y);
    }
  } else { d.starveTicks = 0; }
  if (d.state === 'starving') { tryShareFood(d); return; }
  if (d.hunger < 20 && d.state !== 'eating' && d.state !== 'going_eat'
      && d.state !== 'wander' && d.state !== 'seek_food' && d.state !== 'traveling') {
    d.state = 'seek_food'; d.target = null; d.path = [];
  } else if (d.energy < 15 && d.state !== 'sleeping' && d.state !== 'going_sleep'
      && d.state !== 'wander' && d.state !== 'seek_sleep' && d.state !== 'traveling') {
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
    case 'going_rescue': aiWalk(d); break;
    case 'traveling': aiTravel(d); break;
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
    log(`${other.name} \uD83E\uDD1D shared food with ${d.name}`, 'eat', 2, null, d.x, d.y);
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
      if (give && other.inventory.length < MAX_INVENTORY) other.inventory.push(give);
      if (get1 && d.inventory.length < MAX_INVENTORY) d.inventory.push(get1);
      if (get2 && d.inventory.length < MAX_INVENTORY) d.inventory.push(get2);
      const gaveStr = give ? give.emoji+give.name : '?';
      const gotStr = [get1,get2].filter(Boolean).map(i => i.emoji+i.name).join(', ') || '?';
      log(`${d.name} \uD83E\uDD1D outsmarted ${other.name}: gave ${gaveStr}, got ${gotStr}`, 'trade', 2, null, d.x, d.y);
      addEvent(d, 'trade', `Gave ${gaveStr} to ${other.name}, got ${gotStr} (favorable)`);
      addEvent(other, 'trade', `Gave ${gotStr} to ${d.name}, got ${gaveStr} (unfavorable)`);
    } else if (intDiff <= -5) {
      const give1 = d.inventory.shift();
      const give2 = d.inventory.length > 0 ? d.inventory.shift() : null;
      const get = other.inventory.shift();
      if (give1 && other.inventory.length < MAX_INVENTORY) other.inventory.push(give1);
      if (give2 && other.inventory.length < MAX_INVENTORY) other.inventory.push(give2);
      if (get && d.inventory.length < MAX_INVENTORY) d.inventory.push(get);
      const gaveStr = [give1,give2].filter(Boolean).map(i => i.emoji+i.name).join(', ') || '?';
      const gotStr = get ? get.emoji+get.name : '?';
      log(`${other.name} \uD83E\uDD1D outsmarted ${d.name}: ${d.name} gave ${gaveStr}, got ${gotStr}`, 'trade', 2, null, d.x, d.y);
      addEvent(d, 'trade', `Gave ${gaveStr} to ${other.name}, got ${gotStr} (unfavorable)`);
      addEvent(other, 'trade', `Gave ${gotStr} to ${d.name}, got ${gaveStr} (favorable)`);
    } else {
      const give = d.inventory.shift();
      const get = other.inventory.shift();
      if (give && other.inventory.length < MAX_INVENTORY) other.inventory.push(give);
      if (get && d.inventory.length < MAX_INVENTORY) d.inventory.push(get);
      const gaveStr = give ? give.emoji+give.name : '?';
      const gotStr = get ? get.emoji+get.name : '?';
      log(`${d.name} \uD83E\uDD1D traded with ${other.name}: ${gaveStr} \u2194 ${gotStr}`, 'trade', 2, null, d.x, d.y);
      addEvent(d, 'trade', `Traded ${gaveStr} for ${gotStr} with ${other.name}`);
      addEvent(other, 'trade', `Traded ${gotStr} for ${gaveStr} with ${d.name}`);
    }
    d.happiness = Math.min(100, d.happiness + 3);
    other.happiness = Math.min(100, other.happiness + 3);
    return true;
  }
  return false;
}

function findVehicleRoute(fromCity, toCity, minRoad) {
  const allowedTiles = minRoad === T.RAILROAD ? new Set([T.RAILROAD,T.CITY,T.FACTORY])
    : minRoad === T.ASPHALT ? new Set([T.ASPHALT,T.RAILROAD,T.CITY,T.FACTORY])
    : minRoad === T.PATH ? new Set([T.PATH,T.ROAD,T.ASPHALT,T.RAILROAD,T.CITY,T.FACTORY])
    : new Set([T.ROAD,T.ASPHALT,T.RAILROAD,T.CITY,T.FACTORY]);
  const visited = new Set();
  const parent = new Map();
  const queue = [[fromCity.mx, fromCity.my]];
  const startKey = `${fromCity.mx},${fromCity.my}`;
  visited.add(startKey);
  while (queue.length > 0) {
    const [cx,cy] = queue.shift();
    if (cx === toCity.mx && cy === toCity.my) {
      const path = [];
      let k = `${cx},${cy}`;
      while (k !== startKey) {
        const [px,py] = k.split(',').map(Number);
        path.unshift([px,py]);
        k = parent.get(k);
      }
      return path;
    }
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = wrapX(cx+dx), ny = cy+dy;
      if (ny < 0 || ny >= MAP_H) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (!allowedTiles.has(G.map[ny][nx])) continue;
      visited.add(key);
      parent.set(key, `${cx},${cy}`);
      queue.push([nx,ny]);
    }
    if (visited.size > 30000) break;
  }
  return null;
}


function findRoadGap(dx, dy, radius) {
  const ROAD_SET = new Set([T.PATH, T.ROAD, T.ASPHALT, T.RAILROAD]);
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for (let r = 1; r <= radius; r++) {
    for (const [ddx, ddy] of dirs) {
      const x1 = wrapX(dx + ddx * r), y1 = dy + ddy * r;
      if (y1 < 0 || y1 >= MAP_H) continue;
      const t1 = G.map[y1][x1];
      if (!ROAD_SET.has(t1)) continue;
      // Found a road tile — look backward for gap then road
      for (let gap = 1; gap <= 2; gap++) {
        const gx = wrapX(dx + ddx * (r - gap)), gy = dy + ddy * (r - gap);
        if (gy < 0 || gy >= MAP_H) break;
        const gt = G.map[gy][gx];
        if (ROAD_SET.has(gt)) break; // no gap
        if (!isWalkable(gx, gy)) break;
        // Check tile before gap is road
        const bx = wrapX(dx + ddx * (r - gap - 1)), by = dy + ddy * (r - gap - 1);
        if (by < 0 || by >= MAP_H) continue;
        if (ROAD_SET.has(G.map[by][bx])) {
          return {x: gx, y: gy};
        }
      }
    }
  }
  return null;
}

function chainLen(x, y, type) {
  let total = 0;
  const dirs = [[0,-1],[0,1],[1,0],[-1,0]];
  for (const [ddx, ddy] of dirs) {
    for (let i = 1; i <= 20; i++) {
      const nx = wrapX(x + ddx * i), ny = y + ddy * i;
      if (ny < 0 || ny >= MAP_H || G.map[ny][nx] !== type) break;
      total++;
    }
  }
  return total;
}

function bestUpgradeTarget(dx, dy, res) {
  let toType, fromType;
  if (res.iron >= 3 && res.wood >= 2) { fromType = T.ASPHALT; toType = T.RAILROAD; }
  else if (res.stone >= 2 && res.iron >= 1) { fromType = T.ROAD; toType = T.ASPHALT; }
  else if (res.stone >= 1) { fromType = T.PATH; toType = T.ROAD; }
  else return null;
  const radius = 15;
  let best = null, bestScore = -1, bestDist = Infinity;
  for (let oy = -radius; oy <= radius; oy++) {
    const ny = dy + oy;
    if (ny < 0 || ny >= MAP_H) continue;
    for (let ox = -radius; ox <= radius; ox++) {
      const nx = wrapX(dx + ox);
      if (G.map[ny][nx] !== fromType) continue;
      const score = chainLen(nx, ny, toType);
      const dist = Math.abs(ox) + Math.abs(oy);
      if (score > bestScore || (score === bestScore && dist < bestDist)) {
        best = {x:nx, y:ny, fromType, toType};
        bestScore = score;
        bestDist = dist;
      }
    }
  }
  return best;
}

function isOrphanRoad(x, y) {
  const ROAD_LIKE = new Set([T.PATH, T.ROAD, T.ASPHALT, T.RAILROAD, T.CITY, T.FACTORY]);
  let neighbors = 0;
  const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
  for (const [ddx, ddy] of dirs) {
    const nx = wrapX(x+ddx), ny = y+ddy;
    if (ny >= 0 && ny < MAP_H && ROAD_LIKE.has(G.map[ny][nx])) neighbors++;
  }
  if (neighbors === 0) return true;
  const visited = new Set(), queue = [`${x},${y}`];
  visited.add(queue[0]);
  while (queue.length && visited.size <= 8) {
    const [cx, cy] = queue.shift().split(',').map(Number);
    if (G.map[cy][cx] === T.CITY || G.map[cy][cx] === T.FACTORY) return false;
    for (const [ddx, ddy] of dirs) {
      const nx = wrapX(cx+ddx), ny = cy+ddy;
      const k = `${nx},${ny}`;
      if (ny >= 0 && ny < MAP_H && !visited.has(k) && ROAD_LIKE.has(G.map[ny][nx])) {
        visited.add(k); queue.push(k);
      }
    }
  }
  return true;
}


function aiIdle(d) {
  if (d._tickSlot === undefined) d._tickSlot = G.dwarves.indexOf(d) % 4;
  if (G.tick % 4 !== d._tickSlot) return;
  if ((d.age ?? 20) < 20) { d.state = 'wander'; d.timer = 15 + Math.floor(Math.random() * 20); return; }
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
          log(`${d.name} \uD83E\uDD1D rescued ${starving.name} with food!`, 'eat', 2, null, d.x, d.y);
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
  if (tryMoveIntoEmptyTown(d)) return;

  // Cargo-laden dwarves prefer travel — gets vehicles/ships rolling.
  if ((d.carrying||0) >= carryCapacity(d) * 0.7 && Math.random() < 0.4 && tryTravel(d)) return;

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
  {
    const rp = bfs(d.x, d.y, (x,y) => G.map[y][x] === T.D_ROAD || G.map[y][x] === T.D_UPGRADE, false);
    if (rp) {
      const last = rp[rp.length-1];
      const tile = G.map[last[1]][last[0]];
      if (tile === T.D_ROAD) {
        d.target = {type:'road',x:last[0],y:last[1]}; d.path = rp; d.state = 'walk'; return;
      }
      if (tile === T.D_UPGRADE) {
        d.target = {type:'upgrade_road',x:last[0],y:last[1]}; d.path = rp; d.state = 'walk'; return;
      }
    }
  }
  if (Math.random() < 0.2) {
    const gap = findRoadGap(d.x, d.y, 10);
    if (gap) {
      const gp = bfs(d.x, d.y, (x,y) => x === gap.x && y === gap.y, false);
      if (gp) { d.target = {type:'fix_road',x:gap.x,y:gap.y}; d.path = gp; d.state = 'walk'; return; }
    }
  }
  if (Math.random() < 0.05) {
    const SCRAP_ROAD = new Set([T.PATH, T.ROAD, T.ASPHALT, T.RAILROAD]);
    const sp = bfs(d.x, d.y, (x,y) => SCRAP_ROAD.has(G.map[y][x]) && isOrphanRoad(x, y), false);
    if (sp && sp.length < 20) {
      const last = sp[sp.length-1];
      d.target = {type:'scrap_road', x:last[0], y:last[1]};
      d.path = sp; d.state = 'walk'; return;
    }
  }
  if (((res.stone >= 1) || (res.stone >= 2 && res.iron >= 1) || (res.iron >= 3 && res.wood >= 2)) && Math.random() < 0.15) {
    const best = bestUpgradeTarget(d.x, d.y, res);
    if (best) {
      const rrp = bfs(d.x, d.y, (x,y) => x === best.x && y === best.y, false);
      if (rrp && rrp.length < 30) {
        d.target = {type:'upgrade_road',x:best.x,y:best.y}; d.path = rrp; d.state = 'walk'; return;
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
  if (Math.random() < 0.01 && tryFoundSuburb(d)) return;
  if (Math.random() < 0.02 && tryRelocateToSuburb(d)) return;
  if (Math.random() < 0.30 && tryTravel(d)) return;
  d.state = 'wander'; d.timer = 20 + Math.floor(Math.random() * 40);
}

function aiWalk(d) {
  if (d.path.length === 0) {
    if (!d.target) { d.state = 'idle'; return; }
    const tt = d.target.type;
    if (tt === 'mine' || tt === 'chop') d.state = 'mining';
    else if (tt === 'build' || tt === 'road' || tt === 'upgrade_road' || tt === 'fix_road') d.state = 'building';
    else if (tt === 'farm') d.state = 'farming';
    else if (tt === 'gather') d.state = 'gathering';
    else if (tt === 'eat') d.state = 'eating';
    else if (tt === 'sleep') d.state = 'sleeping';
    else if (tt === 'craft') d.state = 'crafting';
    else if (tt === 'deposit') {
      const total = depositCarry(d);
      if (total) { log(`${d.name} \uD83D\uDCE6 deposited ${total} items at stockpile`, 'haul', 2, null, d.x, d.y); addEvent(d, 'haul', `Deposited ${total} items`); }
      d.target = null; d.timer = 0; d.state = 'idle'; return;
    } else if (tt === 'rescue_feed') {
      const starving = G.dwarves.find(o => o.id === d.target.dwarfId);
      if (starving && d.carryItems?.food > 0) {
        const amt = Math.min(d.carryItems.food, 3);
        d.carryItems.food -= amt; d.carrying -= amt;
        starving.hunger = Math.min(100, starving.hunger + amt * 12);
        starving.starveTicks = 0; starving.state = 'idle';
        log(`${d.name} \uD83E\uDD1D rescued ${starving.name} with food!`, 'eat', 2, null, d.x, d.y);
      }
      d.target = null; d.state = 'idle'; return;
    } else if (tt === 'trade_caravan') {
      const destCity = CITIES.find(c => c.id === d.target.cityId);
      if (destCity && destCity.res && d.carrying > 0) {
        const good = d.target.good;
        const amt = d.carryItems[good] || d.carrying;
        destCity.res[good] = (destCity.res[good] || 0) + amt;
        // Get something back that dest has surplus of
        const keys = ['food','wood','stone','iron','gold','cloth','ale','herbs','tools','relics'];
        let returnGood = null, returnAmt = 0;
        for (const k of keys) {
          if (k === good) continue;
          if ((destCity.res[k] || 0) > 15) { returnGood = k; returnAmt = Math.min(Math.floor(destCity.res[k] / 3), amt); break; }
        }
        if (returnGood && returnAmt > 0) {
          destCity.res[returnGood] -= returnAmt;
          d.carrying = returnAmt; d.carryItems = { [returnGood]: returnAmt };
          log(`${d.name} \uD83D\uDC2A delivered ${amt} ${good} to ${destCity.name}, returning with ${returnAmt} ${returnGood}`, 'trade', 3, null, d.x, d.y);
          addEvent(d, 'trade', `Traded ${amt} ${good} at ${destCity.name} for ${returnAmt} ${returnGood}`);
        } else {
          d.carrying = 0; d.carryItems = {};
          log(`${d.name} \uD83D\uDC2A delivered ${amt} ${good} to ${destCity.name}`, 'trade', 2, null, d.x, d.y);
          addEvent(d, 'trade', `Delivered ${amt} ${good} to ${destCity.name}`);
        }
        d.happiness = Math.min(100, d.happiness + 10);
      }
      d.target = null; d.state = 'idle'; return;
    } else if (tt === 'move_town') {
      const town = cityById(d.target.cityId);
      if (town && town.res) {
        d.cityId = town.id; d.x = town.mx; d.y = town.my;
        d.happiness = Math.min(100, d.happiness + 8);
        log(`🏘️ ${d.name} moved into empty ${town.name}`, 'system', 3, town.emoji, town.mx, town.my);
        addEvent(d, 'home', `Moved into ${town.name}`);
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
      log(`${d.name} \u26cf\uFE0F mined ${stoneAmt} stone${extra}`, 'mine', 1, null, d.x, d.y);
      addEvent(d, 'mine', `Mined ${stoneAmt} stone${extra}`);
      d.happiness = Math.min(100, d.happiness + 2);
      tryCraftInventoryGain(d, tile);
    } else if (d.target.type === 'chop' && (tile === T.FOREST || tile === T.TAIGA || tile === T.JUNGLE)) {
      mapSet(x, y, T.PLAINS);
      addCarry(d, 'wood', 3);
      log(`${d.name} \uD83EA93 chopped wood`, 'haul', 1, null, d.x, d.y);
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
    if (G.map[y][x] === T.D_ROAD) {
      mapSet(x, y, T.PATH); G.stats.built++; G.roadGraphDirty = true;
      log(`${d.name} 👣 cleared a dirt path`, 'build', 1, null, d.x, d.y);
      addEvent(d, 'build', 'Cleared a path');
      d.happiness = Math.min(100, d.happiness + 1);
    } else if (d.target.type === 'fix_road' && isWalkable(x, y) && G.map[y][x] !== T.PATH && G.map[y][x] !== T.ROAD && G.map[y][x] !== T.ASPHALT && G.map[y][x] !== T.RAILROAD) {
      mapSet(x, y, T.PATH); G.stats.built++; G.roadGraphDirty = true;
      log(`${d.name} 🔧 repaired a road gap`, 'build', 2, null, d.x, d.y);
      addEvent(d, 'build', 'Repaired a road gap');
      d.happiness = Math.min(100, d.happiness + 3);
    } else if (d.target.type === 'upgrade_road' && G.map[y][x] === T.D_UPGRADE) {
      const key = `${x},${y}`;
      const orig = G.upgradeFrom[key] ?? T.PATH;
      delete G.upgradeFrom[key];
      if (orig === T.PATH && res.stone >= 1) {
        res.stone -= 1; mapSet(x, y, T.ROAD); G.stats.built++; G.roadGraphDirty = true;
        log(`${d.name} 🟫 upgraded path to gravel road`, 'build', 1, null, d.x, d.y);
        addEvent(d, 'build', 'Upgraded path to gravel');
        d.happiness = Math.min(100, d.happiness + 2);
      } else if (orig === T.ROAD && res.stone >= 2 && res.iron >= 1) {
        res.stone -= 2; res.iron -= 1; mapSet(x, y, T.ASPHALT); G.stats.built++; G.roadGraphDirty = true;
        log(`${d.name} ⬛ upgraded road to asphalt!`, 'build', 2, null, d.x, d.y);
        addEvent(d, 'build', 'Upgraded road to asphalt');
        d.happiness = Math.min(100, d.happiness + 3);
      } else if (orig === T.ASPHALT && res.iron >= 3 && res.wood >= 2) {
        res.iron -= 3; res.wood -= 2; mapSet(x, y, T.RAILROAD); G.stats.built++; G.roadGraphDirty = true;
        log(`${d.name} 🛤️ upgraded to railroad!`, 'build', 3, null, d.x, d.y);
        addEvent(d, 'build', 'Upgraded to railroad');
        d.happiness = Math.min(100, d.happiness + 5);
      } else {
        mapSet(x, y, orig); // revert if can't afford
      }
    } else if (d.target.type === 'upgrade_road' && G.map[y][x] === T.PATH && res.stone >= 1) {
      res.stone -= 1; mapSet(x, y, T.ROAD); G.stats.built++; G.roadGraphDirty = true;
      log(`${d.name} 🟫 paved path to gravel road`, 'build', 1, null, d.x, d.y);
      addEvent(d, 'build', 'Paved path to gravel');
      d.happiness = Math.min(100, d.happiness + 2);
    } else if (d.target.type === 'upgrade_road' && G.map[y][x] === T.ROAD && res.stone >= 2 && res.iron >= 1) {
      res.stone -= 2; res.iron -= 1; mapSet(x, y, T.ASPHALT); G.stats.built++; G.roadGraphDirty = true;
      log(`${d.name} ⬛ paved road to asphalt!`, 'build', 2, null, d.x, d.y);
      addEvent(d, 'build', 'Paved road to asphalt');
      d.happiness = Math.min(100, d.happiness + 3);
    } else if (d.target.type === 'upgrade_road' && G.map[y][x] === T.ASPHALT && res.iron >= 3 && res.wood >= 2) {
      res.iron -= 3; res.wood -= 2; mapSet(x, y, T.RAILROAD); G.stats.built++; G.roadGraphDirty = true;
      log(`${d.name} 🛤️ upgraded to railroad!`, 'build', 3, null, d.x, d.y);
      addEvent(d, 'build', 'Upgraded to railroad');
      d.happiness = Math.min(100, d.happiness + 5);
    } else if (d.target.type === 'scrap_road') {
      const st = G.map[y][x];
      if (st === T.PATH || st === T.ROAD || st === T.ASPHALT || st === T.RAILROAD) {
        if (st !== T.PATH && res) res.stone = (res.stone || 0) + 1;
        mapSet(x, y, T.DIRT); G.roadGraphDirty = true;
        G.dirtTiles.push({x, y, year:G.year});
        log(`${d.name} 🧹 scrapped an orphan road`, 'build', 1, null, d.x, d.y);
        addEvent(d, 'build', 'Scrapped orphan road');
      }
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
      log(`${d.name} 🌱 planted a farm`, 'farm', 1, null, d.x, d.y);
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
          log(`${d.name} \uD83E\uDED0 gathered berries (+3 food)`, 'farm', 1, null, d.x, d.y);
          addEvent(d,'gather','Gathered berries'); d.hunger = Math.min(100,d.hunger+15); break;
        case T.HERB_PATCH:
          addCarry(d,'herbs',2); mapSet(x,y,T.PLAINS);
          log(`${d.name} \uD83C\uDF3F gathered herbs (+2 herbs)`, 'farm', 1, null, d.x, d.y);
          addEvent(d,'gather','Gathered herbs'); break;
        case T.IRON_ORE:
          addCarry(d,'iron',2); addCarry(d,'stone',1); mapSet(x,y,T.HILL);
          log(`${d.name} \u2699\uFE0F mined iron ore (+2 iron)`, 'mine', 2, null, d.x, d.y);
          addEvent(d,'gather','Mined iron ore'); break;
        case T.GOLD_VEIN:
          addCarry(d,'gold',2); mapSet(x,y,T.MOUNTAIN);
          log(`${d.name} \u2728 found gold (+2 gold)`, 'mine', 2, null, d.x, d.y);
          addEvent(d,'gather','Mined gold vein'); break;
        case T.GEMS:
          addCarry(d,'gold',5); mapSet(x,y,T.MOUNTAIN);
          log(`${d.name} \uD83D\uDC8E discovered gems! (+5 gold)`, 'mine', 3, null, d.x, d.y);
          addEvent(d,'gather','Discovered gems!'); d.happiness = Math.min(100,d.happiness+10); break;
        case T.FISH_SPOT:
          addCarry(d,'food',4); mapSet(x,y,T.OCEAN);
          log(`${d.name} \uD83D\uDC1F caught fish (+4 food)`, 'farm', 2, null, d.x, d.y);
          addEvent(d,'gather','Caught fish'); d.hunger = Math.min(100,d.hunger+10); break;
        case T.CRAB:
          addCarry(d,'food',2); mapSet(x,y,T.BEACH);
          log(`${d.name} \uD83E\uDD80 caught crabs (+2 food)`, 'farm', 2, null, d.x, d.y);
          addEvent(d,'gather','Caught crabs'); d.hunger = Math.min(100,d.hunger+8); break;
        case T.DEER:
          addCarry(d,'food',6); addCarry(d,'cloth',1); mapSet(x,y,T.PLAINS);
          log(`${d.name} \uD83E\uDD8C hunted game (+6 food, +1 cloth)`, 'mine', 2, null, d.x, d.y);
          addEvent(d,'gather','Hunted wild game'); break;
        case T.CLAY:
          addCarry(d,'stone',2); mapSet(x,y,T.BEACH);
          log(`${d.name} \uD83C\uDFFA gathered clay (+2 stone)`, 'haul', 2, null, d.x, d.y);
          addEvent(d,'gather','Gathered clay'); break;
        case T.CORAL:
          addCarry(d,'gold',1); mapSet(x,y,T.OCEAN);
          log(`${d.name} \uD83E\uDEB8 harvested coral (+1 gold)`, 'farm', 2, null, d.x, d.y);
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
        log(`${d.name} \u2728 combined ${item1.emoji}${item1.name} + ${item2.emoji}${item2.name} = ${res.result.emoji}${res.result.name}!`, 'craft', 2, null, d.x, d.y);
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
      log(`${d.name} \u2728 crafted ${fallback.emoji}${fallback.name}`, 'craft', 2, null, d.x, d.y);
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


// ---- Auto-connect cities with roads ----
function autoConnectCities() {
  // Each season, try to connect one unconnected city pair with a gravel road
  const placed = CITIES.filter(c => c.mx !== undefined && c.res);
  if (placed.length < 2) return;

  // Find closest unconnected pair
  let bestPair = null, bestDist = Infinity;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      const pairKey = [a.id, b.id].sort().join('-');
      if (G.roadGraph?.[pairKey]?.gravel) continue; // already connected
      const dx = Math.min(Math.abs(a.mx - b.mx), MAP_W - Math.abs(a.mx - b.mx));
      const dy = Math.abs(a.my - b.my);
      const dist = dx + dy;
      if (dist < bestDist && dist < 400) { bestDist = dist; bestPair = [a, b]; }
    }
  }
  if (!bestPair) return;
  const [cityA, cityB] = bestPair;

  // A* pathfind on walkable terrain, preferring existing roads
  // Include building tiles so we can path through city centers
  const roadable = new Set([T.PLAINS,T.FOREST,T.TAIGA,T.DESERT,T.TUNDRA,T.HILL,T.BEACH,
    T.PATH,T.ROAD,T.ASPHALT,T.RAILROAD,T.CITY,T.FACTORY,T.FLOOR,T.FARM,T.D_ROAD,T.D_UPGRADE,
    T.BED,T.STOCKPILE,T.TABLE,T.WALL]);
  const goal = `${cityB.mx},${cityB.my}`;
  const openSet = [{x:cityA.mx, y:cityA.my, g:0, f:0}];
  const gScore = new Map(); gScore.set(`${cityA.mx},${cityA.my}`, 0);
  const cameFrom = new Map();
  const heuristic = (x, y) => {
    const dx = Math.min(Math.abs(x - cityB.mx), MAP_W - Math.abs(x - cityB.mx));
    return dx + Math.abs(y - cityB.my);
  };
  openSet[0].f = heuristic(cityA.mx, cityA.my);
  let found = false;
  while (openSet.length > 0) {
    openSet.sort((a, b) => a.f - b.f);
    const cur = openSet.shift();
    const curKey = `${cur.x},${cur.y}`;
    if (curKey === goal) { found = true; break; }
    if (gScore.size > 30000) break;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = wrapX(cur.x + dx), ny = cur.y + dy;
      if (ny < 0 || ny >= MAP_H) continue;
      const t = G.map[ny][nx];
      if (!roadable.has(t)) continue;
      const moveCost = (t === T.PATH || t === T.ROAD || t === T.ASPHALT || t === T.RAILROAD) ? 0.3
        : (t === T.CITY || t === T.FACTORY || t === T.FLOOR) ? 0.5
        : (t === T.BED || t === T.STOCKPILE || t === T.TABLE || t === T.WALL) ? 3
        : 1;
      const tentG = cur.g + moveCost;
      const nKey = `${nx},${ny}`;
      if (tentG < (gScore.get(nKey) ?? Infinity)) {
        gScore.set(nKey, tentG);
        cameFrom.set(nKey, curKey);
        openSet.push({x:nx, y:ny, g:tentG, f:tentG + heuristic(nx, ny)});
      }
    }
  }
  if (!found) return;

  // Reconstruct path and place roads
  const path = [];
  let k = goal;
  const startKey = `${cityA.mx},${cityA.my}`;
  while (k && k !== startKey) {
    const [px, py] = k.split(',').map(Number);
    path.unshift([px, py]);
    k = cameFrom.get(k);
  }

  let roadsBuilt = 0;
  const dontOverwrite = new Set([T.PATH,T.ROAD,T.ASPHALT,T.RAILROAD,T.CITY,T.FACTORY,T.FLOOR,
    T.BED,T.STOCKPILE,T.TABLE,T.WALL,T.FARM,T.OCEAN,T.GRAVE]);
  for (const [rx, ry] of path) {
    const t = G.map[ry][rx];
    if (!dontOverwrite.has(t)) {
      mapSet(rx, ry, T.PATH);
      roadsBuilt++;
    }
  }
  if (roadsBuilt > 0) {
    G.roadGraphDirty = true;
    log(`👣 Path cleared connecting ${cityA.name} ↔ ${cityB.name} (${roadsBuilt} tiles)`, 'city', 4, null, cityA.mx, cityA.my);
  }
}

// ---- Road connectivity graph ----
function rebuildRoadGraph() {
  G.roadGraph = {};
  const tiers = [
    { name:'path', tiles:new Set([T.PATH,T.ROAD,T.ASPHALT,T.RAILROAD,T.CITY,T.FACTORY]) },
    { name:'gravel', tiles:new Set([T.ROAD,T.ASPHALT,T.RAILROAD,T.CITY,T.FACTORY]) },
    { name:'asphalt', tiles:new Set([T.ASPHALT,T.RAILROAD,T.CITY,T.FACTORY]) },
    { name:'railroad', tiles:new Set([T.RAILROAD,T.CITY,T.FACTORY]) },
  ];
  for (const tier of tiers) {
    for (const startCity of CITIES) {
      if (startCity.mx === undefined) continue;
      const visited = new Set();
      const queue = [[startCity.mx, startCity.my]];
      visited.add(`${startCity.mx},${startCity.my}`);
      let steps = 0;
      while (queue.length > 0 && steps < 30000) {
        const [cx,cy] = queue.shift(); steps++;
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = wrapX(cx+dx), ny = cy+dy;
          if (ny < 0 || ny >= MAP_H) continue;
          const key = `${nx},${ny}`;
          if (visited.has(key)) continue;
          const t = G.map[ny][nx];
          if (!tier.tiles.has(t)) continue;
          visited.add(key);
          const destCity = CITIES.find(c => c.mx === nx && c.my === ny && c.id !== startCity.id);
          if (destCity) {
            const pairKey = [startCity.id, destCity.id].sort().join('-');
            if (!G.roadGraph[pairKey]) G.roadGraph[pairKey] = {};
            G.roadGraph[pairKey][tier.name] = true;
          }
          queue.push([nx, ny]);
        }
      }
    }
  }
  G.roadGraphDirty = false;
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
    res:{stone:0,wood:0,food:20,iron:0,gold:0,cloth:0,ale:0,herbs:0,tools:0,relics:0,beds:0,tables:0},
  };
  for (const [k,v] of Object.entries(pooled)) {
    if (newCity.res[k] !== undefined) newCity.res[k] += v;
  }
  CITIES.push(newCity);
  const cx = d.x, cy = d.y;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = wrapX(cx+dx), y = wrapY(cy+dy);
      if (dx === 0 && dy === 0) mapSet(x, y, T.CITY);
      else if (dy === -1) { mapSet(x, y, T.BED); newCity.res.beds++; }
      else if (dy === 1) mapSet(x, y, T.STOCKPILE);
      else mapSet(x, y, T.FLOOR);
    }
  d.cityId = newId; partner.cityId = newId;
  d.state = 'idle'; d.target = null; d.path = [];
  partner.state = 'idle'; partner.target = null; partner.path = [];
  log(`🏕️ ${d.name} and ${partner.name} founded ${newCity.name}!`, 'system', 5, null, d.x, d.y);
  addEvent(d, 'found', `Founded ${newCity.name}`);
  addEvent(partner, 'found', `Founded ${newCity.name}`);
  return true;
}

function tryFoundSuburb(d) {
  const parentCity = cityOf(d);
  if (!parentCity || !parentCity.res || parentCity.mx === undefined) return false;
  const cityPop = G.dwarves.filter(o => o.cityId === parentCity.id).length;
  if (cityPop < 6) return false;
  const hasChild = G.dwarves.some(o => o !== d && o.cityId === d.cityId && (o.age ?? 20) < 10);
  if (!hasChild) return false;
  if (CITIES.length + G.suburbs.length >= 60) return false;
  const ROAD_TILES = new Set([T.PATH, T.ROAD, T.ASPHALT, T.RAILROAD]);
  let onRoad = false;
  for (let dy = -1; dy <= 1 && !onRoad; dy++)
    for (let dx = -1; dx <= 1 && !onRoad; dx++) {
      const rx = wrapX(d.x + dx), ry = d.y + dy;
      if (ry >= 0 && ry < MAP_H && ROAD_TILES.has(G.map[ry][rx])) onRoad = true;
    }
  if (!onRoad) return false;
  const distParent = Math.min(Math.abs(parentCity.mx - d.x), MAP_W - Math.abs(parentCity.mx - d.x)) + Math.abs(parentCity.my - d.y);
  if (distParent < 8 || distParent > 20) return false;
  for (const c of CITIES) {
    if (c.mx === undefined) continue;
    const dx = Math.min(Math.abs(c.mx - d.x), MAP_W - Math.abs(c.mx - d.x));
    const dy = Math.abs(c.my - d.y);
    if (dx + dy < 8) return false;
  }
  for (const s of G.suburbs) {
    const dx = Math.min(Math.abs(s.mx - d.x), MAP_W - Math.abs(s.mx - d.x));
    const dy = Math.abs(s.my - d.y);
    if (dx + dy < 8) return false;
  }
  let land = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = wrapX(d.x + dx), y = d.y + dy;
      if (y >= 0 && y < MAP_H && G.map[y][x] !== T.OCEAN && G.map[y][x] !== T.FISH_SPOT) land++;
    }
  if (land < 5) return false;
  if (parentCity.res.food < 10 || parentCity.res.stone < 3 || parentCity.res.wood < 2) return false;
  parentCity.res.food -= 8; parentCity.res.stone -= 3; parentCity.res.wood -= 2;
  const sub = createSuburb(d.x, d.y, parentCity.id, d.name);
  sub.res.food = 8; sub.res.stone = 3; sub.res.wood = 2; sub.res.beds = 1;
  G.suburbs.push(sub);
  mapSet(d.x, d.y, T.BED);
  for (const [dx2, dy2] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const ax = wrapX(d.x + dx2), ay = d.y + dy2;
    if (ay >= 0 && ay < MAP_H && WALKABLE.has(G.map[ay][ax]) && G.map[ay][ax] !== T.BED && G.map[ay][ax] !== T.CITY) {
      mapSet(ax, ay, T.FLOOR); break;
    }
  }
  const oldCityId = d.cityId;
  d.cityId = sub.id; d.state = 'idle'; d.target = null; d.path = [];
  const child = G.dwarves.find(o => o.cityId === oldCityId && (o.age ?? 20) < 10);
  if (child) child.cityId = sub.id;
  log(`🏠 ${d.name} built a homestead near ${parentCity.name}!`, 'system', 4, null, d.x, d.y);
  return true;
}

function tryRelocateToSuburb(d) {
  const parentCity = cityOf(d);
  if (!parentCity || !parentCity.res) return false;
  const cityPop = G.dwarves.filter(o => o.cityId === d.cityId).length;
  if (cityPop < 7) return false;
  const child = G.dwarves.find(o => o !== d && o.cityId === d.cityId && (o.age ?? 20) < 10);
  if (!child) return false;
  for (const sub of G.suburbs) {
    if (sub.culture !== (parentCity.culture || 'american')) continue;
    const dx = Math.min(Math.abs(sub.mx - d.x), MAP_W - Math.abs(sub.mx - d.x));
    const dy = Math.abs(sub.my - d.y);
    if (dx + dy > 25) continue;
    const subPop = G.dwarves.filter(o => o.cityId === sub.id).length;
    if (subPop >= 3) continue;
    d.target = {type:'relocate_suburb', x:sub.mx, y:sub.my, suburbId:sub.id};
    const p = findPath(d.x, d.y, sub.mx, sub.my);
    if (!p || p.length === 0) continue;
    d.path = p; d.state = 'walk';
    const oldCityId = d.cityId;
    d.cityId = sub.id;
    child.cityId = sub.id;
    log(`🏠 ${d.name} relocated to ${sub.name}`, 'system', 2, null, sub.mx, sub.my);
    return true;
  }
  return false;
}

function tryMoveIntoEmptyTown(d) {
  const source = cityOf(d);
  const popByCity = new Map();
  for (const dw of G.dwarves) popByCity.set(dw.cityId, (popByCity.get(dw.cityId) || 0) + 1);
  if (!source || (popByCity.get(source.id) || 0) <= 1) return false;
  const towns = [...CITIES, ...G.suburbs]
    .filter(t => t.id !== d.cityId && t.res && t.mx !== undefined && (popByCity.get(t.id) || 0) === 0)
    .sort((a, b) => {
      const da = Math.min(Math.abs(a.mx - d.x), MAP_W - Math.abs(a.mx - d.x)) + Math.abs(a.my - d.y);
      const db = Math.min(Math.abs(b.mx - d.x), MAP_W - Math.abs(b.mx - d.x)) + Math.abs(b.my - d.y);
      return da - db;
    });
  for (const town of towns) {
    if (G.dwarves.some(o => o !== d && o.target?.type === 'move_town' && o.target.cityId === town.id)) continue;
    const dist = Math.min(Math.abs(town.mx - d.x), MAP_W - Math.abs(town.mx - d.x)) + Math.abs(town.my - d.y);
    if (dist > EMPTY_TOWN_MOVE_RADIUS) continue;
    if (dist === 0) {
      d.cityId = town.id; d.target = null; d.path = []; d.state = 'idle';
      d.happiness = Math.min(100, d.happiness + 8);
      log(`🏘️ ${d.name} moved into empty ${town.name}`, 'system', 3, town.emoji, town.mx, town.my);
      addEvent(d, 'home', `Moved into ${town.name}`);
      return true;
    }
    if (Math.random() > 0.04) return false;
    const p = bfs(d.x, d.y, (x,y) => x === town.mx && y === town.my, false);
    if (!p || p.length === 0 || p.length > EMPTY_TOWN_MOVE_RADIUS + 20) continue;
    d.target = {type:'move_town', cityId:town.id, x:town.mx, y:town.my};
    d.path = p; d.state = 'walk';
    log(`🏘️ ${d.name} set out to settle empty ${town.name}`, 'system', 2, town.emoji, town.mx, town.my);
    return true;
  }
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
  log(`${d.name} \uD83D\uDE2B is starving!`, 'system', 3, null, d.x, d.y);
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
        log(`${d.name} ${emoji} ate ${src === 'mushroom' ? 'a mushroom' : src === 'berry' ? 'berries' : 'crabs'}`, 'eat', 1, null, d.x, d.y);
        addEvent(d, 'eat', `Ate ${src}`);
      }
    } else if (res.food > 0) {
      res.food--;
      d.hunger = Math.min(100, d.hunger + Math.round(35 * statMod(effectiveStat(d, 'WIS'))));
      log(`${d.name} 🍖 ate from stockpile`, 'eat', 1, null, d.x, d.y);
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
    log(`${d.name} 😴 woke up`, 'sleep', 1, null, d.x, d.y);
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

// ---- Animals ----
function nearbyAnimals(x, y) {
  const bx = x >> 3, by = y >> 3, result = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const bucket = G.animalGrid?.[`${bx+dx},${by+dy}`];
    if (bucket) for (const a of bucket) result.push(a);
  }
  return result;
}

function animalCombat(a, d) {
  const t = ANIMAL_TYPES[a.type];
  // Animal attacks dwarf
  if (t.danger && t.atk > 0) {
    const atkRoll = rollD(20) + t.atk;
    if (atkRoll >= d.ac) {
      let dmg = rollDmg(t.dmg);
      if (dmg < 1) dmg = 1;
      d.hp -= dmg;
      if (String(t.dmg).includes('+poison')) d.poisonTicks = (d.poisonTicks||0) + 3;
      log(`${t.emoji} ${a.type} hit ${d.name} for ${dmg} dmg!`, 'combat', 2, null, d.x, d.y);
      if (d.hp <= 0) {
        d.dead = true; d.state = 'dead'; placeGrave(d, `Killed by a ${a.type}`);
        log(`${d.name} \u2620\uFE0F was killed by a ${a.type}!`, 'system', 4, null, d.x, d.y);
        addEvent(d, 'death', `Killed by a ${a.type}`);
        return;
      }
    }
  }
  // Dwarf attacks animal
  if (d.hp > 0) {
    const strMod = Math.floor(((d.stats?.STR||10) - 10) / 2);
    const atkRoll = rollD(20) + strMod;
    if (atkRoll >= a.ac) {
      let dmg = rollD(8) + strMod;
      if (dmg < 1) dmg = 1;
      a.hp -= dmg;
      log(`${d.name} hit ${t.emoji} ${a.type} for ${dmg} dmg!`, 'combat', 2, null, d.x, d.y);
      if (a.hp <= 0) {
        a.dead = true;
        const foodGain = t.food;
        if (foodGain > 0) {
          const city = cityOf(d);
          if (city?.res) city.res.food += foodGain;
          d.hunger = Math.min(100, d.hunger + foodGain * 5);
        }
        log(`${d.name} killed a ${t.emoji} ${a.type}!`, 'combat', 3, null, d.x, d.y);
        addEvent(d, 'combat', `Killed a ${a.type}`);
        d.happiness = Math.min(100, d.happiness + 2);
      }
    }
  }
}

function tickAnimal(a) {
  if (a.dead) return;
  const t = ANIMAL_TYPES[a.type];
  a.moveTimer = (a.moveTimer||0) + t.speed;
  if (a.moveTimer < 1) return;
  a.moveTimer -= 1;

  // Pet following logic
  if (a.owner) {
    const owner = G.dwarves.find(d => d.id === a.owner);
    if (!owner || owner.dead) { a.owner = null; a.state = 'idle'; return; }
    const dx = owner.x - a.x, dy = owner.y - a.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist > 2) {
      // Move toward owner
      const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      const nx = wrapX(a.x + sx), ny = a.y + sy;
      if (isWalkable(nx, ny)) { a.x = nx; a.y = ny; }
    }
    return;
  }

  // Check for nearby dwarves
  const nearby = nearbyDwarves(a.x, a.y);
  for (const d of nearby) {
    const ddx = Math.abs(d.x - a.x), ddy = Math.abs(d.y - a.y);
    if (ddx > 3 || ddy > 3) continue;

    // Dangerous: aggro within 2 tiles
    if (t.danger && ddx <= 2 && ddy <= 2) {
      if (d.x === a.x && d.y === a.y) {
        animalCombat(a, d);
        return;
      }
      // Move toward dwarf
      const sx = d.x > a.x ? 1 : d.x < a.x ? -1 : 0;
      const sy = d.y > a.y ? 1 : d.y < a.y ? -1 : 0;
      const nx = wrapX(a.x + sx), ny = a.y + sy;
      if (isWalkable(nx, ny)) { a.x = nx; a.y = ny; }
      return;
    }

    // Non-dangerous: flee within 3 tiles
    if (!t.danger && ddx <= 3 && ddy <= 3) {
      const sx = a.x > d.x ? 1 : a.x < d.x ? -1 : 0;
      const sy = a.y > d.y ? 1 : a.y < d.y ? -1 : 0;
      const nx = wrapX(a.x + (sx || (Math.random()<0.5?1:-1))), ny = a.y + (sy || (Math.random()<0.5?1:-1));
      if (ny >= 0 && ny < MAP_H && isWalkable(nx, ny)) { a.x = nx; a.y = ny; }
      return;
    }
  }

  // Wander: stationary animals (scorpion, snake) rarely move
  const stationary = a.type === 'scorpion' || a.type === 'snake' || a.type === 'spider' || a.type === 'turtle';
  if (stationary && Math.random() > 0.05) return;
  if (Math.random() < 0.3) {
    const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
    const [ddx,ddy] = dirs[Math.floor(Math.random()*4)];
    const nx = wrapX(a.x+ddx), ny = a.y+ddy;
    const canMove = ny >= 0 && ny < MAP_H && (t.water ? G.map[ny][nx] === T.OCEAN : isWalkable(nx, ny));
    if (canMove) { a.x = nx; a.y = ny; }
  }
}

function tickAnimals() {
  // Build animal grid
  G.animalGrid = {};
  for (const a of G.animals) {
    const key = `${a.x>>3},${a.y>>3}`;
    (G.animalGrid[key] ??= []).push(a);
  }
  // Stagger: 1/4 per tick
  for (let i = 0; i < G.animals.length; i++) {
    if (i % 4 !== G.tick % 4) continue;
    tickAnimal(G.animals[i]);
  }
  G.animals = G.animals.filter(a => !a.dead);

  // Periodically spawn new animals
  if (G.tick % 200 === 0) spawnAnimals();

  // Dwarf-animal combat check: dwarves on same tile as dangerous animals
  for (const d of G.dwarves) {
    if (d.dead || d.state === 'traveling') continue;
    const nearby = nearbyAnimals(d.x, d.y);
    for (const a of nearby) {
      if (a.dead || a.owner) continue;
      const t = ANIMAL_TYPES[a.type];
      if (!t.danger) continue;
      if (a.x === d.x && a.y === d.y) {
        animalCombat(a, d);
        if (d.dead) break;
      }
    }
    // Flee if low HP
    if (d.hp > 0 && d.hp < d.maxHp * 0.3 && d.state !== 'fleeing') {
      const hasNearbyDanger = nearby.some(a => !a.dead && ANIMAL_TYPES[a.type].danger && Math.abs(a.x-d.x)<=2 && Math.abs(a.y-d.y)<=2);
      if (hasNearbyDanger) {
        d.state = 'wander'; d.timer = 20; d.target = null; d.path = [];
      }
    }
  }

  // Pet adoption check
  if (G.tick % 10 === 0) {
    for (const a of G.animals) {
      if (a.dead || a.owner) continue;
      const t = ANIMAL_TYPES[a.type];
      if (!t.pet) continue;
      for (const d of nearbyDwarves(a.x, a.y)) {
        if (d.dead || d.pet) continue;
        const ddx = Math.abs(d.x - a.x), ddy = Math.abs(d.y - a.y);
        if (ddx > 2 || ddy > 2) continue;
        a.followTicks = (a.followTicks||0) + 1;
        if (a.followTicks >= 3 && Math.random() < 0.2) {
          a.owner = d.id;
          d.pet = a.id;
          d.happiness = Math.min(100, d.happiness + 5);
          log(`${d.name} adopted a ${t.emoji} ${a.type}!`, 'system', 3, null, d.x, d.y);
          addEvent(d, 'social', `Adopted a ${a.type}`);
          break;
        }
      }
    }
  }

  // Pet happiness bonus every 100 ticks
  if (G.tick % 100 === 0) {
    for (const d of G.dwarves) {
      if (!d.pet) continue;
      const pet = G.animals.find(a => a.id === d.pet);
      if (pet && !pet.dead) d.happiness = Math.min(100, d.happiness + 2);
      else d.pet = null;
    }
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
        d.age = (d.age ?? 20) + 1;
        if (d.age >= 70 && Math.random() < 0.03 * (d.age - 69)) {
          placeGrave(d, `Died of old age at ${d.age}`);
          log(`${d.name} \u2620\uFE0F passed away at age ${d.age}`, 'system', 4, null, d.x, d.y);
          addEvent(d, 'death', `Died of old age at ${d.age}`);
          deadIds.push(d.id);
        }
      }
      if (deadIds.length) G.dwarves = G.dwarves.filter(dw => !deadIds.includes(dw.id));
      // Age dirt tiles back to plains
      G.dirtTiles = G.dirtTiles.filter(dt => {
        if (G.year - dt.year >= 1) {
          if (G.map[dt.y] && G.map[dt.y][dt.x] === T.DIRT) mapSet(dt.x, dt.y, T.PLAINS);
          return false;
        }
        return true;
      });
      // Generate per-city year resolutions
      const resolutions = [];
      for (const city of CITIES) {
        if (!city.res || city.mx === undefined) continue;
        const pop = G.dwarves.filter(d => d.cityId === city.id);
        if (pop.length === 0) continue;
        const avgAmb = pop.reduce((s,d) => s + (d.ambition||50), 0) / pop.length;
        const avgFaith = pop.reduce((s,d) => s + (d.faith||50), 0) / pop.length;
        const avgMoral = pop.reduce((s,d) => s + (d.morality||50), 0) / pop.length;
        const r = city.res;
        let resolution;
        if (r.food < pop.length * 3) resolution = 'Focus on farming and food stores';
        else if (avgAmb > 65) resolution = 'Expand territory and build aggressively';
        else if (avgFaith > 65) resolution = 'Strengthen spiritual traditions';
        else if (avgMoral > 65) resolution = 'Foster community bonds and sharing';
        else if (r.iron > 20 || r.gold > 10) resolution = 'Invest in crafting and trade';
        else if (pop.length >= 8) resolution = 'Send expeditions to new lands';
        else resolution = 'Grow the population steadily';
        resolutions.push({cityId:city.id, name:city.name, emoji:city.emoji, resolution});
      }
      if (resolutions.length) { G.yearResolutions.push({year:G.year, resolutions}); pendingToasts.push({type:'year_resolutions', year:G.year, resolutions}); }
    }
    const name = SEASONS[G.season];
    log(`🌍 ${name} of Year ${G.year}`, 'system', 3);

    // Reproduction: one birth per city/suburb per season
    for (const city of [...CITIES, ...G.suburbs]) {
      if (!city.res || city.mx === undefined) continue;
      const cityDwarves = G.dwarves.filter(d => d.cityId === city.id);
      const cityPop = cityDwarves.length;
      const popCap = settlementPopCap(city);
      if (cityPop >= popCap || G.dwarves.length >= WORLD_POP_HARD_CAP) continue;
      if (city.res.food < cityPop * 3) continue;
      const males = cityDwarves.filter(d => d.sex === 'M' && d.happiness >= 70 && d.age >= 20 && d.age < 55);
      const females = cityDwarves.filter(d => d.sex === 'F' && d.happiness >= 70 && d.age >= 20 && d.age < 55);
      if (males.length > 0 && females.length > 0 && Math.random() < 0.4) {
        const baby = createDwarf(city.mx, city.my, city.id);
        baby.age = 0;
        baby.sex = Math.random() < 0.5 ? 'M' : 'F';
        const land = findNearbyLand(city.mx, city.my);
        if (land) { baby.x = land[0]; baby.y = land[1]; }
        G.dwarves.push(baby);
        log(`👶 ${baby.name} was born in ${city.name}!`, 'system', 3, null, baby.x, baby.y);
      }
    }

    if (G.season === 0 || G.season === 1) {
      for (const city of [...CITIES, ...G.suburbs]) {
        if (!city.res || city.mx === undefined) continue;
        let farmCount=0, fishCount=0, berryCount=0, herbCount=0, bedCount=0, tableCount=0, factoryCount=0;
        const r = 15;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const fx = wrapX(city.mx+dx), fy = wrapY(city.my+dy);
            const t = G.map[fy][fx];
            if (t === T.FARM) farmCount++;
            else if (t === T.FISH_SPOT || t === T.CRAB) fishCount++;
            else if (t === T.BERRY_BUSH) berryCount++;
            else if (t === T.HERB_PATCH) herbCount++;
            else if (t === T.BED) bedCount++;
            else if (t === T.TABLE) tableCount++;
            else if (t === T.FACTORY) factoryCount++;
          }
        city.res.beds = bedCount;
        city.res.tables = tableCount;
        const cityPop = G.dwarves.filter(d => d.cityId === city.id).length;
        const harvest = 10 + farmCount*3 + fishCount*2 + berryCount + cityPop*2;
        city.res.food += harvest;
        if (herbCount > 0) city.res.herbs += Math.ceil(herbCount/2);
        if (farmCount >= 3) city.res.cloth += Math.floor(farmCount/3);
        const made = runCityIndustry(city, { tableCount, factoryCount }, cityPop);
        if (made) log(`${city.name} industry produced ${formatIndustry(made)}`, 'city', 4, city.emoji, city.mx, city.my);
      }
      log(`🌾 Harvest season! Cities gather from farms, fisheries, and foraging.`, 'farm', 3);

      for (const city of [...CITIES, ...G.suburbs]) {
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
          if (expanded > 0) log(`🏘️ ${city.name} expanded! (+${expanded} structures)`, 'city', 4, null, city.mx, city.my);
        }
      }

      // Check suburb promotions
      checkSuburbPromotion();

      // Auto-place factories at eligible cities
      for (const city of CITIES) {
        if (!city.res || city.mx === undefined) continue;
        const r = city.res;
        if (r.stone < 10 || r.iron < 8 || r.wood < 5) continue;
        // Check if city already has a factory nearby
        let hasFactory = false;
        for (let dy = -6; dy <= 6 && !hasFactory; dy++)
          for (let dx = -6; dx <= 6 && !hasFactory; dx++) {
            const fx = wrapX(city.mx+dx), fy = city.my+dy;
            if (fy >= 0 && fy < MAP_H && G.map[fy][fx] === T.FACTORY) hasFactory = true;
          }
        if (hasFactory) continue;
        // Find an expansion tile
        const expandable = new Set([T.PLAINS,T.FOREST,T.TAIGA,T.DESERT,T.TUNDRA,T.BEACH,T.HILL,T.FLOOR]);
        let placed = false;
        for (let radius = 2; radius <= 5 && !placed; radius++)
          for (let dy = -radius; dy <= radius && !placed; dy++)
            for (let dx = -radius; dx <= radius && !placed; dx++) {
              if (Math.abs(dx) < radius && Math.abs(dy) < radius) continue;
              const x = wrapX(city.mx+dx), y = city.my+dy;
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
              r.stone -= 10; r.iron -= 8; r.wood -= 5;
              mapSet(x, y, T.FACTORY);
              log(`${city.name} \uD83C\uDFED built a factory!`, 'city', 5, null, city.mx, city.my);
              placed = true;
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

    // Repopulate cities: cities with food and beds but low pop get new dwarves
    if (G.dwarves.length < WORLD_POP_HARD_CAP) {
      for (const city of CITIES) {
        if (!city.res || city.mx === undefined) continue;
        const pop = G.dwarves.filter(d => d.cityId === city.id).length;
        if (pop > 0 && pop < 2 && city.res.food >= 5) {
          spawnDwarfAtCity(city);
        } else if (pop > 0 && pop < (city.res.beds || 1) && city.res.food >= pop * 3 && Math.random() < 0.4) {
          spawnDwarfAtCity(city);
        }
      }
    }
    rebalanceEmptyCities();

    // Auto-build roads between nearby cities
    autoConnectCities();

    // Rebuild road graph
    if (!G.roadGraph || G.roadGraphDirty) rebuildRoadGraph();

    // Spawn animals
    spawnAnimals();
  }
}

function spawnAnimals() {
  if (G.animals.length >= MAX_ANIMALS) return;
  const types = Object.keys(ANIMAL_TYPES);
  const toSpawn = Math.min(MAX_ANIMALS - G.animals.length, 10 + Math.floor(Math.random() * 15));
  for (let i = 0; i < toSpawn; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    const t = ANIMAL_TYPES[type];
    for (let tries = 0; tries < 30; tries++) {
      const rx = Math.floor(Math.random() * MAP_W);
      const ry = 10 + Math.floor(Math.random() * (MAP_H - 20));
      const tile = G.map[ry][rx];
      if (!t.terrain.includes(tile)) continue;
      if (!t.water && !isWalkable(rx, ry)) continue;
      let nearCity = false;
      for (const c of CITIES) {
        if (c.mx === undefined) continue;
        const cdx = Math.min(Math.abs(c.mx - rx), MAP_W - Math.abs(c.mx - rx));
        if (cdx <= 5 && Math.abs(c.my - ry) <= 5) { nearCity = true; break; }
      }
      if (nearCity) continue;
      G.animals.push(createAnimal(type, rx, ry));
      break;
    }
  }
}

function seedAnimals() {
  const count = 150 + Math.floor(Math.random() * 60);
  for (let i = 0; i < count; i++) spawnAnimals();
}

// AI Client
const AI = {
  intentCache: new Map(),
  lastCallTime: {simple:0,medium:0,complex:0,premium:0},
  intervals: {simple:10000,medium:30000,complex:120000,premium:600000},
  enabled: true,
  stats: {calls:0,fallbacks:0,errors:0},
};

function sponsorClaimsFor(dwarves) {
  return (dwarves || []).map(d => ({dwarfId:d.id, claimToken:d.sponsorClaimToken || ''}))
    .filter(claim => claim.claimToken);
}

function aiClientContext(cityDwarves, city) {
  const res = city?.res || defaultRes();
  const dwarves = cityDwarves || G.dwarves;
  return {
    dwarves: dwarves.map(d => ({
      id:d.id,name:d.name,hunger:d.hunger,energy:d.energy,happiness:d.happiness,
      state:d.state,x:d.x,y:d.y,stats:d.stats,faith:d.faith,traits:d.traits,
      eventLog:d.eventLog?.slice(-10),cityId:d.cityId,
    })),
    sponsorshipClaims:sponsorClaimsFor(dwarves),
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
      log(`${d.name} 🤖 AI: ${intent.reason}`, 'system', 2); return true;
    case 'sleep': case 'rest':
      d.state = 'seek_sleep'; d.target = null; d.path = [];
      log(`${d.name} 🤖 AI: ${intent.reason}`, 'system', 2); return true;
    case 'mine': return aiSeekTask(d, T.D_MINE, T.MOUNTAIN, 'mine', intent.reason);
    case 'build': return false; // removed: wall building was not useful
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
      log(`${d.name} 🤖 AI: ${intent.reason}`, 'system', 2); return true;
    case 'travel':
      if (tryTravel(d)) { log(`${d.name} 🤖 AI: ${intent.reason}`, 'system', 2); return true; }
      return false;
    case 'pray':
      d.state = 'wander'; d.timer = 10;
      d.happiness = Math.min(100, d.happiness + 3);
      log(`${d.name} 🙏 prays: ${intent.reason}`, 'system', 2); return true;
    default: return false;
  }
}

function aiSeekTask(d, designationType, naturalType, taskType, reason) {
  const path = bfs(d.x,d.y,(x,y)=>G.map[y][x]===designationType||(naturalType&&G.map[y][x]===naturalType),false);
  if (path) {
    const last = path[path.length-1]; const adj = adjWalkable(last[0],last[1]);
    if (adj) {
      const p = bfs(d.x,d.y,(x,y)=>x===adj[0]&&y===adj[1],false);
      if (p) { d.target={type:taskType,x:last[0],y:last[1]}; d.path=p; d.state='walk'; log(`${d.name} 🤖 AI: ${reason}`,'system', 2); return true; }
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
      log(`${d.name} 🤖 AI: ${reason}`,'system', 2); return true;
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
      hp:d.hp,maxHp:d.maxHp,ac:d.ac,poisonTicks:d.poisonTicks||0,pet:d.pet||null,
      sex:d.sex||'M',
      travelMode:d.travelMode||null,
      sponsored:d.sponsored||false,sponsorTier:d.sponsorTier||null,sponsorCallsRemaining:d.sponsorCallsRemaining||0,
      starveTicks:d.starveTicks||0,
      relationships:d.relationships||[],
    })),
    animals:G.animals.map(a => ({
      id:a.id,type:a.type,x:a.x,y:a.y,hp:a.hp,maxHp:a.maxHp,ac:a.ac,
      state:a.state,timer:a.timer,moveTimer:a.moveTimer,owner:a.owner,followTicks:a.followTicks||0,
    })),
    stats:G.stats,
    homeCity:G.homeCity?{name:G.homeCity.name,mx:G.homeCity.mx,my:G.homeCity.my}:null,
    mapDeltas:G.mapDeltas,
    graves:G.graves,
    yearResolutions:G.yearResolutions,
    suburbs:G.suburbs,
    dirtTiles:G.dirtTiles,
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
      G.tick = data.state?.tick || 0;
      G.year = data.state?.year || 1;
      G.season = data.state?.season || 0;
      G.speed = data.state?.speed || 1;
      G.paused = data.state?.paused || false;
      G.stats = data.state?.stats || G.stats;
      G.homeCity = CITIES.find(c => c.id === data.state?.homeCityId) || CITIES[0];
      G.aiCityIndex = data.state?.aiCityIndex || 0;
      G.mapDeltas = data.state?.mapDeltas || {};
      G.graves = data.state?.graves || {};
      G.yearResolutions = data.state?.yearResolutions || [];
      G.suburbs = data.state?.suburbs || [];
      G.dirtTiles = data.state?.dirtTiles || [];
      G.routeDwarfId = data.state?.routeDwarfId || null;
      // Restore dwarf paths/targets to empty (they were stripped for transfer)
      for (const d of G.dwarves) {
        if (!d.path) d.path = [];
        if (!d.target) d.target = null;
        if (!d.eventLog) d.eventLog = [];
        if (!d.carryItems) d.carryItems = {};
        if (!d.inventory) d.inventory = [];
        d.state = d.state || 'idle';
      }
      G.animals = (data.animals || []).map(a => ({...a, path:a.path||[], target:a.target||null}));
      if (G.animals.length === 0) seedAnimals();
      rebalanceEmptyCities();
      G.popRebalancePending = hasEmptyCities();
      startTickLoop();
      break;
    }
    case 'control':
      if (data.speed !== undefined) G.speed = data.speed;
      if (data.paused !== undefined) G.paused = data.paused;
      break;
    case 'route_focus':
      G.routeDwarfId = data.dwarfId || null;
      break;
    case 'population_rebalance':
      for (const patch of data.dwarves || []) {
        const d = G.dwarves.find(o => o.id === patch.id);
        if (!d) continue;
        d.cityId = patch.cityId; d.x = patch.x; d.y = patch.y;
        d.state = patch.state || 'idle'; d.target = null; d.path = []; d.travelMode = null;
        d.hunger = patch.hunger; d.energy = patch.energy; d.happiness = patch.happiness;
      }
      G.popRebalancePending = hasEmptyCities();
      break;
    case 'designate':
      if (data.cityResources) {
        for (const [cityId, res] of Object.entries(data.cityResources)) {
          const city = cityById(cityId);
          if (city && city.res) Object.assign(city.res, res);
        }
      }
      for (const ch of data.changes) {
        if (ch.tile === T.D_UPGRADE) G.upgradeFrom[`${ch.x},${ch.y}`] = G.map[ch.y][ch.x];
        G.map[ch.y][ch.x] = ch.tile; G.mapDeltas[`${ch.x},${ch.y}`] = ch.tile;
      }
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
            hp:sd.hp??d.hp, maxHp:sd.maxHp??d.maxHp, ac:sd.ac??d.ac,
            poisonTicks:sd.poisonTicks||0, pet:sd.pet||null,
            sex:sd.sex||d.sex,
            travelMode:sd.travelMode??null,
            starveTicks:sd.starveTicks||0,
            relationships:sd.relationships||[],
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
      if (saved.animals?.length) {
        G.animals = saved.animals.map(a => ({...createAnimal(a.type, a.x, a.y), ...a, path:[], target:null}));
      }
      if (G.animals.length === 0) seedAnimals();
      // Restore map deltas
      if (saved.mapDeltas) {
        G.mapDeltas = saved.mapDeltas;
        for (const [key, tile] of Object.entries(saved.mapDeltas)) {
          const [x, y] = key.split(',').map(Number);
          if (y >= 0 && y < MAP_H && x >= 0 && x < MAP_W) {
            G.map[y][x] = tile;
            pendingMapChanges.push({x, y, tile});
          }
        }
      }
      G.suburbs = saved.suburbs || [];
      G.dirtTiles = saved.dirtTiles || [];
      if (G.dwarves.length === 0 && G.homeCity) spawnDwarfAtCity(G.homeCity);
      rebalanceEmptyCities();
      G.popRebalancePending = hasEmptyCities();
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
      tickAnimals();
      tickSeason();
    }
    aiTickAll();
    if (G.popRebalancePending || G.tick % 300 === 0) {
      rebalanceEmptyCities();
      G.popRebalancePending = hasEmptyCities();
    }

    const includeDetails = G.tick % 30 === 0;

    // Post snapshot to main thread
    self.postMessage({
      type:'snapshot',
      tick:G.tick, year:G.year, season:G.season,
      stats:{...G.stats},
      dwarves:G.dwarves.map(d => ({
        id:d.id,name:d.name,x:d.x,y:d.y,cityId:d.cityId,color:d.color,
        hunger:d.hunger,energy:d.energy,happiness:d.happiness,
        state:d.state, target:d.target ? (d.id === G.routeDwarfId ? d.target : {type:d.target.type}) : null,
        travelMode:d.travelMode||null,
        ...(d.id === G.routeDwarfId ? {path:d.path||[]} : {}),
        stats:d.stats,faith:d.faith,morality:d.morality,ambition:d.ambition,age:d.age,
        carrying:d.carrying||0,carryItems:d.carryItems||{},
        carryMax:carryCapacity(d),
        sponsored:d.sponsored,sponsorTier:d.sponsorTier,sponsorCallsRemaining:d.sponsorCallsRemaining,
        starveTicks:d.starveTicks||0,
        hp:d.hp,maxHp:d.maxHp,ac:d.ac,poisonTicks:d.poisonTicks||0,pet:d.pet||null,sex:d.sex||'M',
        ...(includeDetails ? {
          traits:d.traits,backstory:d.backstory,eventLog:d.eventLog?.slice(-50),
          inventory:d.inventory||[],relationships:d.relationships,
        } : {}),
      })),
      animals:G.animals.map(a => ({
        id:a.id,type:a.type,x:a.x,y:a.y,hp:a.hp,maxHp:a.maxHp,
        state:a.state,owner:a.owner,
      })),
      cities:CITIES.filter(c => c.res).map(c => ({id:c.id,res:{...c.res},mx:c.mx,my:c.my,name:c.name,emoji:c.emoji})),
      suburbs:G.suburbs.map(s => ({id:s.id,name:s.name,emoji:s.emoji,mx:s.mx,my:s.my,parentCityId:s.parentCityId,culture:s.culture,res:{...s.res}})),
      roadGraph:G.roadGraph||{},
      logs:pendingLogs.splice(0),
      toasts:pendingToasts.splice(0),
      mapChanges:pendingMapChanges.splice(0),
      newGraves:pendingGraves.splice(0),
    });

    const interval = Math.max(33, Math.floor(100 / G.speed));
    tickTimer = setTimeout(doTick, interval);
  }
  doTick();
}
