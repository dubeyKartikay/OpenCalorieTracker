import { foodRecordSchema } from '../domain';
import type { FoodBasis, NormalizedBarcode } from '../domain';
import type { OffProduct } from './types';

export type OffLookupErrorKind = 'network' | 'timeout' | 'http' | 'invalid_product';
export class OffLookupError extends Error {
  constructor(readonly kind: OffLookupErrorKind, message: string, readonly status: number | null = null) {
    super(message); this.name = 'OffLookupError';
  }
}
export interface OffLookupOptions { fetchImpl?: typeof fetch; timeoutMs?: number; userAgent?: string }
export const OFF_USER_AGENT = 'OpenCalorieTracker/0.1 (https://github.com/dubeyKartikay/OpenCalorieTracker)';
const fields = 'code,product_name,brands,quantity,serving_size,serving_quantity,nutriments,nutrition_data_per';
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function number(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function mapProduct(value: unknown, normalized: NormalizedBarcode): OffProduct {
  const product = object(value);
  const nutriments = object(product.nutriments);
  const declaration = text(product.nutrition_data_per)?.toLowerCase().replace(/\s/g, '') ?? '';
  // OFF uses the _100g suffix for both mass and volume products. Explicit declarations
  // always take precedence; package volume is only a fallback when nutrition_data_per is absent.
  const explicitMass = /(?:^|[^a-z])100g\b/.test(declaration);
  const explicitVolume = /(?:^|[^a-z])100ml\b/.test(declaration);
  const volume = explicitVolume
    || (!explicitMass && !declaration.includes('serving') && /\b\d+(?:[.,]\d+)?\s*(?:ml|cl|l)\b/i.test(text(product.quantity) ?? ''));
  const hasServing = ['energy-kcal', 'energy-kj', 'energy', 'proteins', 'carbohydrates', 'fat'].some((key) => number(nutriments[`${key}_serving`]) !== null);
  const hasHundred = ['energy-kcal', 'energy-kj', 'energy', 'proteins', 'carbohydrates', 'fat'].some((key) => number(nutriments[`${key}_100g`]) !== null);
  const perServing = (declaration.includes('serving') && hasServing) || (!hasHundred && hasServing);
  const basis: FoodBasis = perServing ? 'per_serving' : volume ? 'per_100ml' : 'per_100g';
  const suffix = perServing ? 'serving' : '100g';
  const nutrient = (name: string) => number(nutriments[`${name}_${suffix}`]);
  const kcal = nutrient('energy-kcal');
  const kj = nutrient('energy-kj') ?? nutrient('energy'); // OFF's unqualified energy is kJ.
  const sodium = nutrient('sodium');
  const salt = nutrient('salt');
  const servingLabel = text(product.serving_size);
  const measure = /(?:^|[^\d.])(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)\b/i.exec(servingLabel ?? '');
  const servingQuantity = number(product.serving_quantity);
  const amount = measure ? Number(measure[1]!.replace(',', '.')) : servingQuantity;
  const unit = measure?.[2]?.toLowerCase();
  const positive = amount !== null && amount > 0 ? amount : null;
  const serving_g = positive !== null && (unit === 'g' || unit === 'kg') ? positive * (unit === 'kg' ? 1000 : 1) : null;
  const serving_ml = positive !== null && (unit === 'ml' || unit === 'cl' || unit === 'l') ? positive * (unit === 'l' ? 1000 : unit === 'cl' ? 10 : 1) : null;
  const code = text(product.code) ?? lookupCode(normalized);
  const food = foodRecordSchema.safeParse({
    id: `off:${code}`, name: text(product.product_name) ?? `Open Food Facts ${code}`, brand: text(product.brands),
    prep_state: 'unknown', basis, serving_g, serving_ml,
    units: serving_g !== null || serving_ml !== null ? [{ label: servingLabel ?? 'serving', grams: serving_g, ml: serving_ml }] : [],
    nutrients: {
      kcal: kcal ?? (kj === null ? null : kj / 4.184), protein_g: nutrient('proteins'), carbs_g: nutrient('carbohydrates'), fat_g: nutrient('fat'),
      fiber_g: nutrient('fiber'), sugar_g: nutrient('sugars'), sat_fat_g: nutrient('saturated-fat'),
      sodium_mg: sodium !== null ? sodium * 1000 : salt !== null ? salt * 393.4 : null,
      calcium_mg: nutrient('calcium') === null ? null : nutrient('calcium')! * 1000,
      iron_mg: nutrient('iron') === null ? null : nutrient('iron')! * 1000,
      potassium_mg: nutrient('potassium') === null ? null : nutrient('potassium')! * 1000,
    },
    provenance_kind: 'database', source_pack_id: 'open-food-facts-live', source_id: code, source_version: new Date().toISOString().slice(0, 10),
  });
  if (!food.success) throw new OffLookupError('invalid_product', 'Open Food Facts product has incomplete or invalid core nutrition');
  return { food: food.data, attribution: { name: 'Open Food Facts', license: 'ODbL-1.0', url: `https://world.openfoodfacts.org/product/${encodeURIComponent(code)}` } };
}

/** UPC-E must be expanded; GS1 element strings must never enter the product URL. */
function lookupCode(normalized: NormalizedBarcode): string {
  if (normalized.symbology === 'upc_e') return normalized.gtin14.slice(2);
  if (normalized.symbology === 'gs1') return normalized.gtin14;
  return normalized.rawCode.trim();
}

export async function fetchOpenFoodFactsProduct(normalized: NormalizedBarcode, options: OffLookupOptions = {}): Promise<OffProduct | null> {
  const timeoutMs = options.timeoutMs ?? 8000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new OffLookupError('timeout', 'OFF timeout must be a positive finite duration');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new OffLookupError('timeout', 'Open Food Facts lookup timed out')); controller.abort(); }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await (options.fetchImpl ?? fetch)(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(lookupCode(normalized))}.json?fields=${fields}`, {
        headers: { 'User-Agent': options.userAgent ?? OFF_USER_AGENT }, signal: controller.signal,
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new OffLookupError('http', `Open Food Facts HTTP ${response.status}`, response.status);
      const body = object(await response.json());
      if (body.status === 0) return null;
      return mapProduct(body.product, normalized);
    })()]);
  } catch (error) {
    if (error instanceof OffLookupError) throw error;
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new OffLookupError('timeout', 'Open Food Facts lookup timed out');
    throw new OffLookupError('network', error instanceof Error ? error.message : 'Open Food Facts network lookup failed');
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
