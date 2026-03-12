import { describe, it, expect } from 'vitest';
import { CraftResultSchema } from '../src/ai/schemas';

describe('Crafting System', () => {
  describe('CraftResultSchema', () => {
    it('accepts valid craft result', () => {
      const valid = { emoji: '💨', name: 'Steam' };
      expect(CraftResultSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects missing emoji', () => {
      const invalid = { name: 'Steam' };
      expect(CraftResultSchema.safeParse(invalid).success).toBe(false);
    });

    it('rejects missing name', () => {
      const invalid = { emoji: '💨' };
      expect(CraftResultSchema.safeParse(invalid).success).toBe(false);
    });

    it('rejects name over 50 chars', () => {
      const invalid = { emoji: '💨', name: 'x'.repeat(51) };
      expect(CraftResultSchema.safeParse(invalid).success).toBe(false);
    });

    it('accepts name at exactly 50 chars', () => {
      const valid = { emoji: '💨', name: 'x'.repeat(50) };
      expect(CraftResultSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('Recipe normalization', () => {
    it('items sorted alphabetically produce same key', () => {
      const items1 = [
        { emoji: '💧', name: 'Water' },
        { emoji: '🔥', name: 'Fire' },
      ];
      const items2 = [
        { emoji: '🔥', name: 'Fire' },
        { emoji: '💧', name: 'Water' },
      ];

      const sort = (a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name);
      const [a1, b1] = [...items1].sort(sort);
      const [a2, b2] = [...items2].sort(sort);

      expect(a1.name).toBe(a2.name);
      expect(b1.name).toBe(b2.name);
    });
  });

  describe('Inventory limits', () => {
    const MAX_INVENTORY = 6;

    it('inventory cannot exceed 6 items', () => {
      const inventory: Array<{ emoji: string; name: string }> = [];
      for (let i = 0; i < 8; i++) {
        if (inventory.length < MAX_INVENTORY) {
          inventory.push({ emoji: '🪨', name: `Item${i}` });
        }
      }
      expect(inventory.length).toBe(MAX_INVENTORY);
    });

    it('crafting removes 2 items and adds 1', () => {
      const inventory = [
        { emoji: '💧', name: 'Water' },
        { emoji: '🔥', name: 'Fire' },
        { emoji: '🌎', name: 'Earth' },
      ];
      // Craft first two
      const [item1, item2] = inventory.splice(0, 2);
      inventory.push({ emoji: '💨', name: 'Steam' });

      expect(inventory.length).toBe(2); // 3 - 2 + 1
      expect(inventory[1].name).toBe('Steam');
    });
  });

  describe('Fallback craft result', () => {
    it('deterministic fallback combines name halves', () => {
      const item1 = { emoji: '💧', name: 'Water' };
      const item2 = { emoji: '🔥', name: 'Fire' };

      const half1 = item1.name.slice(0, Math.ceil(item1.name.length / 2));
      const half2 = item2.name.slice(Math.floor(item2.name.length / 2));
      const result = (half1 + half2).slice(0, 50);

      expect(half1).toBe('Wat');
      expect(half2).toBe('re');
      expect(result).toBe('Watre');
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('fallback emoji is deterministic based on name lengths', () => {
      const emojis = ['✨', '🔮', '⚡', '🌀', '💫', '🎯', '🪄'];
      const item1 = { name: 'Water' }; // length 5
      const item2 = { name: 'Fire' }; // length 4
      const idx = (item1.name.length + item2.name.length) % emojis.length;
      expect(emojis[idx]).toBe('⚡'); // (5+4) % 7 = 2
    });
  });

  describe('Item dedup', () => {
    it('same name items should map to same ID', () => {
      const itemStore = new Map<string, number>();
      let nextId = 1;

      const ensureItem = (name: string): number => {
        if (itemStore.has(name)) return itemStore.get(name)!;
        const id = nextId++;
        itemStore.set(name, id);
        return id;
      };

      const id1 = ensureItem('Water');
      const id2 = ensureItem('Water');
      const id3 = ensureItem('Fire');

      expect(id1).toBe(id2);
      expect(id1).not.toBe(id3);
    });
  });
});
