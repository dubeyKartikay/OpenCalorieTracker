import type { FoodRecord, NormalizedBarcode, PackMeta, PrepState } from '../domain';

export interface SearchOptions { limit?: number; preferredPrepState?: PrepState }
export interface SearchCandidate {
  food: FoodRecord;
  bucket: 'yours' | 'database';
  sourceLabel: string;
  packPriority: number;
  matchTier: 0 | 1 | 2 | 3;
  prepStateMatch: boolean;
  withinPackRank: number;
  matchedAlias: string | null;
}
export interface FoodSourceAdapter {
  readonly sourceId: string;
  readonly bucket: 'yours' | 'database';
  getMeta(): Promise<PackMeta>;
  search(query: string, options?: SearchOptions): Promise<SearchCandidate[]>;
  getById(foodId: string): Promise<FoodRecord | null>;
  lookupBarcode(normalized: NormalizedBarcode): Promise<FoodRecord | null>;
}
