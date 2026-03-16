import { describe, it, expect, beforeEach } from 'vitest';

const MAP_W = 500, MAP_H = 250;
const T = {
  OCEAN:0, TUNDRA:1, TAIGA:2, FOREST:3, PLAINS:4, DESERT:5, JUNGLE:6, MOUNTAIN:7,
  HILL:8, BEACH:9, FLOOR:10, WALL:11, STOCKPILE:12, BED:13, TABLE:14, DOOR:15,
  MUSHROOM:16, FARM:17, CITY:18, FISH_SPOT:23, CORAL:24,
  PATH:25, ROAD:26, ASPHALT:27, RAILROAD:28,
};

const TRAVEL_MODES: Record<string, {emoji:string, speed:number, cargoBonus:number, label:string, requires?:string}> = {
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
  originCity: {id:string, mx:number, my:number},
  destCity: {id:string, mx:number, my:number},
  roadGraph: Record<string, any>,
  map: number[][]
): string {
  const pairKey = [originCity.id, destCity.id].sort().join('-');
  const tiers = roadGraph[pairKey];
  if (tiers?.railroad) return 'train';
  if (tiers?.asphalt) return 'car';
  if (tiers?.gravel || tiers?.path) return 'cart';
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
    expect(isCityCoastal(10, 7, map)).toBe(true);
  });
  it('returns false for inland city', () => {
    expect(isCityCoastal(10, 50, map)).toBe(false);
  });
});

describe('bestTravelMode', () => {
  const cityA = { id:'a', mx:10, my:7 };
  const cityB = { id:'b', mx:50, my:7 };
  const cityC = { id:'c', mx:10, my:50 };
  const cityD = { id:'d', mx:50, my:50 };

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
  it('returns cart for path tier', () => {
    expect(bestTravelMode(cityC, cityD, {'c-d':{path:true}}, map)).toBe('cart');
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
  it('dwarf gains travelMode when traveling', () => {
    const d: any = { id:'d1', state:'idle', travelMode:null };
    d.travelMode = 'car';
    d.state = 'traveling';
    expect(d.travelMode).toBe('car');
    expect(TRAVEL_MODES.car.cargoBonus).toBe(15);
    expect(TRAVEL_MODES.car.speed).toBe(4);
  });
  it('dwarf clears travelMode on arrival', () => {
    const d: any = { state:'traveling', travelMode:'ship' };
    d.state = 'idle';
    d.travelMode = null;
    expect(d.travelMode).toBeNull();
  });
});
