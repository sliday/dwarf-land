import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, Output } from 'ai';
import type { Tier } from '../shared/types';
import { SimpleDecisionSchema, MediumDecisionSchema, ComplexDecisionSchema, PremiumDecisionSchema, BackstorySchema, CraftResultSchema } from './schemas';
import { buildPrompt } from './prompts';
import { localFallback } from './fallback';

interface ModelChain {
  models: string[];
  schema: any;
  maxTokens: number;
  // cost per million tokens [input, output]
  costPerM: [number, number][];
}

const TIER_CONFIG: Record<Tier, ModelChain> = {
  simple: {
    models: [
      'google/gemini-3.1-flash-lite-preview',
      'deepseek/deepseek-v3.2',
      'x-ai/grok-4.1-fast',
    ],
    schema: SimpleDecisionSchema,
    maxTokens: 200,
    costPerM: [[0.25, 1.50], [0.25, 0.40], [0.20, 0.50]],
  },
  medium: {
    models: [
      'google/gemini-3-flash-preview',
      'minimax/minimax-m2.5',
      'moonshotai/kimi-k2.5',
    ],
    schema: MediumDecisionSchema,
    maxTokens: 400,
    costPerM: [[0.50, 3.00], [0.30, 1.20], [0.45, 2.20]],
  },
  complex: {
    models: [
      'google/gemini-3.1-pro-preview',
      'anthropic/claude-haiku-4-5',
      'openai/gpt-5.4',
    ],
    schema: ComplexDecisionSchema,
    maxTokens: 600,
    costPerM: [[2.00, 12.00], [1.00, 5.00], [2.50, 15.00]],
  },
  premium: {
    models: [
      'anthropic/claude-sonnet-4-6',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'openai/gpt-5.4-pro',
    ],
    schema: PremiumDecisionSchema,
    maxTokens: 1500,
    costPerM: [[3.00, 15.00], [0, 0], [30.00, 180.00]],
  },
};

function estimateCostCents(
  tokensIn: number,
  tokensOut: number,
  costPerM: [number, number]
): number {
  return Math.ceil(
    (tokensIn * costPerM[0] + tokensOut * costPerM[1]) / 10000
  );
}

export interface DecisionResult {
  decisions: any;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
}

export async function routeDecision(
  tier: Tier,
  context: any,
  apiKey: string
): Promise<DecisionResult> {
  const config = TIER_CONFIG[tier];
  const openrouter = createOpenRouter({ apiKey });
  const prompt = buildPrompt(tier, context);

  for (let i = 0; i < config.models.length; i++) {
    const modelId = config.models[i];
    try {
      const result = await generateText({
        model: openrouter(modelId),
        output: Output.object({ schema: config.schema }),
        prompt,
        maxOutputTokens: config.maxTokens,
      });

      const tokensIn = result.usage?.inputTokens ?? 0;
      const tokensOut = result.usage?.outputTokens ?? 0;
      const costCents = estimateCostCents(tokensIn, tokensOut, config.costPerM[i]);

      return {
        decisions: result.output,
        model: modelId,
        tokensIn,
        tokensOut,
        costCents,
      };
    } catch (err: any) {
      console.error(`Model ${modelId} failed:`, err?.message || err);
      if (i === config.models.length - 1) {
        // All models failed, use local fallback
        console.log(`All models failed for ${tier}, using local fallback`);
        return {
          decisions: localFallback(tier, context),
          model: 'local-fallback',
          tokensIn: 0,
          tokensOut: 0,
          costCents: 0,
        };
      }
    }
  }

  // Should never reach here, but just in case
  return {
    decisions: localFallback(tier, context),
    model: 'local-fallback',
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
  };
}

// Backstory generation uses MEDIUM tier models
const BACKSTORY_MODELS = TIER_CONFIG.medium.models;
const BACKSTORY_COSTS = TIER_CONFIG.medium.costPerM;

export interface BackstoryResult {
  backstory: { name: string; backstory: string; traits: string[] };
  model: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
}

export async function generateBackstory(
  dwarfContext: { name: string; stats: Record<string, number>; faith: number; morality: number; ambition: number; cityName?: string },
  apiKey: string
): Promise<BackstoryResult> {
  const openrouter = createOpenRouter({ apiKey });

  const prompt = `You are a fantasy storyteller for a dwarf civilization game.
Generate a short backstory and personality traits for this dwarf.

DWARF: ${dwarfContext.name}
STATS: STR ${dwarfContext.stats.STR} DEX ${dwarfContext.stats.DEX} CON ${dwarfContext.stats.CON} INT ${dwarfContext.stats.INT} WIS ${dwarfContext.stats.WIS} CHA ${dwarfContext.stats.CHA}
SOUL: faith=${dwarfContext.faith} morality=${dwarfContext.morality} ambition=${dwarfContext.ambition}
${dwarfContext.cityName ? `HOME: ${dwarfContext.cityName}` : ''}

Return JSON with:
- name: a fitting dwarven full name (can keep or modify the given name)
- backstory: 2-3 sentences about their background, personality, and motivations
- traits: 1-3 personality trait words (e.g. "stubborn", "pious", "greedy")

Make the backstory reflect their stats (high STR = strong, low CHA = antisocial, etc).`;

  for (let i = 0; i < BACKSTORY_MODELS.length; i++) {
    const modelId = BACKSTORY_MODELS[i];
    try {
      const result = await generateText({
        model: openrouter(modelId),
        output: Output.object({ schema: BackstorySchema }),
        prompt,
        maxOutputTokens: 300,
      });

      const tokensIn = result.usage?.inputTokens ?? 0;
      const tokensOut = result.usage?.outputTokens ?? 0;
      const costCents = estimateCostCents(tokensIn, tokensOut, BACKSTORY_COSTS[i]);

      return {
        backstory: result.output as any,
        model: modelId,
        tokensIn,
        tokensOut,
        costCents,
      };
    } catch (err: any) {
      console.error(`Backstory model ${modelId} failed:`, err?.message || err);
      if (i === BACKSTORY_MODELS.length - 1) {
        // Fallback: generate a simple backstory locally
        return {
          backstory: {
            name: dwarfContext.name,
            backstory: `${dwarfContext.name} is a hardworking dwarf who arrived seeking fortune and glory.`,
            traits: [dwarfContext.stats.STR >= 14 ? 'strong' : 'resourceful'],
          },
          model: 'local-fallback',
          tokensIn: 0,
          tokensOut: 0,
          costCents: 0,
        };
      }
    }
  }

  return {
    backstory: { name: dwarfContext.name, backstory: 'A mysterious dwarf with an unknown past.', traits: ['enigmatic'] },
    model: 'local-fallback',
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
  };
}

// Craft combination — uses SIMPLE tier (cheapest)
const CRAFT_MODELS = TIER_CONFIG.simple.models;
const CRAFT_COSTS = TIER_CONFIG.simple.costPerM;

export interface CraftAIResult {
  emoji: string;
  name: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
}

export async function generateCraftResult(
  item1: { emoji: string; name: string },
  item2: { emoji: string; name: string },
  apiKey: string
): Promise<CraftAIResult> {
  const openrouter = createOpenRouter({ apiKey });

  const prompt = `Combine these two things into one new thing.
${item1.emoji} ${item1.name} + ${item2.emoji} ${item2.name} = ?
Reply with ONLY a JSON object: {"emoji": "...", "name": "..."}
Example: {"emoji": "💨", "name": "Steam"} for Water + Fire`;

  for (let i = 0; i < CRAFT_MODELS.length; i++) {
    const modelId = CRAFT_MODELS[i];
    try {
      const result = await generateText({
        model: openrouter(modelId),
        output: Output.object({ schema: CraftResultSchema }),
        prompt,
        maxOutputTokens: 50,
      });

      const tokensIn = result.usage?.inputTokens ?? 0;
      const tokensOut = result.usage?.outputTokens ?? 0;
      const costCents = estimateCostCents(tokensIn, tokensOut, CRAFT_COSTS[i]);

      const output = result.output as { emoji: string; name: string };
      return {
        emoji: output.emoji,
        name: output.name,
        model: modelId,
        tokensIn,
        tokensOut,
        costCents,
      };
    } catch (err: any) {
      console.error(`Craft model ${modelId} failed:`, err?.message || err);
      if (i === CRAFT_MODELS.length - 1) {
        // Deterministic fallback: combine first halves of names
        const emojis = ['✨', '🔮', '⚡', '🌀', '💫', '🎯', '🪄'];
        const half1 = item1.name.slice(0, Math.ceil(item1.name.length / 2));
        const half2 = item2.name.slice(Math.floor(item2.name.length / 2));
        const fallbackEmoji = emojis[(item1.name.length + item2.name.length) % emojis.length];
        return {
          emoji: fallbackEmoji,
          name: (half1 + half2).slice(0, 50),
          model: 'local-fallback',
          tokensIn: 0,
          tokensOut: 0,
          costCents: 0,
        };
      }
    }
  }

  return {
    emoji: '❓',
    name: `${item1.name}-${item2.name}`.slice(0, 50),
    model: 'local-fallback',
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
  };
}
