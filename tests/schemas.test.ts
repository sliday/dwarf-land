import { describe, it, expect } from 'vitest';
import {
  SimpleDecisionSchema,
  MediumDecisionSchema,
  ComplexDecisionSchema,
  PremiumDecisionSchema,
  BackstorySchema,
  ReligionSchema,
} from '../src/ai/schemas';

describe('Zod Schema Validation', () => {
  describe('SimpleDecisionSchema', () => {
    it('accepts valid simple decisions', () => {
      const valid = {
        decisions: [
          { dwarfId: 'd_abc', action: 'eat', reason: 'hungry' },
          { dwarfId: 'd_def', action: 'mine', reason: 'need stone' },
          { dwarfId: 'd_ghi', action: 'sleep', reason: 'tired' },
        ],
      };
      const result = SimpleDecisionSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('rejects non-simple actions', () => {
      const invalid = {
        decisions: [
          { dwarfId: 'd_abc', action: 'attack', reason: 'angry' },
        ],
      };
      const result = SimpleDecisionSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects missing dwarfId', () => {
      const invalid = {
        decisions: [{ action: 'eat', reason: 'hungry' }],
      };
      const result = SimpleDecisionSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects reasons over 80 chars', () => {
      const invalid = {
        decisions: [
          { dwarfId: 'd_abc', action: 'eat', reason: 'x'.repeat(81) },
        ],
      };
      const result = SimpleDecisionSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('accepts all simple action types', () => {
      const actions = ['eat', 'drink', 'sleep', 'rest', 'mine', 'build', 'farm', 'craft', 'cook', 'brew', 'haul', 'chop', 'pray', 'wander', 'walk', 'explore'];
      for (const action of actions) {
        const result = SimpleDecisionSchema.safeParse({
          decisions: [{ dwarfId: 'd_test', action, reason: 'test' }],
        });
        expect(result.success, `Action "${action}" should be valid for SIMPLE tier`).toBe(true);
      }
    });
  });

  describe('MediumDecisionSchema', () => {
    it('accepts valid social decisions with target', () => {
      const valid = {
        decisions: [
          { dwarfId: 'd_abc', action: 'talk', targetDwarfId: 'd_def', reason: 'feeling social' },
        ],
      };
      const result = MediumDecisionSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('rejects non-social actions', () => {
      const invalid = {
        decisions: [
          { dwarfId: 'd_abc', action: 'mine', reason: 'wrong tier' },
        ],
      };
      const result = MediumDecisionSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('accepts all medium action types', () => {
      const actions = ['talk', 'persuade', 'trade', 'befriend', 'gossip', 'teach', 'learn', 'court', 'mate', 'nurture', 'tame', 'feed_pet'];
      for (const action of actions) {
        const result = MediumDecisionSchema.safeParse({
          decisions: [{ dwarfId: 'd_test', action, reason: 'test' }],
        });
        expect(result.success, `Action "${action}" should be valid for MEDIUM tier`).toBe(true);
      }
    });
  });

  describe('ComplexDecisionSchema', () => {
    it('accepts strategic actions', () => {
      const valid = {
        decisions: [
          { dwarfId: 'd_abc', action: 'attack', targetDwarfId: 'd_enemy', reason: 'defending colony' },
        ],
      };
      const result = ComplexDecisionSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('also accepts medium-tier actions (superset)', () => {
      const valid = {
        decisions: [
          { dwarfId: 'd_abc', action: 'trade', reason: 'building alliance' },
        ],
      };
      const result = ComplexDecisionSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('rejects simple-tier-only actions', () => {
      const invalid = {
        decisions: [
          { dwarfId: 'd_abc', action: 'eat', reason: 'wrong tier' },
        ],
      };
      const result = ComplexDecisionSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('PremiumDecisionSchema', () => {
    it('accepts valid god decree', () => {
      const valid = {
        decree: {
          text: 'Build a great shrine to honor the deep stone!',
          action: 'build_shrine',
          urgency: 75,
        },
        divineMessage: 'The earth trembles with my blessing.',
      };
      const result = PremiumDecisionSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('rejects urgency outside 0-100', () => {
      const invalid = {
        decree: {
          text: 'Invalid urgency',
          action: 'pray',
          urgency: 150,
        },
      };
      const result = PremiumDecisionSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects invalid action enum value', () => {
      const invalid = {
        decree: {
          text: 'Bad action',
          action: 'fly_to_moon',
          urgency: 50,
        },
      };
      const result = PremiumDecisionSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('accepts optional prophecy and divineMessage', () => {
      const minimal = {
        decree: { text: 'Pray now.', action: 'pray', urgency: 50 },
      };
      const result = PremiumDecisionSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });
  });

  describe('BackstorySchema', () => {
    it('accepts valid backstory', () => {
      const valid = {
        name: 'Urist Hammerfall',
        backstory: 'Born in the deep mines of the northern mountains, Urist always heard the stones whisper.',
        traits: ['stubborn', 'pious'],
      };
      const result = BackstorySchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('requires at least 1 trait and at most 3', () => {
      const noTraits = { name: 'Test', backstory: 'Story', traits: [] };
      expect(BackstorySchema.safeParse(noTraits).success).toBe(false);

      const tooMany = { name: 'Test', backstory: 'Story', traits: ['a', 'b', 'c', 'd'] };
      expect(BackstorySchema.safeParse(tooMany).success).toBe(false);

      const justRight = { name: 'Test', backstory: 'Story', traits: ['a', 'b', 'c'] };
      expect(BackstorySchema.safeParse(justRight).success).toBe(true);
    });
  });

  describe('ReligionSchema', () => {
    it('accepts valid religion definition', () => {
      const valid = {
        name: 'The Eternal Flame of Ur',
        deity: 'Korthak, God of Deep Stone',
        tenets: ['Honor the stone', 'Never waste food'],
        centuryPlan: {
          purpose: 'Unite all cities under the Flame',
          phases: [
            { yearRange: [1, 25] as [number, number], goal: 'Establish temples', priority: 'high' },
            { yearRange: [26, 50] as [number, number], goal: 'Convert neighbors', priority: 'medium' },
          ],
          prophecy: 'When the deep fires rise, all shall kneel.',
        },
      };
      const result = ReligionSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('requires 2-5 tenets', () => {
      const base = {
        name: 'Test', deity: 'God',
        centuryPlan: {
          purpose: 'Test', prophecy: 'Test',
          phases: [
            { yearRange: [1, 50], goal: 'G1', priority: 'P1' },
            { yearRange: [51, 100], goal: 'G2', priority: 'P2' },
          ],
        },
      };
      expect(ReligionSchema.safeParse({ ...base, tenets: ['one'] }).success).toBe(false);
      expect(ReligionSchema.safeParse({ ...base, tenets: ['a', 'b'] }).success).toBe(true);
      expect(ReligionSchema.safeParse({ ...base, tenets: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(true);
      expect(ReligionSchema.safeParse({ ...base, tenets: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false);
    });

    it('requires 2-4 century plan phases', () => {
      const base = {
        name: 'Test', deity: 'God', tenets: ['a', 'b'],
        centuryPlan: { purpose: 'Test', prophecy: 'Test' },
      };
      const phase = { yearRange: [1, 25], goal: 'G', priority: 'P' };

      expect(ReligionSchema.safeParse({ ...base, centuryPlan: { ...base.centuryPlan, phases: [phase] } }).success).toBe(false);
      expect(ReligionSchema.safeParse({ ...base, centuryPlan: { ...base.centuryPlan, phases: [phase, phase] } }).success).toBe(true);
      expect(ReligionSchema.safeParse({ ...base, centuryPlan: { ...base.centuryPlan, phases: [phase, phase, phase, phase] } }).success).toBe(true);
      expect(ReligionSchema.safeParse({ ...base, centuryPlan: { ...base.centuryPlan, phases: [phase, phase, phase, phase, phase] } }).success).toBe(false);
    });
  });
});
