import type { Tier, DwarfState } from '../shared/types';

/**
 * Local deterministic fallback when all AI models fail.
 * Mirrors the existing aiIdle() behavior from the client.
 */
export function localFallback(tier: Tier, context: any): any {
  const { dwarves } = context;
  if (!dwarves || !Array.isArray(dwarves)) return { decisions: [] };

  switch (tier) {
    case 'simple':
      return { decisions: simpleLocalDecisions(dwarves, context.resources) };
    case 'medium':
      return { decisions: [] }; // No social decisions without AI
    case 'complex':
      return { decisions: [] }; // No strategic decisions without AI
    case 'premium':
      return {
        decree: {
          text: 'The gods are silent today.',
          action: 'pray',
          urgency: 10,
        },
      };
    default:
      return { decisions: [] };
  }
}

function simpleLocalDecisions(
  dwarves: DwarfState[],
  resources: any
): { dwarfId: string; action: string; reason: string }[] {
  return dwarves.map((d) => {
    if (d.hunger < 30 && (resources?.food > 0)) {
      return { dwarfId: d.id, action: 'eat', reason: 'hungry' };
    }
    if (d.energy < 20) {
      return { dwarfId: d.id, action: 'sleep', reason: 'exhausted' };
    }
    if (d.happiness < 30) {
      return { dwarfId: d.id, action: 'rest', reason: 'unhappy, needs rest' };
    }

    // Productive work based on resource needs
    if (resources?.food < 20) {
      return { dwarfId: d.id, action: 'farm', reason: 'food reserves low' };
    }
    if (resources?.wood < 5) {
      return { dwarfId: d.id, action: 'chop', reason: 'wood needed' };
    }
    if (resources?.stone < 5) {
      return { dwarfId: d.id, action: 'mine', reason: 'stone needed' };
    }

    // Brew when food > ale
    if (resources?.food > 10 && (resources?.ale ?? 0) < 5) {
      return { dwarfId: d.id, action: 'brew', reason: 'brewing ale from surplus food' };
    }

    const roll = Math.random();
    if (roll < 0.3) return { dwarfId: d.id, action: 'explore', reason: 'curiosity' };
    if (roll < 0.5) return { dwarfId: d.id, action: 'mine', reason: 'keep busy' };
    if (roll < 0.7) return { dwarfId: d.id, action: 'farm', reason: 'tending crops' };
    return { dwarfId: d.id, action: 'wander', reason: 'taking a stroll' };
  });
}
