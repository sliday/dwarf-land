import { describe, it, expect } from 'vitest';
import { buildPremiumDecreePrompt, buildPrompt } from '../src/ai/prompts';

const makeDwarf = (overrides = {}) => ({
  id: 'd_test',
  name: 'Urist Hammerfall',
  hunger: 80,
  energy: 80,
  happiness: 70,
  state: 'idle',
  x: 10, y: 10,
  ...overrides,
});

const baseContext = {
  dwarves: [makeDwarf(), makeDwarf({ id: 'd_2', name: 'Doren Stonebrow' })],
  resources: { food: 30, wood: 10, stone: 15 },
  season: 'Spring',
  year: 1,
};

describe('Prompt Templates', () => {
  describe('simple tier', () => {
    it('includes RESOURCES section', () => {
      const prompt = buildPrompt('simple', baseContext);
      expect(prompt).toContain('RESOURCES:');
      expect(prompt).toContain('food=30');
      expect(prompt).toContain('wood=10');
      expect(prompt).toContain('stone=15');
    });

    it('includes SEASON and YEAR', () => {
      const prompt = buildPrompt('simple', baseContext);
      expect(prompt).toContain('Spring');
      expect(prompt).toContain('YEAR: 1');
    });

    it('includes dwarf data', () => {
      const prompt = buildPrompt('simple', baseContext);
      expect(prompt).toContain('d_test');
      expect(prompt).toContain('Urist Hammerfall');
      expect(prompt).toContain('hunger:80');
    });

    it('lists available actions', () => {
      const prompt = buildPrompt('simple', baseContext);
      expect(prompt).toContain('eat');
      expect(prompt).toContain('mine');
      expect(prompt).toContain('sleep');
      expect(prompt).toContain('farm');
    });

    it('is reasonably short (<2000 chars for 2 dwarves)', () => {
      const prompt = buildPrompt('simple', baseContext);
      expect(prompt.length).toBeLessThan(2000);
    });

    it('instructs JSON output', () => {
      const prompt = buildPrompt('simple', baseContext);
      expect(prompt.toLowerCase()).toContain('json');
    });
  });

  describe('medium tier', () => {
    it('includes social actions', () => {
      const prompt = buildPrompt('medium', baseContext);
      expect(prompt).toContain('talk');
      expect(prompt).toContain('befriend');
      expect(prompt).toContain('court');
    });

    it('includes population count', () => {
      const prompt = buildPrompt('medium', baseContext);
      expect(prompt).toContain('POPULATION: 2');
    });

    it('mentions CHA and social dynamics', () => {
      const prompt = buildPrompt('medium', baseContext);
      expect(prompt).toContain('CHA');
    });
  });

  describe('complex tier', () => {
    it('includes strategic actions', () => {
      const prompt = buildPrompt('complex', baseContext);
      expect(prompt).toContain('attack');
      expect(prompt).toContain('defend');
      expect(prompt).toContain('governance');
    });

    it('asks about threats and strategy', () => {
      const prompt = buildPrompt('complex', baseContext);
      expect(prompt.toLowerCase()).toContain('threat');
    });
  });

  describe('premium tier', () => {
    it('returns executable per-dwarf decision instructions', () => {
      const prompt = buildPrompt('premium', baseContext);
      expect(prompt).toContain('per-dwarf intents');
      expect(prompt).toContain('AVAILABLE ACTIONS');
      expect(prompt).toContain('targetDwarfId');
      expect(prompt).toContain('Return per-dwarf decisions');
    });

    it('keeps deity decrees on the separate decree prompt', () => {
      const context = {
        ...baseContext,
        religion: {
          name: 'The Eternal Flame',
          deity: 'Korthak, God of Deep Stone',
          tenets: ['Honor the stone', 'Never waste food'],
          centuryPlan: {
            purpose: 'Unite all cities',
            phases: [{ yearRange: [1, 50], goal: 'Build temples', priority: 'high' }],
            prophecy: 'The deep fires will rise.',
          },
        },
      };
      const prompt = buildPremiumDecreePrompt(context);
      expect(prompt).toContain('Korthak');
      expect(prompt).toContain('The Eternal Flame');
      expect(prompt).toContain('Honor the stone');
      expect(prompt).toContain('deity');
    });

    it('handles missing religion gracefully', () => {
      const prompt = buildPremiumDecreePrompt(baseContext);
      expect(prompt).toBeTruthy();
    });
  });

  describe('prompt scaling', () => {
    it('scales linearly with dwarf count', () => {
      const small = buildPrompt('simple', {
        ...baseContext,
        dwarves: [makeDwarf()],
      });
      const large = buildPrompt('simple', {
        ...baseContext,
        dwarves: Array.from({ length: 20 }, (_, i) => makeDwarf({ id: `d_${i}`, name: `Dwarf ${i}` })),
      });
      // 20 dwarves should be roughly 10-20x the single dwarf section, not quadratic
      expect(large.length).toBeLessThan(small.length * 25);
      expect(large.length).toBeGreaterThan(small.length * 2);
    });
  });
});
