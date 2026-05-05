import { describe, it, expect } from 'vitest';
import { localFallback } from '../src/ai/fallback';

const makeDwarf = (overrides = {}) => ({
  id: 'd_test',
  name: 'Test Dwarf',
  hunger: 80,
  energy: 80,
  happiness: 70,
  state: 'idle',
  x: 10, y: 10,
  ...overrides,
});

const baseContext = {
  resources: { food: 30, wood: 10, stone: 10 },
  season: 'Spring',
  year: 1,
};

describe('Fallback Logic', () => {
  describe('simple tier', () => {
    it('returns a decision for every dwarf', () => {
      const dwarves = [makeDwarf({ id: 'd_1' }), makeDwarf({ id: 'd_2' }), makeDwarf({ id: 'd_3' })];
      const result = localFallback('simple', { ...baseContext, dwarves });
      expect(result.decisions).toHaveLength(3);
      expect(result.decisions.map((d: any) => d.dwarfId)).toEqual(['d_1', 'd_2', 'd_3']);
    });

    it('tells hungry dwarves to eat', () => {
      const dwarves = [makeDwarf({ id: 'd_hungry', hunger: 20 })];
      const result = localFallback('simple', { ...baseContext, dwarves });
      expect(result.decisions[0].action).toBe('eat');
    });

    it('tells tired dwarves to sleep', () => {
      const dwarves = [makeDwarf({ id: 'd_tired', energy: 15 })];
      const result = localFallback('simple', { ...baseContext, dwarves });
      expect(result.decisions[0].action).toBe('sleep');
    });

    it('tells unhappy dwarves to rest', () => {
      const dwarves = [makeDwarf({ id: 'd_sad', happiness: 20 })];
      const result = localFallback('simple', { ...baseContext, dwarves });
      expect(result.decisions[0].action).toBe('rest');
    });

    it('prioritizes hunger over tiredness', () => {
      const dwarves = [makeDwarf({ id: 'd_both', hunger: 10, energy: 10 })];
      const result = localFallback('simple', { ...baseContext, dwarves });
      expect(result.decisions[0].action).toBe('eat');
    });

    it('recommends farming when food is low', () => {
      const dwarves = [makeDwarf({ id: 'd_worker' })];
      const result = localFallback('simple', {
        ...baseContext,
        dwarves,
        resources: { food: 10, wood: 20, stone: 20 },
      });
      expect(result.decisions[0].action).toBe('farm');
    });

    it('recommends chopping when wood is low', () => {
      const dwarves = [makeDwarf({ id: 'd_worker' })];
      const result = localFallback('simple', {
        ...baseContext,
        dwarves,
        resources: { food: 30, wood: 3, stone: 20 },
      });
      expect(result.decisions[0].action).toBe('chop');
    });

    it('recommends mining when stone is low', () => {
      const dwarves = [makeDwarf({ id: 'd_worker' })];
      const result = localFallback('simple', {
        ...baseContext,
        dwarves,
        resources: { food: 30, wood: 20, stone: 3 },
      });
      expect(result.decisions[0].action).toBe('mine');
    });

    it('returns valid action for healthy well-resourced dwarf', () => {
      const dwarves = [makeDwarf({ id: 'd_happy' })];
      const result = localFallback('simple', { ...baseContext, dwarves });
      const validActions = ['explore', 'mine', 'farm', 'wander', 'brew'];
      expect(validActions).toContain(result.decisions[0].action);
    });

    it('every decision has a reason', () => {
      const dwarves = [makeDwarf(), makeDwarf({ id: 'd_2', hunger: 10 }), makeDwarf({ id: 'd_3', energy: 5 })];
      const result = localFallback('simple', { ...baseContext, dwarves });
      for (const dec of result.decisions) {
        expect(dec.reason).toBeTruthy();
        expect(typeof dec.reason).toBe('string');
      }
    });
  });

  describe('medium tier', () => {
    it('returns empty decisions (no social without AI)', () => {
      const result = localFallback('medium', { ...baseContext, dwarves: [makeDwarf()] });
      expect(result.decisions).toEqual([]);
    });
  });

  describe('complex tier', () => {
    it('returns empty decisions (no strategy without AI)', () => {
      const result = localFallback('complex', { ...baseContext, dwarves: [makeDwarf()] });
      expect(result.decisions).toEqual([]);
    });
  });

  describe('premium tier', () => {
    it('returns executable dwarf decisions', () => {
      const result = localFallback('premium', { ...baseContext, dwarves: [makeDwarf()] });
      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0].dwarfId).toBe('d_test');
      expect(result.decisions[0].reason).toBeTruthy();
    });
  });

  describe('edge cases', () => {
    it('handles empty dwarves array', () => {
      const result = localFallback('simple', { ...baseContext, dwarves: [] });
      expect(result.decisions).toEqual([]);
    });

    it('handles missing dwarves', () => {
      const result = localFallback('simple', { ...baseContext });
      expect(result.decisions).toEqual([]);
    });

    it('handles null context gracefully', () => {
      const result = localFallback('simple', {});
      expect(result.decisions).toEqual([]);
    });
  });
});
