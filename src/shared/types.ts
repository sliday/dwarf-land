export interface Env {
  DB: D1Database;
  OPENROUTER_API_KEY: string;
  POLAR_ACCESS_TOKEN: string;
  POLAR_WEBHOOK_SECRET: string;
  STATE_WRITE_TOKEN?: string;
}

export type Tier = 'simple' | 'medium' | 'complex' | 'premium';

export interface ResourcePool {
  stone: number; wood: number; food: number;
  iron: number; gold: number; cloth: number;
  ale: number; herbs: number; beds: number; tables: number;
}

export interface CityState {
  id: string;
  name: string;
  culture: string;
  res: ResourcePool;
}

export interface DwarfState {
  id: string;
  name: string;
  x: number;
  y: number;
  cityId: string;
  hunger: number;
  energy: number;
  happiness: number;
  state: string;
  color: string;
  stats?: { STR: number; DEX: number; CON: number; INT: number; WIS: number; CHA: number };
  faith?: number;
  morality?: number;
  ambition?: number;
  traits?: string[];
  backstory?: string;
  age?: number;
  timer?: number;
  carrying?: number;
  carryItems?: Record<string, number>;
  inventory?: Array<{ emoji: string; name: string }>;
  hp?: number;
  maxHp?: number;
  ac?: number;
  poisonTicks?: number;
  pet?: string | null;
  sex?: 'M' | 'F';
  travelMode?: 'walk' | 'cart' | 'car' | 'train' | 'ship' | null;
  sponsored?: boolean;
  sponsorTier?: string | null;
  sponsorCallsRemaining?: number;
  starveTicks?: number;
  eventLog?: EventLogEntry[];
  relationships?: Relationship[];
}

export interface EventLogEntry {
  tick: number;
  type: string;
  description: string;
  relatedDwarfId?: string;
}

export interface Relationship {
  targetId: string;
  type: 'friend' | 'rival' | 'lover' | 'spouse' | 'parent' | 'child' | 'enemy';
  strength: number; // -100..100
}

export interface GameState {
  tick: number;
  year: number;
  season: number;
  speed: number;
  cityResources?: Record<string, ResourcePool>;
  dwarves: DwarfState[];
  animals?: Array<Record<string, unknown>>;
  stats: { mined: number; built: number; farmed: number };
  homeCity: { name: string; mx: number; my: number } | null;
  mapDeltas?: Record<string, number>;
  graves?: Record<string, unknown>;
  yearResolutions?: Array<Record<string, unknown>>;
  suburbs?: Array<Record<string, unknown>>;
  dirtTiles?: Array<Record<string, unknown>>;
  religions?: Religion[];
}

export interface Religion {
  id: string;
  name: string;
  cityId: string;
  deity: string;
  tenets: string[];
  centuryPlan: {
    purpose: string;
    phases: { yearRange: [number, number]; goal: string; priority: string }[];
    prophecy: string;
  };
  currentDecree: {
    text: string;
    action: string;
    urgency: number;
    expiresAtTick: number;
  } | null;
}

export interface AIIntent {
  dwarfId: string;
  action: string;
  targetDwarfId?: string;
  params?: Record<string, unknown>;
  reason: string;
  tier: Tier;
  timestamp: number;
}

export interface BudgetStatus {
  tier: Tier;
  hour: string;
  calls: number;
  costCents: number;
  maxCentsPerHour: number;
  remaining: number;
}
