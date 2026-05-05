import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

type IndustryRecipe = { out: string; amount: number; cost: Record<string, number> };
type IndustryHooks = {
  defaultRes: () => Record<string, number>;
  INDUSTRY_RECIPES: IndustryRecipe[];
  industryCapacity: (counts: { tableCount?: number; factoryCount?: number }) => number;
  scaleIndustryCost: (cost: Record<string, number>, owned: number, produced: number) => Record<string, number>;
  runCityIndustry: (
    city: { res: Record<string, number> },
    counts: { tableCount?: number; factoryCount?: number },
    cityPop: number
  ) => Record<string, number> | null;
};

function loadIndustryHooks(): IndustryHooks {
  const workerCode = readFileSync(new URL('../public/game-worker.js', import.meta.url), 'utf8');
  const start = workerCode.indexOf('function defaultRes()');
  const end = workerCode.indexOf('\nfunction createSuburb', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const context: Record<string, any> = { Math, Object };
  createContext(context);
  runInContext(workerCode.slice(start, end) + `
this.__hooks = {
  defaultRes,
  INDUSTRY_RECIPES,
  industryCapacity,
  scaleIndustryCost,
  runCityIndustry,
};`, context);
  return context.__hooks as IndustryHooks;
}

function powerOfTwo(n: number) {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

describe('geometric city industry', () => {
  it('defines a 2048-like resource ladder with power-of-two costs', () => {
    const hooks = loadIndustryHooks();
    expect(hooks.INDUSTRY_RECIPES.map(r => r.out)).toEqual(['ale', 'cloth', 'iron', 'gold', 'tools', 'relics']);
    for (const recipe of hooks.INDUSTRY_RECIPES) {
      expect(recipe.amount).toBe(1);
      for (const amount of Object.values(recipe.cost)) expect(powerOfTwo(amount)).toBe(true);
    }
    expect(hooks.INDUSTRY_RECIPES.find(r => r.out === 'gold')?.cost).toMatchObject({ iron: 64, ale: 32 });
    expect(hooks.INDUSTRY_RECIPES.find(r => r.out === 'tools')?.cost).toMatchObject({ iron: 128, cloth: 16 });
    expect(hooks.INDUSTRY_RECIPES.find(r => r.out === 'relics')?.cost).toMatchObject({ gold: 16, tools: 8 });
  });

  it('scales each repeated batch geometrically', () => {
    const hooks = loadIndustryHooks();
    expect(hooks.scaleIndustryCost({ food: 32 }, 0, 0).food).toBe(32);
    expect(hooks.scaleIndustryCost({ food: 32 }, 0, 1).food).toBe(64);
    expect(hooks.scaleIndustryCost({ food: 32 }, 0, 2).food).toBe(128);
    expect(hooks.scaleIndustryCost({ food: 32 }, 1024, 0).food).toBeGreaterThan(32);
  });

  it('spends surplus resources while preserving population reserves', () => {
    const hooks = loadIndustryHooks();
    const cityPop = 20;
    const city = {
      res: {
        ...hooks.defaultRes(),
        food: 10000,
        herbs: 1000,
        stone: 10000,
        wood: 5000,
        iron: 3000,
        gold: 200,
        cloth: 1000,
        ale: 1000,
        tools: 100,
      },
    };
    const made = hooks.runCityIndustry(city, { tableCount: 2, factoryCount: 1 }, cityPop);
    expect(made?.ale).toBeGreaterThan(0);
    expect(made?.tools).toBeGreaterThan(0);
    expect(made?.relics).toBeGreaterThan(0);
    expect(city.res.food).toBeGreaterThanOrEqual(50 + cityPop * 8);
    expect(city.res.food).toBeLessThan(10000);
    expect(city.res.herbs).toBeLessThan(1000);
  });

  it('requires workshops or factories to run production', () => {
    const hooks = loadIndustryHooks();
    const city = { res: { ...hooks.defaultRes(), food: 1000, herbs: 100 } };
    expect(hooks.industryCapacity({ tableCount: 0, factoryCount: 0 })).toBe(0);
    expect(hooks.runCityIndustry(city, { tableCount: 0, factoryCount: 0 }, 2)).toBeNull();
    const made = hooks.runCityIndustry(city, { tableCount: 1, factoryCount: 0 }, 2);
    expect(made).toMatchObject({ ale: 1, cloth: 1 });
  });
});
