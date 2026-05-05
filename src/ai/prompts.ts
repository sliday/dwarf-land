import type { Tier, DwarfState } from '../shared/types';
import { SIMPLE_ACTIONS, MEDIUM_ACTIONS, COMPLEX_ACTIONS, ACTION_IDS } from '../shared/actions';

function formatDwarf(d: DwarfState): string {
  return `${d.id}|${d.name}|hunger:${Math.round(d.hunger)}|energy:${Math.round(d.energy)}|happy:${Math.round(d.happiness)}|state:${d.state}`;
}

function formatDwarfDetailed(d: DwarfState): string {
  const stats = d.stats
    ? `STR:${d.stats.STR} DEX:${d.stats.DEX} CON:${d.stats.CON} INT:${d.stats.INT} WIS:${d.stats.WIS} CHA:${d.stats.CHA}`
    : 'no stats';
  const traits = d.traits?.join(', ') || 'none';
  const recentEvents = d.eventLog?.slice(-5).map(e => e.description).join('; ') || 'none';
  return `${d.id}|${d.name}|${stats}|faith:${d.faith ?? 0}|hunger:${Math.round(d.hunger)}|energy:${Math.round(d.energy)}|happy:${Math.round(d.happiness)}|traits:[${traits}]|recent:[${recentEvents}]`;
}

export function buildPrompt(tier: Tier, context: any): string {
  const { dwarves, resources, season, year, cityName, culture } = context;

  switch (tier) {
    case 'simple':
      return buildSimplePrompt(dwarves, resources, season, year, cityName, culture);
    case 'medium':
      return buildMediumPrompt(dwarves, resources, season, year, cityName, culture);
    case 'complex':
      return buildComplexPrompt(dwarves, resources, season, year, cityName, culture);
    case 'premium':
      return buildPremiumPrompt(dwarves, resources, season, year, cityName, culture);
    default:
      return '';
  }
}

function buildSimplePrompt(
  dwarves: DwarfState[],
  resources: any,
  season: string,
  year: number,
  cityName?: string,
  culture?: string
): string {
  const dwarfList = dwarves.map(formatDwarf).join('\n');
  const actions = SIMPLE_ACTIONS.join(', ');

  return `You are an AI deciding daily actions for dwarves in a colony simulation.
${cityName ? `CITY: ${cityName}${culture ? ` (${culture} culture)` : ''}` : ''}
RESOURCES: food=${resources.food}, wood=${resources.wood}, stone=${resources.stone}, iron=${resources.iron ?? 0}, gold=${resources.gold ?? 0}, ale=${resources.ale ?? 0}, herbs=${resources.herbs ?? 0}
SEASON: ${season}, YEAR: ${year}

DWARVES (id|name|hunger|energy|happiness|currentState):
${dwarfList}

AVAILABLE ACTIONS: ${actions}

Rules:
- If hunger < 30, pick "eat"
- If energy < 20, pick "sleep"
- Otherwise pick productive work: mine, farm, chop, build, craft, cook
- If home city has surplus food/wood and the dwarf is well-fed and rested, "travel" to another city for trade or exploration (uses cart/car/train/ship depending on connection)
- If nothing urgent, "wander" or "explore"
- Keep reasons under 80 chars

Return a decision for EACH dwarf. JSON only.`;
}

function buildMediumPrompt(
  dwarves: DwarfState[],
  resources: any,
  season: string,
  year: number,
  cityName?: string,
  culture?: string
): string {
  const dwarfList = dwarves.map(formatDwarfDetailed).join('\n');
  const actions = MEDIUM_ACTIONS.join(', ');

  return `You are an AI managing social dynamics in a dwarf colony simulation.
${cityName ? `CITY: ${cityName}${culture ? ` (${culture} culture)` : ''}` : ''}
RESOURCES: food=${resources.food}, wood=${resources.wood}, stone=${resources.stone}, iron=${resources.iron ?? 0}
SEASON: ${season}, YEAR: ${year}
POPULATION: ${dwarves.length}

DWARVES (detailed):
${dwarfList}

AVAILABLE SOCIAL ACTIONS: ${actions}

Rules:
- Dwarves with high CHA should talk, befriend, or persuade others
- Lonely dwarves (few relationships) should befriend
- Dwarves with high happiness + CHA may court
- If population is low and conditions good, courtship is encouraged
- Provide targetDwarfId for social actions (pick someone nearby or with existing relationship)
- Only return decisions for dwarves who should do social actions NOW (not all)

Return social decisions. JSON only.`;
}

function buildComplexPrompt(
  dwarves: DwarfState[],
  resources: any,
  season: string,
  year: number,
  cityName?: string,
  culture?: string
): string {
  const dwarfList = dwarves.map(formatDwarfDetailed).join('\n');
  const actions = [...COMPLEX_ACTIONS, ...MEDIUM_ACTIONS].join(', ');

  return `You are a strategic AI advisor for a dwarf colony simulation. Make high-level decisions about combat, governance, and alliances.
${cityName ? `CITY: ${cityName}${culture ? ` (${culture} culture)` : ''}` : ''}
RESOURCES: food=${resources.food}, wood=${resources.wood}, stone=${resources.stone}, iron=${resources.iron ?? 0}, gold=${resources.gold ?? 0}
SEASON: ${season}, YEAR: ${year}
POPULATION: ${dwarves.length}

DWARVES (detailed):
${dwarfList}

AVAILABLE STRATEGIC ACTIONS: ${actions}

Consider:
- Are there threats? Should dwarves defend or flee?
- Should someone with high CHA propose new governance?
- Are resources scarce enough to steal or trade?
- Should any dwarves migrate to a new city?
- Only return decisions for dwarves who need strategic action NOW

Return strategic decisions. JSON only.`;
}

function buildPremiumPrompt(
  dwarves: DwarfState[],
  resources: any,
  season: string,
  year: number,
  cityName?: string,
  culture?: string
): string {
  const dwarfList = dwarves.map(formatDwarfDetailed).join('\n');
  const actions = ACTION_IDS.join(', ');

  return `You are a premium strategic AI for a live dwarf colony simulation. Return executable per-dwarf intents, not narration.
${cityName ? `CITY: ${cityName}${culture ? ` (${culture} culture)` : ''}` : ''}
RESOURCES: food=${resources.food}, wood=${resources.wood}, stone=${resources.stone}, iron=${resources.iron ?? 0}, gold=${resources.gold ?? 0}, ale=${resources.ale ?? 0}, herbs=${resources.herbs ?? 0}
SEASON: ${season}, YEAR: ${year}
POPULATION: ${dwarves.length}

DWARVES (detailed):
${dwarfList}

AVAILABLE ACTIONS: ${actions}

Rules:
- Return decisions only for dwarves who need an action now
- Prefer colony survival before social or spiritual goals
- Use targetDwarfId for social, combat, rescue, or care actions
- Use params for concrete targets such as coordinates or resource names
- Keep reasons under 240 chars

Return per-dwarf decisions. JSON only.`;
}

export function buildPremiumDecreePrompt(context: any): string {
  const { religion, dwarves, resources, season, year, worldEvents } = context;

  if (!religion) return 'No religion context provided.';

  const followerCount = dwarves?.filter((d: DwarfState) =>
    d.faith && d.faith > 30
  ).length ?? 0;

  return `You are ${religion.deity}, divine being of the religion "${religion.name}".

YOUR TENETS: ${religion.tenets.join('; ')}
YOUR CENTURY PLAN: ${religion.centuryPlan.purpose}
CURRENT PHASE: ${JSON.stringify(religion.centuryPlan.phases[0])}
PROPHECY: ${religion.centuryPlan.prophecy}

WORLD STATE:
- Season: ${season}, Year: ${year}
- Followers: ${followerCount}
- Colony resources: food=${resources?.food ?? '?'}, stone=${resources?.stone ?? '?'}
${worldEvents ? `- Recent events: ${worldEvents}` : ''}

As a deity, issue a divine decree for your followers. Speak dramatically and in character.
The decree must map to one of these actions: eat, sleep, mine, build, farm, craft, pray, preach, convert, sacrifice, pilgrimage, build_shrine, attack, defend, explore, trade.

Your decree should advance your century plan while considering the colony's current state.

Return your decree. JSON only.`;
}
