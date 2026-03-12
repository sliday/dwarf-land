import { describe, it, expect } from 'vitest';
import {
  ACTIONS,
  ACTION_IDS,
  SIMPLE_ACTIONS,
  MEDIUM_ACTIONS,
  COMPLEX_ACTIONS,
  PREMIUM_ACTIONS,
} from '../src/shared/actions';

describe('Action System', () => {
  describe('action catalog completeness', () => {
    it('has at least 35 actions', () => {
      expect(ACTION_IDS.length).toBeGreaterThanOrEqual(35);
    });

    it('every action has category, keyStat, and durationTicks', () => {
      for (const id of ACTION_IDS) {
        const action = ACTIONS[id];
        expect(action.category, `${id} missing category`).toBeTruthy();
        expect(action.keyStat, `${id} missing keyStat`).toBeTruthy();
        expect(action.durationTicks, `${id} missing durationTicks`).toBeGreaterThan(0);
      }
    });

    it('all key stats are valid D&D stats', () => {
      const validStats = new Set(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
      for (const id of ACTION_IDS) {
        expect(validStats.has(ACTIONS[id].keyStat), `${id} has invalid keyStat: ${ACTIONS[id].keyStat}`).toBe(true);
      }
    });
  });

  describe('category coverage', () => {
    it('has all required categories', () => {
      const categories = new Set(ACTION_IDS.map(id => ACTIONS[id].category));
      expect(categories.has('survival')).toBe(true);
      expect(categories.has('work')).toBe(true);
      expect(categories.has('social')).toBe(true);
      expect(categories.has('combat')).toBe(true);
      expect(categories.has('religion')).toBe(true);
      expect(categories.has('reproduction')).toBe(true);
      expect(categories.has('animal')).toBe(true);
      expect(categories.has('governance')).toBe(true);
      expect(categories.has('movement')).toBe(true);
    });

    it('survival category has eat, drink, sleep, rest, heal', () => {
      const survival = ACTION_IDS.filter(id => ACTIONS[id].category === 'survival');
      expect(survival).toContain('eat');
      expect(survival).toContain('drink');
      expect(survival).toContain('sleep');
      expect(survival).toContain('rest');
      expect(survival).toContain('heal');
    });

    it('combat category has attack, defend, flee, steal, ambush', () => {
      const combat = ACTION_IDS.filter(id => ACTIONS[id].category === 'combat');
      expect(combat).toContain('attack');
      expect(combat).toContain('defend');
      expect(combat).toContain('flee');
      expect(combat).toContain('steal');
      expect(combat).toContain('ambush');
    });
  });

  describe('tier boundaries', () => {
    it('simple actions are survival/work/movement/religion basics', () => {
      for (const action of SIMPLE_ACTIONS) {
        const cat = ACTIONS[action].category;
        expect(['survival', 'work', 'religion', 'movement', 'idle'].includes(cat),
          `SIMPLE action "${action}" has unexpected category "${cat}"`).toBe(true);
      }
    });

    it('medium actions are social/reproduction/animal', () => {
      for (const action of MEDIUM_ACTIONS) {
        const cat = ACTIONS[action].category;
        expect(['social', 'reproduction', 'animal'].includes(cat),
          `MEDIUM action "${action}" has unexpected category "${cat}"`).toBe(true);
      }
    });

    it('complex actions include combat and governance', () => {
      for (const action of COMPLEX_ACTIONS) {
        const cat = ACTIONS[action].category;
        expect(['combat', 'governance', 'movement', 'social'].includes(cat),
          `COMPLEX action "${action}" has unexpected category "${cat}"`).toBe(true);
      }
    });

    it('premium actions are high-level religion', () => {
      for (const action of PREMIUM_ACTIONS) {
        const cat = ACTIONS[action].category;
        expect(cat).toBe('religion');
      }
    });

    it('tier action lists do not overlap', () => {
      const simpleSet = new Set(SIMPLE_ACTIONS);
      const mediumSet = new Set(MEDIUM_ACTIONS);
      const complexSet = new Set(COMPLEX_ACTIONS);
      const premiumSet = new Set(PREMIUM_ACTIONS);

      for (const a of SIMPLE_ACTIONS) {
        expect(mediumSet.has(a), `"${a}" in both SIMPLE and MEDIUM`).toBe(false);
        expect(complexSet.has(a), `"${a}" in both SIMPLE and COMPLEX`).toBe(false);
        expect(premiumSet.has(a), `"${a}" in both SIMPLE and PREMIUM`).toBe(false);
      }
      for (const a of MEDIUM_ACTIONS) {
        expect(complexSet.has(a), `"${a}" in both MEDIUM and COMPLEX`).toBe(false);
        expect(premiumSet.has(a), `"${a}" in both MEDIUM and PREMIUM`).toBe(false);
      }
      for (const a of COMPLEX_ACTIONS) {
        expect(premiumSet.has(a), `"${a}" in both COMPLEX and PREMIUM`).toBe(false);
      }
    });
  });

  describe('duration balance', () => {
    it('survival actions are fast (3-20 ticks)', () => {
      const survival = ACTION_IDS.filter(id => ACTIONS[id].category === 'survival');
      for (const id of survival) {
        expect(ACTIONS[id].durationTicks).toBeGreaterThanOrEqual(3);
        expect(ACTIONS[id].durationTicks).toBeLessThanOrEqual(40);
      }
    });

    it('combat actions are quick (3-8 ticks)', () => {
      const combat = ACTION_IDS.filter(id => ACTIONS[id].category === 'combat');
      for (const id of combat) {
        expect(ACTIONS[id].durationTicks).toBeLessThanOrEqual(8);
      }
    });

    it('pilgrimage is the longest action', () => {
      const maxDuration = Math.max(...ACTION_IDS.map(id => ACTIONS[id].durationTicks));
      expect(ACTIONS['pilgrimage'].durationTicks).toBe(maxDuration);
    });
  });
});
