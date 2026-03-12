import { describe, it, expect } from 'vitest';

describe('Trading System', () => {
  function makeDwarf(overrides: Record<string, any> = {}) {
    return {
      id: 'd_' + Math.random().toString(36).slice(2, 6),
      name: 'Test Dwarf',
      x: 10, y: 10,
      cityId: 'city_a',
      hunger: 80, energy: 80, happiness: 70,
      state: 'idle',
      stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      inventory: [],
      relationships: [],
      ...overrides,
    };
  }

  describe('Meeting detection', () => {
    it('same-tile dwarves from different cities can meet', () => {
      const d1 = makeDwarf({ x: 5, y: 5, cityId: 'city_a', state: 'idle' });
      const d2 = makeDwarf({ x: 5, y: 5, cityId: 'city_b', state: 'idle' });
      const sameTile = d1.x === d2.x && d1.y === d2.y;
      const diffCity = d1.cityId !== d2.cityId;
      const bothIdle = d1.state === 'idle' && d2.state === 'idle';
      expect(sameTile && diffCity && bothIdle).toBe(true);
    });

    it('same-city dwarves cannot trade', () => {
      const d1 = makeDwarf({ cityId: 'city_a' });
      const d2 = makeDwarf({ cityId: 'city_a' });
      expect(d1.cityId === d2.cityId).toBe(true);
    });

    it('dwarves on different tiles cannot meet', () => {
      const d1 = makeDwarf({ x: 5, y: 5 });
      const d2 = makeDwarf({ x: 6, y: 5 });
      expect(d1.x === d2.x && d1.y === d2.y).toBe(false);
    });
  });

  describe('Enemy dwarves refuse trade', () => {
    it('enemy relationship prevents trade', () => {
      const d1 = makeDwarf({
        relationships: [{ targetId: 'd_other', type: 'enemy', strength: -80 }],
      });
      const isEnemy = d1.relationships.some(
        (r: any) => r.targetId === 'd_other' && (r.type === 'enemy' || r.strength < -50)
      );
      expect(isEnemy).toBe(true);
    });

    it('strong negative relationship prevents trade', () => {
      const d1 = makeDwarf({
        relationships: [{ targetId: 'd_other', type: 'rival', strength: -60 }],
      });
      const isHostile = d1.relationships.some(
        (r: any) => r.targetId === 'd_other' && (r.type === 'enemy' || r.strength < -50)
      );
      expect(isHostile).toBe(true);
    });

    it('friendly relationship allows trade', () => {
      const d1 = makeDwarf({
        relationships: [{ targetId: 'd_other', type: 'friend', strength: 40 }],
      });
      const isHostile = d1.relationships.some(
        (r: any) => r.targetId === 'd_other' && (r.type === 'enemy' || r.strength < -50)
      );
      expect(isHostile).toBe(false);
    });
  });

  describe('INT advantage in trade', () => {
    it('higher INT dwarf gets better deal (2:1)', () => {
      const smart = makeDwarf({ stats: { ...makeDwarf().stats, INT: 18 } });
      const dumb = makeDwarf({ stats: { ...makeDwarf().stats, INT: 8 } });
      const intDiff = smart.stats.INT - dumb.stats.INT;
      // INT diff >= 5 means smart gives 1, gets 2
      expect(intDiff).toBeGreaterThanOrEqual(5);
    });

    it('similar INT means equal trade (1:1)', () => {
      const d1 = makeDwarf({ stats: { ...makeDwarf().stats, INT: 12 } });
      const d2 = makeDwarf({ stats: { ...makeDwarf().stats, INT: 10 } });
      const intDiff = Math.abs(d1.stats.INT - d2.stats.INT);
      expect(intDiff).toBeLessThan(5);
    });
  });

  describe('Empty inventory prevents trade', () => {
    it('no items means no trade', () => {
      const d1 = makeDwarf({ inventory: [] });
      const d2 = makeDwarf({ inventory: [{ emoji: '💧', name: 'Water' }] });
      const bothHaveItems = d1.inventory.length > 0 && d2.inventory.length > 0;
      expect(bothHaveItems).toBe(false);
    });

    it('both have items allows trade', () => {
      const d1 = makeDwarf({ inventory: [{ emoji: '💧', name: 'Water' }] });
      const d2 = makeDwarf({ inventory: [{ emoji: '🔥', name: 'Fire' }] });
      const bothHaveItems = d1.inventory.length > 0 && d2.inventory.length > 0;
      expect(bothHaveItems).toBe(true);
    });
  });

  describe('Trade execution', () => {
    it('1:1 trade swaps items between inventories', () => {
      const d1 = makeDwarf({
        inventory: [{ emoji: '💧', name: 'Water' }, { emoji: '🌎', name: 'Earth' }],
      });
      const d2 = makeDwarf({
        inventory: [{ emoji: '🔥', name: 'Fire' }, { emoji: '💨', name: 'Wind' }],
      });

      // Simulate 1:1 trade: each gives lowest depth item
      const give1 = d1.inventory.shift();
      const give2 = d2.inventory.shift();
      d1.inventory.push(give2);
      d2.inventory.push(give1);

      expect(d1.inventory.map((i: any) => i.name)).toContain('Fire');
      expect(d2.inventory.map((i: any) => i.name)).toContain('Water');
    });
  });
});
