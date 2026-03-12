import { z } from 'zod';
import { SIMPLE_ACTIONS, MEDIUM_ACTIONS, COMPLEX_ACTIONS, ACTION_IDS } from '../shared/actions';

// Zod v4: z.enum accepts readonly string[] directly
const actionEnum = z.enum(ACTION_IDS);
const simpleActionEnum = z.enum(SIMPLE_ACTIONS);
const mediumActionEnum = z.enum(MEDIUM_ACTIONS);
const complexMediumActions = [...COMPLEX_ACTIONS, ...MEDIUM_ACTIONS] as const;
const complexActionEnum = z.enum([...COMPLEX_ACTIONS, ...MEDIUM_ACTIONS]);

// SIMPLE tier: batch survival/work decisions for all dwarves
export const SimpleDecisionSchema = z.object({
  decisions: z.array(
    z.object({
      dwarfId: z.string(),
      action: simpleActionEnum,
      reason: z.string().max(80),
    })
  ),
});
export type SimpleDecision = z.infer<typeof SimpleDecisionSchema>;

// MEDIUM tier: social decisions
export const MediumDecisionSchema = z.object({
  decisions: z.array(
    z.object({
      dwarfId: z.string(),
      action: mediumActionEnum,
      targetDwarfId: z.string().optional(),
      reason: z.string().max(120),
    })
  ),
});
export type MediumDecision = z.infer<typeof MediumDecisionSchema>;

// COMPLEX tier: strategic decisions
export const ComplexDecisionSchema = z.object({
  decisions: z.array(
    z.object({
      dwarfId: z.string(),
      action: complexActionEnum,
      targetDwarfId: z.string().optional(),
      params: z.record(z.string(), z.unknown()).optional(),
      reason: z.string().max(200),
    })
  ),
});
export type ComplexDecision = z.infer<typeof ComplexDecisionSchema>;

// PREMIUM tier: god decrees
export const PremiumDecisionSchema = z.object({
  decree: z.object({
    text: z.string().max(300),
    action: actionEnum,
    urgency: z.number().min(0).max(100),
  }),
  divineMessage: z.string().max(200).optional(),
  prophecy: z.string().max(200).optional(),
});
export type PremiumDecision = z.infer<typeof PremiumDecisionSchema>;

// Backstory generation
export const BackstorySchema = z.object({
  name: z.string(),
  backstory: z.string().max(300),
  traits: z.array(z.string()).min(1).max(3),
});
export type BackstoryOutput = z.infer<typeof BackstorySchema>;

// Craft result from AI
export const CraftResultSchema = z.object({
  emoji: z.string(),
  name: z.string().max(50),
});
export type CraftResult = z.infer<typeof CraftResultSchema>;

// Religion generation
export const ReligionSchema = z.object({
  name: z.string(),
  deity: z.string(),
  tenets: z.array(z.string()).min(2).max(5),
  centuryPlan: z.object({
    purpose: z.string(),
    phases: z.array(
      z.object({
        yearRange: z.tuple([z.number(), z.number()]),
        goal: z.string(),
        priority: z.string(),
      })
    ).min(2).max(4),
    prophecy: z.string(),
  }),
});
export type ReligionOutput = z.infer<typeof ReligionSchema>;
