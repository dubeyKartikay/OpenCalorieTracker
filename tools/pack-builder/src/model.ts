import { z } from 'zod';

const text = z.string().trim().min(1);
const number = z.number().finite().nonnegative();
const positive = z.number().finite().positive();
const optionalNumber = number.nullish().transform(value => value ?? null);
const optionalText = text.nullish().transform(value => value ?? null);

export const OPTIONAL_NUTRIENTS = [
  'fiber_g', 'sugar_g', 'sat_fat_g', 'sodium_mg', 'calcium_mg', 'iron_mg', 'potassium_mg',
] as const;
export const REQUIRED_NUTRIENTS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const;
export const FOOD_COLUMNS = [
  'id', 'name', 'brand', 'category', 'prep_state', 'basis', 'serving_g', 'serving_ml',
  ...REQUIRED_NUTRIENTS, ...OPTIONAL_NUTRIENTS, 'quality_score',
] as const;

export const metaSchema = z.object({
  pack_id: text,
  name: text,
  version: text,
  kind: z.enum(['reference', 'branded', 'regional', 'custom']),
  region: optionalText,
  license: text,
  attribution_text: text,
  attribution_url: z.url().nullish().transform(value => value ?? null),
}).strict();

export const aliasSchema = z.object({ alias: text, lang: optionalText }).strict();
export const unitSchema = z.object({
  label: text,
  grams: positive.nullish().transform(value => value ?? null),
  ml: positive.nullish().transform(value => value ?? null),
}).strict().refine(value => value.grams !== null || value.ml !== null, {
  message: 'A food unit must provide grams or ml',
});
export const barcodeSchema = z.object({ raw_code: text, symbology: text }).strict();
export const foodSchema = z.object({
  id: text,
  name: text,
  brand: optionalText,
  category: optionalText,
  prep_state: z.enum(['raw', 'cooked', 'prepared', 'unknown']),
  basis: z.enum(['per_100g', 'per_100ml', 'per_serving']),
  serving_g: positive.nullish().transform(value => value ?? null),
  serving_ml: positive.nullish().transform(value => value ?? null),
  kcal: number,
  protein_g: number,
  carbs_g: number,
  fat_g: number,
  fiber_g: optionalNumber,
  sugar_g: optionalNumber,
  sat_fat_g: optionalNumber,
  sodium_mg: optionalNumber,
  calcium_mg: optionalNumber,
  iron_mg: optionalNumber,
  potassium_mg: optionalNumber,
  quality_score: optionalNumber,
  aliases: z.array(aliasSchema).default([]),
  units: z.array(unitSchema).default([]),
  barcodes: z.array(barcodeSchema).default([]),
}).strict();

export type PackMetaInput = z.input<typeof metaSchema>;
export type PackMeta = z.output<typeof metaSchema>;
export type FoodInput = z.input<typeof foodSchema>;
export type Food = z.output<typeof foodSchema>;

export interface Dataset {
  meta: PackMetaInput;
  foods: AsyncIterable<FoodInput> | Iterable<FoodInput>;
  warnings: string[];
}
