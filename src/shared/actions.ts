export const ACTIONS = {
  // Survival
  eat: { category: 'survival', keyStat: 'CON', durationTicks: 5 },
  drink: { category: 'survival', keyStat: 'CON', durationTicks: 3 },
  sleep: { category: 'survival', keyStat: 'CON', durationTicks: 40 },
  rest: { category: 'survival', keyStat: 'CON', durationTicks: 15 },
  heal: { category: 'survival', keyStat: 'CON', durationTicks: 20 },

  // Work
  mine: { category: 'work', keyStat: 'STR', durationTicks: 8 },
  build: { category: 'work', keyStat: 'STR', durationTicks: 10 },
  farm: { category: 'work', keyStat: 'WIS', durationTicks: 12 },
  craft: { category: 'work', keyStat: 'DEX', durationTicks: 15 },
  cook: { category: 'work', keyStat: 'DEX', durationTicks: 8 },
  brew: { category: 'work', keyStat: 'INT', durationTicks: 10 },
  haul: { category: 'work', keyStat: 'STR', durationTicks: 6 },
  chop: { category: 'work', keyStat: 'STR', durationTicks: 8 },

  // Social
  talk: { category: 'social', keyStat: 'CHA', durationTicks: 5 },
  persuade: { category: 'social', keyStat: 'CHA', durationTicks: 8 },
  threaten: { category: 'social', keyStat: 'STR', durationTicks: 3 },
  trade: { category: 'social', keyStat: 'CHA', durationTicks: 10 },
  befriend: { category: 'social', keyStat: 'CHA', durationTicks: 8 },
  gossip: { category: 'social', keyStat: 'CHA', durationTicks: 5 },
  teach: { category: 'social', keyStat: 'INT', durationTicks: 15 },
  learn: { category: 'social', keyStat: 'INT', durationTicks: 15 },

  // Combat
  attack: { category: 'combat', keyStat: 'STR', durationTicks: 5 },
  defend: { category: 'combat', keyStat: 'CON', durationTicks: 5 },
  flee: { category: 'combat', keyStat: 'DEX', durationTicks: 3 },
  steal: { category: 'combat', keyStat: 'DEX', durationTicks: 6 },
  ambush: { category: 'combat', keyStat: 'DEX', durationTicks: 8 },

  // Religion
  pray: { category: 'religion', keyStat: 'WIS', durationTicks: 10 },
  preach: { category: 'religion', keyStat: 'CHA', durationTicks: 12 },
  convert: { category: 'religion', keyStat: 'CHA', durationTicks: 15 },
  sacrifice: { category: 'religion', keyStat: 'WIS', durationTicks: 8 },
  pilgrimage: { category: 'religion', keyStat: 'CON', durationTicks: 50 },
  build_shrine: { category: 'religion', keyStat: 'STR', durationTicks: 20 },

  // Reproduction
  court: { category: 'reproduction', keyStat: 'CHA', durationTicks: 10 },
  mate: { category: 'reproduction', keyStat: 'CHA', durationTicks: 5 },
  nurture: { category: 'reproduction', keyStat: 'WIS', durationTicks: 15 },

  // Animal
  tame: { category: 'animal', keyStat: 'WIS', durationTicks: 15 },
  feed_pet: { category: 'animal', keyStat: 'WIS', durationTicks: 5 },
  milk: { category: 'animal', keyStat: 'DEX', durationTicks: 6 },
  shear: { category: 'animal', keyStat: 'DEX', durationTicks: 8 },

  // Governance
  propose: { category: 'governance', keyStat: 'CHA', durationTicks: 10 },
  vote: { category: 'governance', keyStat: 'INT', durationTicks: 3 },
  decree: { category: 'governance', keyStat: 'CHA', durationTicks: 5 },
  rebel: { category: 'governance', keyStat: 'STR', durationTicks: 15 },

  // Movement
  walk: { category: 'movement', keyStat: 'CON', durationTicks: 1 },
  explore: { category: 'movement', keyStat: 'CON', durationTicks: 20 },
  migrate: { category: 'movement', keyStat: 'CON', durationTicks: 50 },

  // Idle
  wander: { category: 'idle', keyStat: 'CON', durationTicks: 10 },
} as const;

export type ActionId = keyof typeof ACTIONS;

export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];

// Simple tier actions (daily survival/work)
export const SIMPLE_ACTIONS: ActionId[] = [
  'eat', 'drink', 'sleep', 'rest', 'mine', 'build', 'farm', 'craft',
  'cook', 'brew', 'haul', 'chop', 'pray', 'wander', 'walk', 'explore',
];

// Medium tier actions (social)
export const MEDIUM_ACTIONS: ActionId[] = [
  'talk', 'persuade', 'trade', 'befriend', 'gossip', 'teach', 'learn',
  'court', 'mate', 'nurture', 'tame', 'feed_pet',
];

// Complex tier actions (strategic)
export const COMPLEX_ACTIONS: ActionId[] = [
  'attack', 'defend', 'flee', 'steal', 'ambush', 'threaten',
  'propose', 'vote', 'decree', 'rebel', 'migrate',
];

// Premium tier actions (divine/religious)
export const PREMIUM_ACTIONS: ActionId[] = [
  'preach', 'convert', 'sacrifice', 'pilgrimage', 'build_shrine',
];
