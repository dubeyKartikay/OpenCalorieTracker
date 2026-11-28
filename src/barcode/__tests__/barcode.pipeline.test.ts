import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoodSourceRegistry } from '../../catalog';
import { BarcodeError, foodRecordSchema, normalizeBarcode } from '../../domain';
import { buildFixturePack, food, meta, resources } from '../../storage/__tests__/fixtures';
import { exportBundleV1 } from '../../storage/exportImport';
import { LibraryRepo } from '../../storage/repos/libraryRepo';
import { PacksRepo } from '../../storage/repos/packsRepo';
import {
  BarcodeResolver, createBarcodeScanTelemetry, fetchOpenFoodFactsProduct, getCachedOffProduct,
  getFossScannerCapability, initOffCache, OFF_USER_AGENT, OffLookupError, parseNutritionLabelText, putCachedOffProduct,
} from '..';

const scope = resources();
const unknown = normalizeBarcode('4006381333931');
const packPath = resolve('assets/packs/custom-home-pack.octpack.sqlite');
const core = { 'energy-kcal_100g': 123, proteins_100g: 2, carbohydrates_100g: 9, fat_100g: 3 };
function response(product: Record<string, unknown> = {}, nutriments: Record<string, unknown> = core) {
  return Response.json({ status: 1, product: { code: unknown.rawCode, product_name: 'Test food', nutriments, ...product } });
}
afterEach(() => { vi.useRealTimers(); });

async function mounted() {
  const directory = await scope.directory();
  const user = await scope.user(join(directory, 'user.db'));
  const catalog = new FoodSourceRegistry(user);
  const pack = scope.open(packPath, true);
  const packMeta = (await pack.getFirstAsync<{ pack_id: string }>('SELECT pack_id FROM pack_meta'))!;
  await catalog.mountPack(packMeta.pack_id, pack);
  return { user, catalog, directory };
}

describe('local-first barcode resolution against real SQLite and compiled custom pack', () => {
  it.each([
    ['8901262010016', 'ean_13', 'custom-amul-taaza-toned-milk'],
    ['8906012345677', 'ean_13', 'custom-millet-cookies'],
    ['04252614', 'upc_e', 'custom-lime-sparkling-water-test'],
    ['042100005264', 'upc_a', 'custom-lime-sparkling-water-test'],
    ['96385074', 'ean_8', 'custom-marie-biscuits-test'],
  ])('finds %s (%s) in tier 2', async (raw, symbology, id) => {
    const { catalog } = await mounted();
    const fetchImpl = vi.fn<typeof fetch>();
    const resolver = new BarcodeResolver({ catalog, fetchImpl });
    const result = await resolver.resolve(raw, symbology);
    expect(result).toMatchObject({ status: 'found', tier: 'pack', food: { id }, attribution: { license: expect.any(String) } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolver.telemetry).toMatchObject({ decodeAttempts: 0, decodeSuccesses: 0, catalogHitsByTier: { pack: 1 }, catalogMisses: 0 });
  });
  it('rejects ambiguous/malformed input and keeps UPC-E and EAN-8 identities distinct', async () => {
    const { catalog } = await mounted();
    const resolver = new BarcodeResolver({ catalog });
    await expect(resolver.resolve('04252614')).rejects.toBeInstanceOf(BarcodeError);
    await expect(resolver.resolve('not-a-code')).rejects.toBeInstanceOf(BarcodeError);
    const upce = await resolver.resolve('04252614', 'upc_e');
    const ean8 = await resolver.resolve('96385074', 'ean_8');
    expect(upce.normalized.gtin14).not.toBe(ean8.normalized.gtin14);
    // The very same raw digits can be valid in both symbologies and must not collide.
    const user = await scope.user();
    const registry = new FoodSourceRegistry(user);
    await new LibraryRepo(user).upsertCustomFood(food({ id: 'upce' }), { rawCode: '01234558', symbology: 'upc_e' });
    await new LibraryRepo(user).upsertCustomFood(food({ id: 'ean8' }), { rawCode: '01234558', symbology: 'ean_8' });
    expect(await new BarcodeResolver({ catalog: registry }).resolve('01234558', 'upc_e')).toMatchObject({ food: { id: 'upce' } });
    expect(await new BarcodeResolver({ catalog: registry }).resolve('01234558', 'ean_8')).toMatchObject({ food: { id: 'ean8' } });
  });
  it('uses the personal barcode override before the compiled pack', async () => {
    const { user, catalog } = await mounted();
    const custom = food({ id: 'my-milk', name: 'My milk', provenance_kind: 'user', source_pack_id: null });
    await new LibraryRepo(user).upsertCustomFood(custom, { rawCode: '8901262010016' });
    expect(await new BarcodeResolver({ catalog }).resolve('8901262010016')).toMatchObject({ status: 'found', tier: 'personal', food: custom, attribution: null });
  });
  it('respects pack priority and enabled state', async () => {
    const user = await scope.user();
    const catalog = new FoodSourceRegistry(user);
    for (const [id, priority] of [['first', 10], ['second', 20]] as const) {
      const db = scope.open();
      await buildFixturePack(db, meta(id), [{ food: food({ id }), barcodes: [{ rawCode: unknown.rawCode, symbology: unknown.symbology }] }]);
      await new PacksRepo(user).registerPack(meta(id), `${id}.sqlite`);
      await catalog.mountPack(id, db, priority);
    }
    const resolver = new BarcodeResolver({ catalog });
    expect(await resolver.resolve(unknown.rawCode)).toMatchObject({ tier: 'pack', food: { id: 'first' } });
    await catalog.setPackEnabled('first', false);
    expect(await resolver.resolve(unknown.rawCode)).toMatchObject({ tier: 'pack', food: { id: 'second' } });
  });
  it('never fetches by default, then caches opt-in hits in off_cache.sqlite without changing user.db', async () => {
    const { user, catalog, directory } = await mounted();
    const offCacheDb = scope.open(join(directory, 'off_cache.sqlite'));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({}, { ...core, sugars_100g: 0, iron_100g: 0 }));
    const before = await exportBundleV1(user, '2026-11-23T00:00:00Z');
    const userChanges = await user.getFirstAsync<{ count: number }>('SELECT total_changes() AS count');
    let allow = false;
    const resolver = new BarcodeResolver({ catalog, offCacheDb, fetchImpl, getAllowLiveOffLookup: () => allow });
    expect(await resolver.resolve(unknown.rawCode)).toMatchObject({ status: 'not_found', checkedTiers: ['personal', 'pack', 'off_cache'], liveLookupAttempted: false, liveLookupError: null });
    expect(fetchImpl).not.toHaveBeenCalled();
    allow = true;
    const first = await resolver.resolve(unknown.rawCode);
    expect(first).toMatchObject({ status: 'found', tier: 'off_live', food: { nutrients: { kcal: 123, fiber_g: null, sugar_g: 0, sodium_mg: null, calcium_mg: null, iron_mg: 0, potassium_mg: null } } });
    allow = false; // Cached records remain usable offline after consent is revoked.
    expect(await resolver.resolve(unknown.rawCode)).toMatchObject({ status: 'found', tier: 'off_cache' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await offCacheDb.getFirstAsync('SELECT raw_code,symbology FROM off_products')).toEqual({ raw_code: unknown.rawCode, symbology: unknown.symbology });
    expect(await user.getFirstAsync("SELECT name FROM sqlite_master WHERE name='off_products'")).toBeNull();
    expect(await user.getFirstAsync('SELECT total_changes() AS count')).toEqual(userChanges);
    expect(await exportBundleV1(user, '2026-11-23T00:00:00Z')).toEqual(before);
    expect(resolver.telemetry.catalogHitsByTier).toMatchObject({ off_live: 1, off_cache: 1 });
  });
  it('rejects a user.db handle as an OFF cache without creating its schema', async () => {
    const user = await scope.user();
    await expect(initOffCache(user)).rejects.toThrow('isolated');
    expect(await user.getFirstAsync("SELECT name FROM sqlite_master WHERE name='off_products'")).toBeNull();
  });
  it('validates cache writes and updates by normalized GTIN', async () => {
    const db = scope.open();
    await initOffCache(db);
    const attribution = { name: 'Open Food Facts', license: 'ODbL-1.0', url: null };
    const code = normalizeBarcode('04252614', 'upc_e');
    await putCachedOffProduct(db, code, food(), attribution);
    await putCachedOffProduct(db, code, food({ name: 'Updated' }), attribution);
    expect(await getCachedOffProduct(db, normalizeBarcode('042100005264'))).toMatchObject({ food: { name: 'Updated' }, attribution });
    expect(await db.getFirstAsync('SELECT COUNT(*) AS count FROM off_products')).toEqual({ count: 1 });
    await expect(putCachedOffProduct(db, code, { ...food(), nutrients: { ...food().nutrients, kcal: -1 } }, attribution)).rejects.toThrow();
    expect(foodRecordSchema.parse((await getCachedOffProduct(db, code))!.food).name).toBe('Updated');
  });
  it.each(['network', 'http', 'timeout'] as const)('degrades %s failure to not_found', async (kind) => {
    const catalog = new FoodSourceRegistry(await scope.user());
    const fetchImpl = vi.fn<typeof fetch>();
    if (kind === 'network') fetchImpl.mockRejectedValue(new TypeError('Offline'));
    else if (kind === 'http') fetchImpl.mockResolvedValue(new Response('', { status: 500 }));
    else { vi.useFakeTimers(); fetchImpl.mockImplementation(() => new Promise(() => undefined)); }
    const resolving = new BarcodeResolver({ catalog, offCacheDb: scope.open(), fetchImpl, getAllowLiveOffLookup: async () => true }).resolve(unknown.rawCode);
    if (kind === 'timeout') { await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled()); await vi.advanceTimersByTimeAsync(8000); }
    expect(await resolving).toMatchObject({ status: 'not_found', checkedTiers: ['personal', 'pack', 'off_cache', 'off_live'], liveLookupAttempted: true, liveLookupError: expect.stringMatching(kind === 'network' ? /Offline/ : kind === 'http' ? /500/ : /timed out/) });
  });
});

describe('direct Open Food Facts mapping', () => {
  it('uses the exact endpoint, attribution, user agent, source energy and provenance', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response());
    const result = await fetchOpenFoodFactsProduct(unknown, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(`https://world.openfoodfacts.org/api/v2/product/${unknown.rawCode}.json?fields=code,product_name,brands,quantity,serving_size,serving_quantity,nutriments,nutrition_data_per`, expect.objectContaining({ headers: { 'User-Agent': OFF_USER_AGENT }, signal: expect.any(AbortSignal) }));
    expect(result).toMatchObject({ food: { basis: 'per_100g', nutrients: { kcal: 123 }, provenance_kind: 'database', source_pack_id: 'open-food-facts-live', source_id: unknown.rawCode, source_version: new Date().toISOString().slice(0, 10) }, attribution: { name: 'Open Food Facts', license: 'ODbL-1.0' } });
  });
  it.each(['upc_e', 'gs1'] as const)('expands %s identifiers for the lookup URL', async (kind) => {
    const code = kind === 'upc_e' ? normalizeBarcode('04252614', kind) : normalizeBarcode('(01)00042100005264', kind);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    await fetchOpenFoodFactsProduct(code, { fetchImpl });
    expect(fetchImpl.mock.calls[0]![0]).toContain(`/product/${kind === 'upc_e' ? '042100005264' : '00042100005264'}.json`);
  });
  it('converts kJ, salt and gram-based micronutrients without filling absent optional values', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({}, { 'energy-kj_100g': 418.4, proteins_100g: 2, carbohydrates_100g: 3, fat_100g: 4, salt_100g: 1, calcium_100g: 0.12, iron_100g: 0.001, potassium_100g: 0.3 }));
    const result = await fetchOpenFoodFactsProduct(unknown, { fetchImpl });
    expect(result?.food.nutrients).toMatchObject({ fiber_g: null, sugar_g: null, sat_fat_g: null, sodium_mg: 393.4, calcium_mg: 120, iron_mg: 1, potassium_mg: 300 });
    expect(result?.food.nutrients.kcal).toBeCloseTo(100);
  });
  it('preserves explicit sodium zero ahead of salt and rejects incomplete core nutrition', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response({}, { ...core, sodium_100g: 0, salt_100g: 1 })).mockResolvedValueOnce(response({}, { proteins_100g: 2 }));
    expect((await fetchOpenFoodFactsProduct(unknown, { fetchImpl }))?.food.nutrients.sodium_mg).toBe(0);
    await expect(fetchOpenFoodFactsProduct(unknown, { fetchImpl })).rejects.toMatchObject({ kind: 'invalid_product' });
  });
  it.each([
    [{ nutrition_data_per: '100ml', serving_size: '1 glass (200 ml)', serving_quantity: 200 }, core, 'per_100ml', null, 200],
    [{ nutrition_data_per: '100g', serving_size: '2 cookies (30 g)' }, core, 'per_100g', 30, null],
    [{ nutrition_data_per: '100g', quantity: '500 ml', serving_size: '30 g' }, core, 'per_100g', 30, null],
    [{ nutrition_data_per: 'serving', serving_size: '1 scoop (25 g)' }, { 'energy-kcal_serving': 80, proteins_serving: 4, carbohydrates_serving: 5, fat_serving: 2 }, 'per_serving', 25, null],
    [{ nutrition_data_per: 'serving', serving_size: '30 g' }, core, 'per_100g', 30, null],
  ] as const)('maps basis and serving dimensions truthfully (%j)', async (product, nutriments, basis, grams, ml) => {
    const result = await fetchOpenFoodFactsProduct(unknown, { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(product, nutriments)) });
    expect(result?.food).toMatchObject({ basis, serving_g: grams, serving_ml: ml, units: [{ grams, ml }] });
  });
  it.each([404, 0])('returns null for missing product %s', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(status === 404 ? new Response('', { status: 404 }) : Response.json({ status: 0 }));
    expect(await fetchOpenFoodFactsProduct(unknown, { fetchImpl })).toBeNull();
  });
  it('aborts a slow response body and throws a typed timeout error', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_, options) => {
      signal = options?.signal ?? undefined;
      return { ok: true, status: 200, json: () => new Promise(() => undefined) } as unknown as Response;
    });
    const lookup = fetchOpenFoodFactsProduct(unknown, { fetchImpl, timeoutMs: 25 });
    const rejected = expect(lookup).rejects.toBeInstanceOf(OffLookupError);
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(signal?.aborted).toBe(true);
  });
});

describe('offline nutrition-label text parser', () => {
  it('parses an Indian FSSAI label and retains source kcal and unknown fiber/sugar', () => {
    const parsed = parseNutritionLabelText('Nutritional Information (per 100 g)\nServing Size: 30 g\nEnergy (kcal) 452\nProtein (g) 7.2\nCarbohydrate (g) 66.4\nTotal Fat (g) 17.6\nSaturated Fat (g) 8.2\nSodium (mg) 312');
    expect(parsed).toMatchObject({ basis: 'per_100g', serving_g: 30, serving_ml: null, nutrients: { kcal: 452, protein_g: 7.2, carbs_g: 66.4, fat_g: 17.6, fiber_g: null, sugar_g: null, sat_fat_g: 8.2, sodium_mg: 312 }, warnings: [] });
  });
  it('parses an EU per-volume label, decimal commas, kJ fallback and salt', () => {
    const parsed = parseNutritionLabelText('Nutrition per 100 ml\nServing size: 250 ml\nEnergy 209.2 kJ\nFat 1,5 g\nof which saturates 0.8 g\nCarbohydrate 6 g\nof which sugars 0 g\nProtein 3 g\nSalt 0,1 g');
    expect(parsed).toMatchObject({ basis: 'per_100ml', serving_g: null, serving_ml: 250, nutrients: { protein_g: 3, carbs_g: 6, fat_g: 1.5, fiber_g: null, sugar_g: 0, sat_fat_g: 0.8 }, warnings: [] });
    expect(parsed.nutrients.kcal).toBeCloseTo(50);
    expect(parsed.nutrients.sodium_mg).toBeCloseTo(39.34);
  });
  it('parses a US FDA per-serving label without reading daily-value percentages as quantities', () => {
    const parsed = parseNutritionLabelText('Nutrition Facts\nServing size 2 cookies (30 g)\nAmount per serving\nCalories 150\nTotal Fat 8g 10%\nSaturated Fat 2g 10%\nSodium 0mg 0%\nTotal Carbohydrate 18g 7%\nDietary Fiber 0g 0%\nTotal Sugars 9g\nIncludes 5g Added Sugars 10%\nProtein 2g\nCalcium 10%');
    expect(parsed).toMatchObject({ basis: 'per_serving', serving_g: 30, nutrients: { kcal: 150, protein_g: 2, carbs_g: 18, fat_g: 8, fiber_g: 0, sugar_g: 9, sat_fat_g: 2, sodium_mg: 0, calcium_mg: null }, warnings: [] });
  });
  it('keeps missing/approximate values unknown and requests basis/core review', () => {
    const parsed = parseNutritionLabelText('Protein <1g\nDietary Fiber --\nSugars 10%');
    expect(parsed.basis).toBeNull();
    expect(Object.values(parsed.nutrients).every((value) => value === null)).toBe(true);
    expect(parsed.warnings).toContain('Missing kcal; confirm the label before saving.');
  });
  it('prefers kcal over kJ, sodium over salt, and the first column with a warning', () => {
    const parsed = parseNutritionLabelText('Per 100 g | Per serving\nEnergy 418.4 kJ / 110 kcal | 55 kcal\nFat 3 g | 1.5 g\nProtein 2 g | 1 g\nCarbohydrate 10 g | 5 g\nSalt 1 g | 0.5 g\nSodium 0 mg | 0 mg');
    expect(parsed).toMatchObject({ basis: 'per_100g', nutrients: { kcal: 110, fat_g: 3, protein_g: 2, carbs_g: 10, sodium_mg: 0 } });
    expect(parsed.warnings[0]).toMatch(/Multiple nutrition columns/);
  });
  it('handles outer-piped tables, empty first cells, and mismatched kJ/kcal columns cleanly', () => {
    const piped = parseNutritionLabelText('| Per 100 g | Per serving |\n| Energy | 200 kcal | 50 kcal |\n| Protein | | 3 g |\n| Fat | 4 g | 1 g |');
    expect(piped).toMatchObject({ basis: 'per_100g', nutrients: { kcal: 200, protein_g: null, fat_g: 4 } });

    const emptyFirst = parseNutritionLabelText('Per 100 g | Per serving\nEnergy 0 kJ 50 kcal\nProtein || 3 g');
    expect(emptyFirst).toMatchObject({ basis: 'per_100g', nutrients: { kcal: 0, protein_g: null } });
  });
  it('does not invent serving measurements or assume density', () => {
    const parsed = parseNutritionLabelText('Per serving\nCalories 0\nProtein 0g\nCarbohydrate 0g\nFat 0g');
    expect(parsed).toMatchObject({ basis: 'per_serving', serving_g: null, serving_ml: null, nutrients: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: null } });
    expect(parsed.warnings).toHaveLength(1);
  });
});

it('advertises native FOSS requirements and manual fallback without importing native decoders', () => {
  expect(getFossScannerCapability()).toMatchObject({ liveCamera: { engine: 'zxing-cpp', available: false, requiresNativeDevBuild: true, nativePackages: ['oct-barcode-scanner'] }, manualEntry: { available: true }, bundlesGoogleMlKit: false });
  expect(getFossScannerCapability(true).liveCamera.available).toBe(true);
  expect(getFossScannerCapability(true, 'ios').liveCamera.engine).toBe('avfoundation');
  expect(createBarcodeScanTelemetry()).toEqual({ decodeAttempts: 0, decodeSuccesses: 0, catalogHitsByTier: { personal: 0, pack: 0, off_cache: 0, off_live: 0 }, catalogMisses: 0 });
});
