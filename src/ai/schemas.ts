import { z } from 'zod';
import { foodBasisSchema, foodRecordSchema, nutrientAggregateSchema, nutrientProfileSchema, nutrientUnknownCountsSchema, portionCertaintySchema, prepStateSchema, quantitySchema } from '../domain';

const number = z.number().finite().nonnegative();
const text = z.string().trim().min(1);
const index = z.int().nonnegative();
const gramsRange = z.strictObject({ min_g: number, max_g: number })
  .refine(range => range.min_g <= range.max_g, 'Invalid estimate range');
export const clarificationEffectSchema = z.strictObject({
  kind: z.enum(['none', 'add_food', 'scale_item', 'set_prep_state']),
  targetItemIndex: index.optional(), query: text.optional(), amount: number.optional(), unit: text.optional(),
  multiplier: number.optional(), prep_state: prepStateSchema.optional(),
}).superRefine((effect, ctx) => {
  const valid = effect.kind === 'none'
    || (effect.kind === 'add_food' && effect.query !== undefined && effect.amount !== undefined && effect.unit !== undefined)
    || (effect.kind === 'scale_item' && effect.targetItemIndex !== undefined && effect.multiplier !== undefined)
    || (effect.kind === 'set_prep_state' && effect.targetItemIndex !== undefined && effect.prep_state !== undefined);
  if (!valid) ctx.addIssue({ code: 'custom', message: 'Incomplete clarification effect' });
});
export const clarifyingQuestionSchema = z.strictObject({
  id: text, topic: z.enum(['cooking_fat', 'prep_state', 'portion', 'ingredient']), label: text,
  options: z.array(z.strictObject({ id: text, label: text, effect: clarificationEffectSchema })).min(1),
}).refine(q => new Set(q.options.map(o => o.id)).size === q.options.length, 'Duplicate option id');
export const mealExtractionSchema = z.strictObject({
  items: z.array(z.strictObject({
    query: text, display_name: text, prep_state: prepStateSchema, amount: number, unit: text,
    portion_certainty: portionCertaintySchema,
    estimate_range: gramsRange.nullish(),
    estimated_fallback_per_100g: z.strictObject({ kcal: number, protein_g: number, carbs_g: number, fat_g: number, fiber_g: number.nullable() }).nullish(),
    assumption_note: text.nullish(),
  })).min(1),
  clarifying_questions: z.array(clarifyingQuestionSchema).max(2),
}).superRefine((value, ctx) => {
  if (new Set(value.clarifying_questions.map(q => q.id)).size !== value.clarifying_questions.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate question id' });
  }
  for (const question of value.clarifying_questions) for (const option of question.options) {
    if (option.effect.targetItemIndex !== undefined && option.effect.targetItemIndex >= value.items.length) {
      ctx.addIssue({ code: 'custom', message: 'Invalid clarification target' });
    }
  }
});
export const disambiguationSchema = z.strictObject({
  selections: z.array(z.strictObject({ item_index: index, chosen_candidate_index: index.nullable() })),
}).refine(value => new Set(value.selections.map(s => s.item_index)).size === value.selections.length, 'Duplicate selection');
export const nutritionLabelExtractionSchema = z.strictObject({
  name: text.nullable(), brand: text.nullable(), basis: foodBasisSchema,
  serving_g: z.number().finite().positive().nullable(), serving_ml: z.number().finite().positive().nullable(),
  kcal: number, protein_g: number, carbs_g: number, fat_g: number,
  fiber_g: number.nullable(), sugar_g: number.nullable(), sat_fat_g: number.nullable(), sodium_mg: number.nullable(),
});
export const searchCandidateSchema = z.strictObject({
  food: foodRecordSchema, bucket: z.enum(['yours', 'database']), sourceLabel: text,
  packPriority: z.number().finite(), matchTier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  prepStateMatch: z.boolean(), withinPackRank: z.number().finite(), matchedAlias: z.string().nullable(),
});
export const mealDraftItemSchema = z.strictObject({
  food: foodRecordSchema, quantity: quantitySchema, nutrients: nutrientProfileSchema,
  unknownCount: nutrientUnknownCountsSchema, provenance_kind: z.enum(['database', 'user', 'ai_estimate']),
  portion_certainty: portionCertaintySchema,
  estimate_range: z.strictObject({ min_g: number, max_g: number, min_kcal: number, max_kcal: number })
    .refine(r => r.min_g <= r.max_g && r.min_kcal <= r.max_kcal, 'Invalid estimate range').nullable(),
  candidates: z.array(searchCandidateSchema), sourceLabel: text, assumption_note: z.string().nullable(),
});
export const mealDraftProposalSchema = z.strictObject({
  meal: text, items: z.array(mealDraftItemSchema).min(1), totals: nutrientAggregateSchema,
  clarifying_questions: z.array(clarifyingQuestionSchema).max(2),
  /** Frozen starting point lets chips be changed or re-applied without compounding effects. */
  base_items: z.array(mealDraftItemSchema).min(1),
  answers: z.record(z.string(), z.string()),
});
