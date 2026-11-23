import type { FoodSourceRegistry } from '../catalog';
import { normalizeBarcode } from '../domain';
import type { SqlDatabase } from '../storage/driver';
import { getCachedOffProduct, initOffCache, putCachedOffProduct } from './offCache';
import { fetchOpenFoodFactsProduct } from './offClient';
import { createBarcodeScanTelemetry } from './types';
import type { BarcodeCatalogTier, BarcodeResolution } from './types';

export interface BarcodeResolverOptions {
  catalog: FoodSourceRegistry;
  offCacheDb?: SqlDatabase | null;
  fetchImpl?: typeof fetch;
  getAllowLiveOffLookup?: () => Promise<boolean> | boolean;
}
export class BarcodeResolver {
  readonly telemetry = createBarcodeScanTelemetry();
  private cacheReady: Promise<void> | undefined;
  constructor(private readonly options: BarcodeResolverOptions) {}

  async resolve(rawCode: string, symbology?: string): Promise<BarcodeResolution> {
    const normalized = normalizeBarcode(rawCode, symbology);
    const checkedTiers: BarcodeCatalogTier[] = ['personal'];
    const hit = (result: Extract<BarcodeResolution, { status: 'found' }>): BarcodeResolution => {
      this.telemetry.catalogHitsByTier[result.tier]++; return result;
    };
    const personal = await this.options.catalog.userLibrary.lookupBarcode(normalized);
    if (personal) return hit({ status: 'found', tier: 'personal', normalized, food: personal, attribution: null });
    checkedTiers.push('pack');
    const packed = await this.options.catalog.lookupBarcode(normalized.rawCode, normalized.symbology);
    if (packed) {
      const meta = this.options.catalog.listMountedPacks().find((pack) => pack.packId === packed.source_pack_id)?.meta;
      return hit({ status: 'found', tier: 'pack', normalized, food: packed, attribution: meta ? { name: meta.attribution_text, license: meta.license, url: meta.attribution_url } : null });
    }
    const db = this.options.offCacheDb;
    if (db) {
      checkedTiers.push('off_cache');
      this.cacheReady ??= initOffCache(db);
      await this.cacheReady;
      const cached = await getCachedOffProduct(db, normalized);
      if (cached) return hit({ status: 'found', tier: 'off_cache', normalized, ...cached });
    }
    let liveLookupAttempted = false;
    let liveLookupError: string | null = null;
    if (await this.options.getAllowLiveOffLookup?.() === true) {
      liveLookupAttempted = true;
      checkedTiers.push('off_live');
      try {
        const product = await fetchOpenFoodFactsProduct(normalized, this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {});
        if (product) {
          if (db) await putCachedOffProduct(db, normalized, product.food, product.attribution);
          return hit({ status: 'found', tier: 'off_live', normalized, ...product });
        }
      } catch (error) { liveLookupError = error instanceof Error ? error.message : String(error); }
    }
    this.telemetry.catalogMisses++;
    return { status: 'not_found', normalized, checkedTiers, liveLookupAttempted, liveLookupError };
  }
}
