/** Roll 3d6: sum of three random dice (1-6 each) */
export function roll3d6(): number {
  return (
    Math.floor(Math.random() * 6) + 1 +
    Math.floor(Math.random() * 6) + 1 +
    Math.floor(Math.random() * 6) + 1
  );
}

export interface DwarfStats {
  STR: number;
  DEX: number;
  CON: number;
  INT: number;
  WIS: number;
  CHA: number;
  faith: number;
  morality: number;
  ambition: number;
}

/** Generate a full D&D stat block for a new dwarf */
export function generateDwarfStats(): DwarfStats {
  return {
    STR: roll3d6(),
    DEX: roll3d6(),
    CON: roll3d6(),
    INT: roll3d6(),
    WIS: roll3d6(),
    CHA: roll3d6(),
    faith: Math.floor(Math.random() * 101),    // 0-100
    morality: Math.floor(Math.random() * 101),  // 0-100
    ambition: Math.floor(Math.random() * 101),  // 0-100
  };
}

/**
 * Convert a D&D stat (3-18) to a multiplier (0.5-1.5).
 * 10-11 = 1.0 (average), 3 = 0.5, 18 = 1.5
 */
export function statModifier(stat: number): number {
  // Linear interpolation: 3 → 0.5, 10.5 → 1.0, 18 → 1.5
  return 0.5 + ((stat - 3) / 15);
}
