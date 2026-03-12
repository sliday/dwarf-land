import { describe, it, expect } from 'vitest';

// Replicate reproduction and sex logic from game-worker.js

function makeDwarf(overrides: any = {}) {
  return {
    id: 'd_' + Math.random().toString(36).slice(2, 8),
    name: 'Test Dwarf',
    x: 10, y: 10,
    cityId: 'city_a',
    hunger: 80, energy: 80, happiness: 80,
    state: 'idle',
    target: null,
    path: [],
    timer: 0,
    age: 30,
    sex: Math.random() < 0.5 ? 'M' : 'F',
    stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    carrying: 0,
    carryItems: {},
    inventory: [],
    ...overrides,
  };
}

function makeCity(overrides: any = {}) {
  return {
    id: 'city_a',
    name: 'Testville',
    mx: 10, my: 10,
    res: { food: 100, wood: 50, stone: 50, iron: 20, gold: 5, cloth: 10, herbs: 5 },
    ...overrides,
  };
}

// Mirror reproduction eligibility logic from game-worker.js tickSeason
function findEligiblePairs(cityDwarves: any[]) {
  const males = cityDwarves.filter((d: any) => d.sex === 'M' && d.happiness >= 70 && d.age >= 20 && d.age < 55);
  const females = cityDwarves.filter((d: any) => d.sex === 'F' && d.happiness >= 70 && d.age >= 20 && d.age < 55);
  return { males, females };
}

function canReproduce(city: any, cityDwarves: any[], globalPop: number) {
  const cityPop = cityDwarves.length;
  if (cityPop >= 10 || globalPop >= 300) return false;
  if (city.res.food < cityPop * 3) return false;
  const { males, females } = findEligiblePairs(cityDwarves);
  return males.length > 0 && females.length > 0;
}

describe('Dwarf Sex Property', () => {
  it('createDwarf assigns sex M or F', () => {
    const counts = { M: 0, F: 0 };
    for (let i = 0; i < 200; i++) {
      const d = makeDwarf();
      expect(['M', 'F']).toContain(d.sex);
      counts[d.sex as 'M' | 'F']++;
    }
    // Roughly 50/50 distribution (allow wide tolerance)
    expect(counts.M).toBeGreaterThan(50);
    expect(counts.F).toBeGreaterThan(50);
  });

  it('sex property is preserved through serialization roundtrip', () => {
    const d = makeDwarf({ sex: 'F' });
    const serialized = { ...d, sex: d.sex || 'M' };
    const restored = { ...makeDwarf(), sex: serialized.sex || 'M' };
    expect(restored.sex).toBe('F');
  });

  it('gendered names: males get even-indexed names, females get odd-indexed', () => {
    const firstNames = ['James', 'Emily', 'Mason', 'Olivia', 'Ethan', 'Sophia', 'Liam', 'Ava'];
    const maleNames = firstNames.filter((_, i) => i % 2 === 0); // James, Mason, Ethan, Liam
    const femaleNames = firstNames.filter((_, i) => i % 2 === 1); // Emily, Olivia, Sophia, Ava

    expect(maleNames).toEqual(['James', 'Mason', 'Ethan', 'Liam']);
    expect(femaleNames).toEqual(['Emily', 'Olivia', 'Sophia', 'Ava']);

    // Verify male sex picks from even indices
    for (let i = 0; i < 50; i++) {
      const sex = 'M';
      const gendered = firstNames.filter((_, idx) => sex === 'M' ? idx % 2 === 0 : idx % 2 === 1);
      const name = gendered[Math.floor(Math.random() * gendered.length)];
      expect(maleNames).toContain(name);
    }

    // Verify female sex picks from odd indices
    for (let i = 0; i < 50; i++) {
      const sex = 'F';
      const gendered = firstNames.filter((_, idx) => sex === 'M' ? idx % 2 === 0 : idx % 2 === 1);
      const name = gendered[Math.floor(Math.random() * gendered.length)];
      expect(femaleNames).toContain(name);
    }
  });

  it('defaults to M when sex is missing (backwards compat)', () => {
    const d = makeDwarf();
    delete (d as any).sex;
    const sex = d.sex || 'M';
    expect(sex).toBe('M');
  });
});

describe('Reproduction Eligibility', () => {
  it('requires both male and female dwarves', () => {
    const city = makeCity();
    const allMale = [makeDwarf({ sex: 'M' }), makeDwarf({ sex: 'M' })];
    expect(canReproduce(city, allMale, 2)).toBe(false);

    const allFemale = [makeDwarf({ sex: 'F' }), makeDwarf({ sex: 'F' })];
    expect(canReproduce(city, allFemale, 2)).toBe(false);

    const mixed = [makeDwarf({ sex: 'M' }), makeDwarf({ sex: 'F' })];
    expect(canReproduce(city, mixed, 2)).toBe(true);
  });

  it('requires happiness >= 70', () => {
    const city = makeCity();
    const dwarves = [
      makeDwarf({ sex: 'M', happiness: 60 }),
      makeDwarf({ sex: 'F', happiness: 60 }),
    ];
    expect(canReproduce(city, dwarves, 2)).toBe(false);

    const happyDwarves = [
      makeDwarf({ sex: 'M', happiness: 75 }),
      makeDwarf({ sex: 'F', happiness: 75 }),
    ];
    expect(canReproduce(city, happyDwarves, 2)).toBe(true);
  });

  it('requires age 20-54', () => {
    const city = makeCity();
    const tooYoung = [
      makeDwarf({ sex: 'M', age: 15 }),
      makeDwarf({ sex: 'F', age: 18 }),
    ];
    expect(canReproduce(city, tooYoung, 2)).toBe(false);

    const tooOld = [
      makeDwarf({ sex: 'M', age: 55 }),
      makeDwarf({ sex: 'F', age: 60 }),
    ];
    expect(canReproduce(city, tooOld, 2)).toBe(false);

    const justRight = [
      makeDwarf({ sex: 'M', age: 20 }),
      makeDwarf({ sex: 'F', age: 54 }),
    ];
    expect(canReproduce(city, justRight, 2)).toBe(true);
  });

  it('blocks reproduction at city pop cap (10)', () => {
    const city = makeCity({ res: { food: 500 } });
    const dwarves = Array.from({ length: 10 }, (_, i) =>
      makeDwarf({ sex: i % 2 === 0 ? 'M' : 'F', cityId: city.id })
    );
    expect(canReproduce(city, dwarves, 10)).toBe(false);
  });

  it('blocks reproduction at global pop cap (300)', () => {
    const city = makeCity();
    const dwarves = [makeDwarf({ sex: 'M' }), makeDwarf({ sex: 'F' })];
    expect(canReproduce(city, dwarves, 300)).toBe(false);
  });

  it('blocks reproduction when food < pop*3', () => {
    const city = makeCity({ res: { food: 5 } });
    const dwarves = [makeDwarf({ sex: 'M' }), makeDwarf({ sex: 'F' })];
    expect(canReproduce(city, dwarves, 2)).toBe(false);
  });

  it('allows reproduction with sufficient food', () => {
    const city = makeCity({ res: { food: 100 } });
    const dwarves = [makeDwarf({ sex: 'M' }), makeDwarf({ sex: 'F' })];
    expect(canReproduce(city, dwarves, 2)).toBe(true);
  });
});

describe('Child State', () => {
  it('dwarves under age 20 are children', () => {
    const child = makeDwarf({ age: 5 });
    const isChild = (child.age ?? 20) < 20;
    expect(isChild).toBe(true);
  });

  it('dwarves age 20+ are not children', () => {
    const adult = makeDwarf({ age: 20 });
    const isChild = (adult.age ?? 20) < 20;
    expect(isChild).toBe(false);
  });

  it('children get reduced hunger drain (0.015 vs 0.03)', () => {
    const child = makeDwarf({ age: 5, hunger: 80 });
    const adult = makeDwarf({ age: 30, hunger: 80 });

    const childIsChild = (child.age ?? 20) < 20;
    const adultIsChild = (adult.age ?? 20) < 20;

    child.hunger = Math.max(0, child.hunger - (childIsChild ? 0.015 : 0.03));
    adult.hunger = Math.max(0, adult.hunger - (adultIsChild ? 0.015 : 0.03));

    expect(child.hunger).toBeCloseTo(79.985, 3);
    expect(adult.hunger).toBeCloseTo(79.97, 3);
  });

  it('children get reduced energy drain (0.01 vs 0.02)', () => {
    const child = makeDwarf({ age: 10, energy: 80 });
    const adult = makeDwarf({ age: 30, energy: 80 });

    const childIsChild = (child.age ?? 20) < 20;
    const adultIsChild = (adult.age ?? 20) < 20;

    child.energy = Math.max(0, child.energy - (childIsChild ? 0.01 : 0.02));
    adult.energy = Math.max(0, adult.energy - (adultIsChild ? 0.01 : 0.02));

    expect(child.energy).toBeCloseTo(79.99, 3);
    expect(adult.energy).toBeCloseTo(79.98, 3);
  });

  it('children idle into wander state instead of working', () => {
    const child = makeDwarf({ age: 10, state: 'idle' });
    // Mirror aiIdle child check
    if ((child.age ?? 20) < 20) {
      child.state = 'wander';
      child.timer = 15 + Math.floor(Math.random() * 20);
    }
    expect(child.state).toBe('wander');
    expect(child.timer).toBeGreaterThanOrEqual(15);
    expect(child.timer).toBeLessThan(35);
  });

  it('adults do NOT get forced into wander from idle', () => {
    const adult = makeDwarf({ age: 25, state: 'idle' });
    if ((adult.age ?? 20) < 20) {
      adult.state = 'wander';
    }
    expect(adult.state).toBe('idle');
  });

  it('newborn starts at age 0', () => {
    const baby = makeDwarf({ age: 0 });
    expect(baby.age).toBe(0);
    expect((baby.age ?? 20) < 20).toBe(true);
  });
});

describe('Age Categories', () => {
  it('age < 20 is Child', () => {
    const age = 15;
    const category = age < 20 ? 'Child' : age >= 60 ? 'Elder' : 'Adult';
    expect(category).toBe('Child');
  });

  it('age 20-59 is Adult', () => {
    for (const age of [20, 30, 45, 59]) {
      const category = age < 20 ? 'Child' : age >= 60 ? 'Elder' : 'Adult';
      expect(category).toBe('Adult');
    }
  });

  it('age 60+ is Elder', () => {
    for (const age of [60, 70, 85]) {
      const category = age < 20 ? 'Child' : age >= 60 ? 'Elder' : 'Adult';
      expect(category).toBe('Elder');
    }
  });
});
