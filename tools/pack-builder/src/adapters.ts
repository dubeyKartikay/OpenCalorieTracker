import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { readCsv } from './csv.ts';
import { FOOD_COLUMNS, OPTIONAL_NUTRIENTS, REQUIRED_NUTRIENTS, metaSchema } from './model.ts';
import type { Dataset, FoodInput, PackMetaInput } from './model.ts';

export async function readMeta(path: string): Promise<PackMetaInput> {
  return metaSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

export async function jsonDataset(path: string, meta?: PackMetaInput): Promise<Dataset> {
  const input: unknown = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  if (Array.isArray(input)) {
    if (!meta) throw new Error('A JSON food array requires --meta');
    return { meta, foods: input, warnings: [] };
  }
  const document = z.object({
    pack_meta: metaSchema.optional(),
    meta: metaSchema.optional(),
    foods: z.array(z.unknown()),
  }).strict().refine(
    doc => Boolean(doc.pack_meta) !== Boolean(doc.meta),
    { message: 'JSON dataset must provide either "pack_meta" or "meta" (not both)' },
  ).parse(input);
  const resolvedMeta = meta ?? document.pack_meta ?? document.meta!;
  return { meta: resolvedMeta, foods: document.foods as FoodInput[], warnings: [] };
}

const numericColumns = new Set<string>([
  ...REQUIRED_NUTRIENTS, ...OPTIONAL_NUTRIENTS, 'serving_g', 'serving_ml', 'quality_score',
]);

export function csvDataset(path: string, meta: PackMetaInput): Dataset {
  async function* foods(): AsyncGenerator<FoodInput> {
    for await (const row of readCsv(path, ['id', 'name', 'prep_state', 'basis', ...REQUIRED_NUTRIENTS])) {
      const food: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (!([...FOOD_COLUMNS, 'aliases', 'units', 'barcodes'] as string[]).includes(key)) {
          throw new Error(`Unknown custom CSV column: ${key}`);
        }
        if (['aliases', 'units', 'barcodes'].includes(key)) {
          food[key] = value.trim() ? JSON.parse(value) : [];
        } else if (numericColumns.has(key)) {
          if (!value.trim()) food[key] = null;
          else if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) {
            throw new Error(`Food ${row.id}: ${key} is not a decimal number`);
          } else food[key] = Number(value);
        } else food[key] = value.trim() || null;
      }
      yield food as FoodInput;
    }
  }
  return { meta, foods: foods(), warnings: [] };
}

export function detectPrepState(description: string): FoodInput['prep_state'] {
  if (/\b(uncooked|raw)\b/i.test(description)) return 'raw';
  if (/\b(cooked|boiled|baked|roasted|fried|grilled|steamed|stewed|braised|broiled)\b/i.test(description)) return 'cooked';
  if (/\b(prepared|ready.to.eat|ready.to.serve)\b/i.test(description)) return 'prepared';
  return 'unknown';
}

const nutrientMap: Record<string, string> = {
  '1008': 'kcal', '1003': 'protein_g', '1005': 'carbs_g', '1004': 'fat_g',
  '1079': 'fiber_g', '2000': 'sugar_g', '1258': 'sat_fat_g', '1093': 'sodium_mg',
  '1087': 'calcium_mg', '1089': 'iron_mg', '1092': 'potassium_mg',
  '2047': 'energy_general', '2048': 'energy_specific',
};

function sourceNumber(value: string | undefined, context: string): number | null {
  if (value === undefined || !value.trim()) return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${context}: invalid non-negative number '${value}'`);
  return result;
}

/** Only Foundation and SR Legacy foods; source nutrients are per 100 g. */
export function usdaDataset(directory: string, metadata: Partial<PackMetaInput> = {}): Dataset {
  const warnings: string[] = [];
  const meta: PackMetaInput = {
    pack_id: 'usda-fdc', name: 'USDA FoodData Central (Foundation / SR Legacy)',
    version: new Date().toISOString().slice(0, 10), region: 'US', ...metadata,
    kind: 'reference', license: 'CC0-1.0',
    attribution_text: 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. Foundation Foods and SR Legacy.',
    attribution_url: 'https://fdc.nal.usda.gov/',
  };
  async function* foods(): AsyncGenerator<FoodInput> {
    const records = new Map<string, { food: FoodInput; nutrients: Record<string, number> }>();
    for await (const row of readCsv(join(directory, 'food.csv'), ['fdc_id', 'data_type', 'description'])) {
      if (!['foundation_food', 'sr_legacy_food'].includes(row.data_type!)) continue;
      if (!row.fdc_id?.trim()) throw new Error('USDA food.csv contains a blank fdc_id');
      if (records.has(row.fdc_id)) throw new Error(`Duplicate USDA fdc_id: ${row.fdc_id}`);
      records.set(row.fdc_id, {
        food: {
          id: `fdc:${row.fdc_id}`, name: row.description!, category: row.food_category_id?.trim() || null,
          prep_state: detectPrepState(row.description!), basis: 'per_100g',
          // Set required nutrients only after the source nutrient join below.
          kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, units: [],
        },
        nutrients: {},
      });
    }
    for await (const row of readCsv(join(directory, 'food_nutrient.csv'), ['fdc_id', 'nutrient_id', 'amount'])) {
      const record = records.get(row.fdc_id!);
      const key = nutrientMap[row.nutrient_id!];
      if (!record || !key) continue;
      const value = sourceNumber(row.amount, `USDA ${row.fdc_id} nutrient ${row.nutrient_id}`);
      if (value === null) continue;
      if (record.nutrients[key] !== undefined && record.nutrients[key] !== value) {
        throw new Error(`Conflicting USDA nutrient ${row.nutrient_id} for food ${row.fdc_id}`);
      }
      record.nutrients[key] = value;
    }
    const measures = new Map<string, string>();
    for await (const row of readCsv(join(directory, 'measure_unit.csv'), ['id', 'name'])) {
      measures.set(row.id!, row.name!);
    }
    let skippedPortions = 0;
    for await (const row of readCsv(join(directory, 'food_portion.csv'), ['fdc_id', 'amount', 'measure_unit_id', 'gram_weight'])) {
      const record = records.get(row.fdc_id!);
      if (!record) continue;
      const grams = sourceNumber(row.gram_weight, `USDA portion ${row.id ?? ''}`);
      const amount = sourceNumber(row.amount, `USDA portion ${row.id ?? ''} amount`);
      if (grams === null || grams === 0) { skippedPortions++; continue; }
      const measure = measures.get(row.measure_unit_id!);
      const meaningfulMeasure = measure && !/^(undetermined|unknown|not specified)$/i.test(measure) ? measure : '';
      const label = row.portion_description?.trim() || [
        amount !== null ? String(amount) : '', meaningfulMeasure, row.modifier?.trim(),
      ].filter(Boolean).join(' ');
      if (!label) { skippedPortions++; continue; }
      record.food.units!.push({ label, grams });
    }
    let incomplete = 0;
    for (const { food, nutrients } of records.values()) {
      // Preserve source Energy first, then specific Atwater, then general Atwater.
      const kcal = nutrients.kcal ?? nutrients.energy_specific ?? nutrients.energy_general;
      if (kcal === undefined || REQUIRED_NUTRIENTS.slice(1).some(key => nutrients[key] === undefined)) {
        incomplete++; continue;
      }
      yield {
        ...food, kcal, protein_g: nutrients.protein_g!, carbs_g: nutrients.carbs_g!, fat_g: nutrients.fat_g!,
        ...Object.fromEntries(OPTIONAL_NUTRIENTS.map(key => [key, nutrients[key] ?? null])),
      };
    }
    if (incomplete) warnings.push(`Skipped ${incomplete} USDA foods missing energy or a required macronutrient; no values were invented.`);
    if (skippedPortions) warnings.push(`Skipped ${skippedPortions} USDA portions without a positive weight or usable label.`);
  }
  return { meta, foods: foods(), warnings };
}
