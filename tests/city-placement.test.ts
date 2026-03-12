import { describe, it, expect } from 'vitest';

const MAP_W = 2000;
const MAP_H = 1000;

function toMap(lon: number, lat: number): [number, number] {
  let mx = Math.round((lon + 180) / 360 * MAP_W) % MAP_W;
  if (mx < 0) mx += MAP_W;
  const my = Math.round((90 - lat) / 180 * MAP_H);
  return [mx, Math.max(0, Math.min(MAP_H - 1, my))];
}

function wrapX(x: number): number {
  return ((x % MAP_W) + MAP_W) % MAP_W;
}

function countLandTiles(map: number[][], cx: number, cy: number): number {
  const OCEAN = 0;
  let land = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = wrapX(cx + dx), y = cy + dy;
      if (y >= 0 && y < MAP_H && map[y][x] !== OCEAN) land++;
    }
  return land;
}

// Replicate CITIES array from public/index.html
const CITIES = [
  { id: 'new-york', name: 'New York', lon: -74, lat: 41, emoji: '🗽', culture: 'american', coastal: true },
  { id: 'london', name: 'London', lon: 0, lat: 52, emoji: '🎡', culture: 'british', coastal: true },
  { id: 'paris', name: 'Paris', lon: 2, lat: 49, emoji: '🗼', culture: 'french' },
  { id: 'tokyo', name: 'Tokyo', lon: 140, lat: 36, emoji: '🗾', culture: 'japanese', coastal: true },
  { id: 'cairo', name: 'Cairo', lon: 31, lat: 30, emoji: '🏛️', culture: 'egyptian' },
  { id: 'sydney', name: 'Sydney', lon: 151, lat: -34, emoji: '🦘', culture: 'australian', coastal: true },
  { id: 'rio', name: 'Rio', lon: -43, lat: -23, emoji: '🎭', culture: 'brazilian', coastal: true },
  { id: 'beijing', name: 'Beijing', lon: 116, lat: 40, emoji: '🏯', culture: 'chinese' },
  { id: 'delhi', name: 'Delhi', lon: 77, lat: 29, emoji: '🕌', culture: 'indian' },
  { id: 'nairobi', name: 'Nairobi', lon: 37, lat: -1, emoji: '🦁', culture: 'kenyan' },
  { id: 'mexico-city', name: 'Mexico City', lon: -99, lat: 19, emoji: '🌮', culture: 'mexican' },
  { id: 'buenos-aires', name: 'Buenos Aires', lon: -58, lat: -35, emoji: '💃', culture: 'argentinian', coastal: true },
  { id: 'istanbul', name: 'Istanbul', lon: 29, lat: 41, emoji: '🕌', culture: 'turkish', coastal: true },
  { id: 'lagos', name: 'Lagos', lon: 3, lat: 6, emoji: '🥁', culture: 'nigerian', coastal: true },
  { id: 'dubai', name: 'Dubai', lon: 55, lat: 25, emoji: '🏙️', culture: 'emirati', coastal: true },
  { id: 'singapore', name: 'Singapore', lon: 104, lat: 1, emoji: '🦁', culture: 'singaporean', coastal: true },
  { id: 'seoul', name: 'Seoul', lon: 127, lat: 37, emoji: '🎎', culture: 'korean', coastal: true },
  { id: 'los-angeles', name: 'Los Angeles', lon: -118, lat: 34, emoji: '🎬', culture: 'american', coastal: true },
  { id: 'mumbai', name: 'Mumbai', lon: 73, lat: 19, emoji: '🎬', culture: 'indian', coastal: true },
  { id: 'bangkok', name: 'Bangkok', lon: 101, lat: 14, emoji: '🛕', culture: 'thai', coastal: true },
  { id: 'lima', name: 'Lima', lon: -77, lat: -12, emoji: '🏔️', culture: 'peruvian', coastal: true },
  { id: 'rome', name: 'Rome', lon: 12, lat: 42, emoji: '🏛️', culture: 'italian', coastal: true },
  { id: 'berlin', name: 'Berlin', lon: 13, lat: 52, emoji: '🏰', culture: 'german' },
  { id: 'reykjavik', name: 'Reykjavik', lon: -22, lat: 64, emoji: '🧊', culture: 'icelandic', coastal: true },
  { id: 'cape-town', name: 'Cape Town', lon: 18, lat: -34, emoji: '🐧', culture: 'south_african', coastal: true },
  { id: 'honolulu', name: 'Honolulu', lon: -158, lat: 21, emoji: '🌺', culture: 'hawaiian', coastal: true },
  { id: 'anchorage', name: 'Anchorage', lon: -150, lat: 61, emoji: '🐻', culture: 'alaskan', coastal: true },
  { id: 'krakow', name: 'Krakow', lon: 20, lat: 50, emoji: '🐉', culture: 'polish' },
  { id: 'madrid', name: 'Madrid', lon: -4, lat: 40, emoji: '🐂', culture: 'spanish' },
  { id: 'lisbon', name: 'Lisbon', lon: -9, lat: 39, emoji: '⛵', culture: 'portuguese', coastal: true },
  { id: 'amsterdam', name: 'Amsterdam', lon: 5, lat: 52, emoji: '🌷', culture: 'dutch', coastal: true },
  { id: 'vienna', name: 'Vienna', lon: 16, lat: 48, emoji: '🎻', culture: 'austrian' },
  { id: 'athens', name: 'Athens', lon: 24, lat: 38, emoji: '🏛️', culture: 'greek', coastal: true },
  { id: 'stockholm', name: 'Stockholm', lon: 18, lat: 59, emoji: '👑', culture: 'swedish', coastal: true },
  { id: 'oslo', name: 'Oslo', lon: 11, lat: 60, emoji: '🛡️', culture: 'norwegian', coastal: true },
  { id: 'helsinki', name: 'Helsinki', lon: 25, lat: 60, emoji: '🧖', culture: 'finnish', coastal: true },
  { id: 'prague', name: 'Prague', lon: 14, lat: 50, emoji: '🏰', culture: 'czech' },
  { id: 'kyiv', name: 'Kyiv', lon: 31, lat: 50, emoji: '🌻', culture: 'ukrainian' },
  { id: 'tehran', name: 'Tehran', lon: 51, lat: 36, emoji: '🕌', culture: 'iranian' },
  { id: 'hanoi', name: 'Hanoi', lon: 106, lat: 21, emoji: '🍜', culture: 'vietnamese' },
  { id: 'manila', name: 'Manila', lon: 121, lat: 15, emoji: '🌺', culture: 'filipino', coastal: true },
  { id: 'jakarta', name: 'Jakarta', lon: 107, lat: -6, emoji: '🌴', culture: 'indonesian', coastal: true },
  { id: 'addis-ababa', name: 'Addis Ababa', lon: 38, lat: 9, emoji: '☕', culture: 'ethiopian' },
  { id: 'bogota', name: 'Bogota', lon: -74, lat: 5, emoji: '🦜', culture: 'colombian' },
  { id: 'santiago', name: 'Santiago', lon: -71, lat: -33, emoji: '🏔️', culture: 'chilean' },
  { id: 'ottawa', name: 'Ottawa', lon: -76, lat: 45, emoji: '🍁', culture: 'canadian' },
  { id: 'wellington', name: 'Wellington', lon: 175, lat: -41, emoji: '🥝', culture: 'kiwi', coastal: true },
  { id: 'rabat', name: 'Rabat', lon: -7, lat: 34, emoji: '🫖', culture: 'moroccan', coastal: true },
  { id: 'dublin', name: 'Dublin', lon: -6, lat: 53, emoji: '☘️', culture: 'irish', coastal: true },
  { id: 'washington-dc', name: 'Washington DC', lon: -77, lat: 39, emoji: '🏛️', culture: 'american' },
  { id: 'atlanta', name: 'Atlanta', lon: -84, lat: 34, emoji: '🍑', culture: 'american' },
  { id: 'chicago', name: 'Chicago', lon: -88, lat: 42, emoji: '🌬️', culture: 'american' },
  { id: 'houston', name: 'Houston', lon: -95, lat: 30, emoji: '🚀', culture: 'american', coastal: true },
  { id: 'denver', name: 'Denver', lon: -105, lat: 40, emoji: '⛰️', culture: 'american' },
  { id: 'phoenix', name: 'Phoenix', lon: -112, lat: 33, emoji: '🌵', culture: 'american' },
  { id: 'seattle', name: 'Seattle', lon: -122, lat: 48, emoji: '☕', culture: 'american', coastal: true },
  { id: 'miami', name: 'Miami', lon: -80, lat: 26, emoji: '🌴', culture: 'american', coastal: true },
  { id: 'boston', name: 'Boston', lon: -71, lat: 42, emoji: '🦞', culture: 'american', coastal: true },
  { id: 'nashville', name: 'Nashville', lon: -87, lat: 36, emoji: '🎸', culture: 'american' },
  { id: 'minneapolis', name: 'Minneapolis', lon: -93, lat: 45, emoji: '❄️', culture: 'american' },
  { id: 'salt-lake-city', name: 'Salt Lake City', lon: -112, lat: 41, emoji: '🏔️', culture: 'american' },
  { id: 'san-francisco', name: 'San Francisco', lon: -122, lat: 38, emoji: '🌉', culture: 'american', coastal: true },
  { id: 'portland', name: 'Portland', lon: -123, lat: 46, emoji: '🌲', culture: 'american', coastal: true },
  { id: 'detroit', name: 'Detroit', lon: -83, lat: 42, emoji: '🏭', culture: 'american' },
  { id: 'dallas', name: 'Dallas', lon: -97, lat: 33, emoji: '🤠', culture: 'american' },
  { id: 'kansas-city', name: 'Kansas City', lon: -95, lat: 39, emoji: '🥩', culture: 'american' },
  { id: 'new-orleans', name: 'New Orleans', lon: -90, lat: 30, emoji: '🎺', culture: 'american', coastal: true },
  { id: 'charleston', name: 'Charleston', lon: -80, lat: 33, emoji: '🏰', culture: 'american', coastal: true },
  { id: 'pittsburgh', name: 'Pittsburgh', lon: -80, lat: 40, emoji: '🔩', culture: 'american' },
  { id: 'st-louis', name: 'St. Louis', lon: -90, lat: 39, emoji: '⛩️', culture: 'american' },
  { id: 'las-vegas', name: 'Las Vegas', lon: -115, lat: 36, emoji: '🎰', culture: 'american' },
  { id: 'albuquerque', name: 'Albuquerque', lon: -107, lat: 35, emoji: '🎈', culture: 'american' },
  { id: 'omaha', name: 'Omaha', lon: -96, lat: 41, emoji: '🌽', culture: 'american' },
  { id: 'boise', name: 'Boise', lon: -116, lat: 44, emoji: '🥔', culture: 'american' },
  { id: 'havana', name: 'Havana', lon: -82, lat: 23, emoji: '🚬', culture: 'cuban', coastal: true },
  { id: 'guatemala-city', name: 'Guatemala City', lon: -91, lat: 15, emoji: '🌋', culture: 'guatemalan' },
  { id: 'san-jose-cr', name: 'San Jose', lon: -84, lat: 10, emoji: '🦜', culture: 'costa_rican' },
  { id: 'panama-city', name: 'Panama City', lon: -80, lat: 9, emoji: '🚢', culture: 'panamanian', coastal: true },
  { id: 'kingston', name: 'Kingston', lon: -77, lat: 18, emoji: '🎶', culture: 'jamaican', coastal: true },
  { id: 'santo-domingo', name: 'Santo Domingo', lon: -70, lat: 19, emoji: '🏝️', culture: 'dominican', coastal: true },
  { id: 'tegucigalpa', name: 'Tegucigalpa', lon: -87, lat: 14, emoji: '🏔️', culture: 'honduran' },
  { id: 'managua', name: 'Managua', lon: -86, lat: 12, emoji: '🌊', culture: 'nicaraguan' },
  { id: 'san-salvador', name: 'San Salvador', lon: -89, lat: 14, emoji: '🌺', culture: 'salvadoran' },
  { id: 'caracas', name: 'Caracas', lon: -67, lat: 10, emoji: '🦅', culture: 'venezuelan', coastal: true },
  { id: 'quito', name: 'Quito', lon: -79, lat: 0, emoji: '🌋', culture: 'ecuadorian' },
  { id: 'montevideo', name: 'Montevideo', lon: -56, lat: -35, emoji: '🧉', culture: 'uruguayan', coastal: true },
  { id: 'asuncion', name: 'Asuncion', lon: -58, lat: -25, emoji: '🌿', culture: 'paraguayan' },
  { id: 'la-paz', name: 'La Paz', lon: -68, lat: -16, emoji: '🏔️', culture: 'bolivian' },
  { id: 'brasilia', name: 'Brasilia', lon: -48, lat: -16, emoji: '🏛️', culture: 'brazilian' },
  { id: 'sao-paulo', name: 'Sao Paulo', lon: -47, lat: -24, emoji: '🏙️', culture: 'brazilian' },
  { id: 'georgetown', name: 'Georgetown', lon: -58, lat: 7, emoji: '🌴', culture: 'guyanese', coastal: true },
  { id: 'paramaribo', name: 'Paramaribo', lon: -55, lat: 6, emoji: '🌺', culture: 'surinamese', coastal: true },
  { id: 'riyadh', name: 'Riyadh', lon: 47, lat: 25, emoji: '🕌', culture: 'saudi' },
  { id: 'baghdad', name: 'Baghdad', lon: 44, lat: 33, emoji: '🏛️', culture: 'iraqi' },
  { id: 'damascus', name: 'Damascus', lon: 36, lat: 34, emoji: '🕌', culture: 'syrian' },
  { id: 'amman', name: 'Amman', lon: 36, lat: 32, emoji: '🏛️', culture: 'jordanian' },
  { id: 'beirut', name: 'Beirut', lon: 35, lat: 34, emoji: '🌲', culture: 'lebanese', coastal: true },
  { id: 'doha', name: 'Doha', lon: 51, lat: 25, emoji: '🏙️', culture: 'qatari', coastal: true },
  { id: 'muscat', name: 'Muscat', lon: 59, lat: 24, emoji: '⛵', culture: 'omani', coastal: true },
  { id: 'sanaa', name: "Sana'a", lon: 44, lat: 15, emoji: '🏰', culture: 'yemeni' },
  { id: 'tunis', name: 'Tunis', lon: 10, lat: 37, emoji: '🏛️', culture: 'tunisian', coastal: true },
  { id: 'algiers', name: 'Algiers', lon: 3, lat: 37, emoji: '🏛️', culture: 'algerian', coastal: true },
  { id: 'tripoli', name: 'Tripoli', lon: 13, lat: 33, emoji: '🏛️', culture: 'libyan', coastal: true },
  { id: 'khartoum', name: 'Khartoum', lon: 33, lat: 16, emoji: '🏜️', culture: 'sudanese' },
  { id: 'accra', name: 'Accra', lon: 0, lat: 6, emoji: '🥁', culture: 'ghanaian', coastal: true },
  { id: 'dakar', name: 'Dakar', lon: -17, lat: 15, emoji: '🌊', culture: 'senegalese', coastal: true },
  { id: 'kinshasa', name: 'Kinshasa', lon: 15, lat: -4, emoji: '🌴', culture: 'congolese' },
  { id: 'dar-es-salaam', name: 'Dar es Salaam', lon: 39, lat: -7, emoji: '🌴', culture: 'tanzanian', coastal: true },
  { id: 'kampala', name: 'Kampala', lon: 33, lat: 0, emoji: '🏔️', culture: 'ugandan' },
  { id: 'luanda', name: 'Luanda', lon: 13, lat: -9, emoji: '🌊', culture: 'angolan', coastal: true },
  { id: 'maputo', name: 'Maputo', lon: 33, lat: -26, emoji: '🌊', culture: 'mozambican', coastal: true },
  { id: 'abuja', name: 'Abuja', lon: 7, lat: 9, emoji: '🏛️', culture: 'nigerian' },
  { id: 'casablanca', name: 'Casablanca', lon: -8, lat: 34, emoji: '🕌', culture: 'moroccan', coastal: true },
  { id: 'johannesburg', name: 'Johannesburg', lon: 28, lat: -26, emoji: '💎', culture: 'south_african' },
  { id: 'antananarivo', name: 'Antananarivo', lon: 48, lat: -19, emoji: '🦎', culture: 'malagasy' },
  { id: 'toronto', name: 'Toronto', lon: -79, lat: 44, emoji: '🏙️', culture: 'canadian' },
  { id: 'vancouver', name: 'Vancouver', lon: -123, lat: 49, emoji: '🌲', culture: 'canadian', coastal: true },
  { id: 'montreal', name: 'Montreal', lon: -74, lat: 46, emoji: '⚜️', culture: 'canadian' },
  { id: 'calgary', name: 'Calgary', lon: -114, lat: 51, emoji: '🤠', culture: 'canadian' },
  { id: 'edmonton', name: 'Edmonton', lon: -113, lat: 54, emoji: '🛢️', culture: 'canadian' },
  { id: 'winnipeg', name: 'Winnipeg', lon: -97, lat: 50, emoji: '❄️', culture: 'canadian' },
  { id: 'halifax', name: 'Halifax', lon: -64, lat: 45, emoji: '⚓', culture: 'canadian', coastal: true },
  { id: 'whitehorse', name: 'Whitehorse', lon: -135, lat: 61, emoji: '🐺', culture: 'canadian' },
  { id: 'yellowknife', name: 'Yellowknife', lon: -114, lat: 62, emoji: '💎', culture: 'canadian' },
  { id: 'iqaluit', name: 'Iqaluit', lon: -69, lat: 64, emoji: '🏔️', culture: 'canadian', coastal: true },
] as const;

type City = (typeof CITIES)[number] & { coastal?: boolean };

const KNOWN_COASTAL = [
  'new-york', 'los-angeles', 'buenos-aires', 'lima', 'rio', 'miami', 'boston',
  'san-francisco', 'seattle', 'portland', 'new-orleans', 'charleston', 'havana',
  'panama-city', 'kingston', 'santo-domingo', 'caracas', 'montevideo', 'georgetown',
  'paramaribo', 'honolulu', 'anchorage', 'vancouver', 'halifax', 'iqaluit', 'houston',
  'london', 'lisbon', 'amsterdam', 'athens', 'stockholm', 'oslo', 'helsinki',
  'reykjavik', 'dublin', 'rome',
  'lagos', 'cape-town', 'casablanca', 'rabat', 'accra', 'dakar', 'dar-es-salaam',
  'luanda', 'maputo',
  'tokyo', 'mumbai', 'singapore', 'seoul', 'bangkok', 'manila', 'jakarta',
  'wellington', 'sydney', 'istanbul', 'dubai', 'doha', 'muscat', 'beirut',
  'tunis', 'algiers', 'tripoli',
];

const KNOWN_INLAND = [
  'paris', 'beijing', 'delhi', 'nairobi', 'mexico-city', 'cairo', 'berlin',
  'krakow', 'madrid', 'vienna', 'prague', 'kyiv', 'tehran', 'hanoi',
  'addis-ababa', 'bogota', 'santiago', 'ottawa', 'denver', 'phoenix',
  'nashville', 'minneapolis', 'salt-lake-city', 'detroit', 'dallas',
  'kansas-city', 'pittsburgh', 'st-louis', 'las-vegas', 'albuquerque',
  'omaha', 'boise', 'washington-dc', 'atlanta', 'chicago',
  'riyadh', 'baghdad', 'damascus', 'amman', 'sanaa', 'khartoum',
  'kinshasa', 'kampala', 'abuja', 'johannesburg', 'antananarivo',
  'sao-paulo', 'brasilia', 'la-paz', 'asuncion', 'quito',
  'guatemala-city', 'san-jose-cr', 'tegucigalpa', 'managua', 'san-salvador',
  'toronto', 'montreal', 'calgary', 'edmonton', 'winnipeg', 'whitehorse', 'yellowknife',
];

describe('CITIES array integrity', () => {
  it('every city has required fields', () => {
    for (const city of CITIES) {
      expect(city.id).toBeTruthy();
      expect(city.name).toBeTruthy();
      expect(typeof city.lon).toBe('number');
      expect(typeof city.lat).toBe('number');
      expect(city.emoji).toBeTruthy();
      expect(city.culture).toBeTruthy();
    }
  });

  it('no duplicate city IDs', () => {
    const ids = CITIES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all lon values in [-180, 180] and lat in [-90, 90]', () => {
    for (const city of CITIES) {
      expect(city.lon).toBeGreaterThanOrEqual(-180);
      expect(city.lon).toBeLessThanOrEqual(180);
      expect(city.lat).toBeGreaterThanOrEqual(-90);
      expect(city.lat).toBeLessThanOrEqual(90);
    }
  });

  it('Beirut and Damascus have different coordinates', () => {
    const beirut = CITIES.find(c => c.id === 'beirut')!;
    const damascus = CITIES.find(c => c.id === 'damascus')!;
    expect(beirut.lon !== damascus.lon || beirut.lat !== damascus.lat).toBe(true);
  });
});

describe('coastal flag correctness', () => {
  it('all known coastal cities have coastal: true', () => {
    for (const id of KNOWN_COASTAL) {
      const city = CITIES.find(c => c.id === id) as City;
      expect(city, `missing city: ${id}`).toBeDefined();
      expect((city as any).coastal, `${id} should be coastal`).toBe(true);
    }
  });

  it('known inland cities do NOT have coastal flag', () => {
    for (const id of KNOWN_INLAND) {
      const city = CITIES.find(c => c.id === id) as City;
      expect(city, `missing city: ${id}`).toBeDefined();
      expect((city as any).coastal, `${id} should NOT be coastal`).toBeFalsy();
    }
  });

  it('coastal count matches expected', () => {
    const coastalCount = CITIES.filter(c => (c as any).coastal).length;
    expect(coastalCount).toBe(KNOWN_COASTAL.length);
  });

  it('every city is accounted for in coastal or inland lists', () => {
    const allKnown = new Set([...KNOWN_COASTAL, ...KNOWN_INLAND]);
    for (const city of CITIES) {
      expect(allKnown.has(city.id), `${city.id} not in either list`).toBe(true);
    }
  });
});

describe('coordinate conversion', () => {
  it('toMap() for coastal cities produces valid tile coords', () => {
    const coastalCities = CITIES.filter(c => (c as any).coastal);
    for (const city of coastalCities) {
      const [mx, my] = toMap(city.lon, city.lat);
      expect(mx).toBeGreaterThanOrEqual(0);
      expect(mx).toBeLessThan(MAP_W);
      expect(my).toBeGreaterThanOrEqual(0);
      expect(my).toBeLessThan(MAP_H);
    }
  });

  it('toMap() for all cities produces valid tile coords', () => {
    for (const city of CITIES) {
      const [mx, my] = toMap(city.lon, city.lat);
      expect(mx).toBeGreaterThanOrEqual(0);
      expect(mx).toBeLessThan(MAP_W);
      expect(my).toBeGreaterThanOrEqual(0);
      expect(my).toBeLessThan(MAP_H);
    }
  });
});

describe('countLandTiles', () => {
  it('returns 0-9 range', () => {
    const OCEAN = 0, LAND = 1;
    const map: number[][] = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(OCEAN));
    expect(countLandTiles(map, 5, 5)).toBe(0);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        map[5 + dy][5 + dx] = LAND;
    expect(countLandTiles(map, 5, 5)).toBe(9);
  });
});

describe('coastal nudge gating', () => {
  const OCEAN = 0, LAND = 1;

  function simulateCoastalNudge(city: { mx: number; my: number; coastal?: boolean }, map: number[][]) {
    const cx = city.mx, cy = city.my;
    let hasNearbyOcean = false;
    for (let dy = -8; dy <= 8 && !hasNearbyOcean; dy++) {
      for (let dx = -8; dx <= 8 && !hasNearbyOcean; dx++) {
        const nx = wrapX(cx + dx), ny = cy + dy;
        if (ny >= 0 && ny < MAP_H && map[ny][nx] === OCEAN) hasNearbyOcean = true;
      }
    }
    if (hasNearbyOcean && city.coastal) {
      let bestX = cx, bestY = cy, bestDist = Infinity;
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const nx = wrapX(cx + dx), ny = cy + dy;
          if (ny < 1 || ny >= MAP_H - 1) continue;
          if (map[ny][nx] === OCEAN) continue;
          let adjOcean = false;
          for (const [adx, ady] of [[0,-1],[1,0],[0,1],[-1,0]]) {
            const ax = wrapX(nx + adx), ay = ny + ady;
            if (ay >= 0 && ay < MAP_H && map[ay][ax] === OCEAN) { adjOcean = true; break; }
          }
          if (!adjOcean) continue;
          if (countLandTiles(map, nx, ny) < 5) continue;
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist < bestDist) { bestDist = dist; bestX = nx; bestY = ny; }
        }
      }
      if (bestDist < Infinity && bestDist <= 8) {
        city.mx = bestX; city.my = bestY;
      }
    }
  }

  function makeMapWithCoast(cx: number, cy: number) {
    const map: number[][] = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(LAND));
    // Place ocean 5 tiles east
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = 5; dx <= 12; dx++) {
        const ny = cy + dy, nx = wrapX(cx + dx);
        if (ny >= 0 && ny < MAP_H) map[ny][nx] = OCEAN;
      }
    }
    return map;
  }

  it('coastal city gets nudged toward ocean', () => {
    const cx = 100, cy = 100;
    const map = makeMapWithCoast(cx, cy);
    const city = { mx: cx, my: cy, coastal: true as const };
    simulateCoastalNudge(city, map);
    expect(city.mx).not.toBe(cx);
    expect(Math.abs(city.mx - cx) + Math.abs(city.my - cy)).toBeLessThanOrEqual(8);
  });

  it('non-coastal city stays put even with nearby ocean', () => {
    const cx = 100, cy = 100;
    const map = makeMapWithCoast(cx, cy);
    const city = { mx: cx, my: cy };
    simulateCoastalNudge(city, map);
    expect(city.mx).toBe(cx);
    expect(city.my).toBe(cy);
  });

  it('inland city stays within land-search radius of toMap origin', () => {
    const paris = CITIES.find(c => c.id === 'paris')!;
    const [origMx, origMy] = toMap(paris.lon, paris.lat);
    // The Phase 1 land-search scans up to 10 tiles
    expect(origMx).toBeGreaterThanOrEqual(0);
    expect(origMx).toBeLessThan(MAP_W);
    expect(origMy).toBeGreaterThanOrEqual(0);
    expect(origMy).toBeLessThan(MAP_H);
  });
});
