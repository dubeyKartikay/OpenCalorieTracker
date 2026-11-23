import type { FoodBasis, FoodRecord, NormalizedBarcode, NutrientProfile } from '../domain';

export type BarcodeCatalogTier = 'personal' | 'pack' | 'off_cache' | 'off_live';
export interface BarcodeAttribution { name: string; license: string; url: string | null }
export interface OffProduct { food: FoodRecord; attribution: BarcodeAttribution }
export type BarcodeResolution = {
  status: 'found'; tier: BarcodeCatalogTier; food: FoodRecord; normalized: NormalizedBarcode;
  attribution: BarcodeAttribution | null;
} | {
  status: 'not_found'; normalized: NormalizedBarcode; checkedTiers: BarcodeCatalogTier[];
  liveLookupAttempted: boolean; liveLookupError: string | null;
};

/** Decode counters belong to the scanner; catalog counters belong to the resolver. */
export interface BarcodeScanTelemetry {
  decodeAttempts: number;
  decodeSuccesses: number;
  catalogHitsByTier: Record<BarcodeCatalogTier, number>;
  catalogMisses: number;
}
export function createBarcodeScanTelemetry(): BarcodeScanTelemetry {
  return { decodeAttempts: 0, decodeSuccesses: 0, catalogHitsByTier: { personal: 0, pack: 0, off_cache: 0, off_live: 0 }, catalogMisses: 0 };
}

/** Incomplete label text is a draft, not a schema-valid FoodRecord. */
export interface ParsedNutritionLabel {
  basis: FoodBasis | null;
  serving_g: number | null;
  serving_ml: number | null;
  nutrients: { [K in keyof NutrientProfile]: number | null };
  warnings: string[];
}
