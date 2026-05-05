export const POP_HARD_CAP = 300;
export const POP_SOFT_CAP = 240;
export const POP_MINIMUM = 3;

export function shouldAllowBirth(currentPop: number): boolean {
  if (currentPop >= POP_HARD_CAP) return false;
  if (currentPop >= POP_SOFT_CAP) {
    // Discourage births: only 20% chance
    return Math.random() < 0.2;
  }
  return true;
}

export function shouldSpawnReplacement(currentPop: number): boolean {
  return currentPop < POP_MINIMUM;
}

export function oldAgeDeathChance(ageYears: number): number {
  if (ageYears <= 80) return 0;
  return 0.02; // 2% per tick when over 80
}

export function starvationDeathChance(hunger: number): number {
  if (hunger > 0) return 0;
  return 0.10; // 10% per tick when starving
}
