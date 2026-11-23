import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateNutrition, generateId, nutrientKeys, sumNutrients } from '../../domain';
import { at, buildFixturePack, entry, food, meta, resources } from '../../storage/__tests__/fixtures';
import { exportBundleV1, restoreBundleV1 } from '../../storage/exportImport';
import { DiaryRepo } from '../../storage/repos/diaryRepo';
import { LibraryRepo } from '../../storage/repos/libraryRepo';
import { PacksRepo } from '../../storage/repos/packsRepo';
import { matchTier, rankCandidates } from '../ranker';
import { FoodSourceRegistry } from '../registry';
import { SqlitePackAdapter, validatePackDatabase } from '../sqlitePackAdapter';
import type { SearchCandidate } from '../types';
import { UserLibraryAdapter } from '../userLibraryAdapter';

const scope = resources();
const candidate = (overrides: Partial<SearchCandidate> = {}): SearchCandidate => ({ food: food(), bucket: 'database', sourceLabel: 'USDA', packPriority: 100, matchTier: 0, prepStateMatch: false, withinPackRank: 0, matchedAlias: null, ...overrides });

describe('Slice 1 backend using real read-only pack files and persistent user.db', () => {
  it('searches, portions, confirms once, reopens, exports/restores, imports another pack and preserves history', async () => {
    const directory = await scope.directory();
    const pack1Path = join(directory, 'usda.octpack.sqlite');
    const pack2Path = join(directory, 'home.octpack.sqlite');
    const userPath = join(directory, 'user.db');
    const pack1 = scope.open(pack1Path);
    await buildFixturePack(pack1, meta(), [
      { food: food({ units: [{ label: 'bowl', grams: 150, ml: null }] }), barcodes: [{ rawCode: '04252614', symbology: 'upc_e' }] },
      { food: food({ id: 'dal-mixture', name: 'Dal and rice mixture' }), aliases: ['arhar dal curry'], barcodes: [{ rawCode: '96385074', symbology: 'ean_8' }] },
      { food: food({ id: 'wheat', name: '100% wheat chapati', nutrients: { ...food().nutrients, fiber_g: 0 } }), barcodes: [{ rawCode: '4006381333931', symbology: 'ean_13' }] },
    ]);
    await pack1.closeAsync();
    const pack2 = scope.open(pack2Path);
    await buildFixturePack(pack2, meta('home'), [
      { food: food({ id: 'home-dal', name: 'Home pigeon peas', prep_state: 'prepared' }), aliases: ['arhar dal', 'dal'], barcodes: [{ rawCode: '96385074', symbology: 'ean_8' }] },
      { food: food({ id: 'roti', name: 'Home flatbread' }), aliases: ['chapati'] },
    ]);
    await pack2.closeAsync();

    const user = await scope.user(userPath);
    const catalog = new FoodSourceRegistry(user);
    await catalog.mountPack('usda', scope.open(pack1Path, true), 100);
    await new PacksRepo(user).registerPack(meta(), pack1Path);
    const rice = (await catalog.search('rice')).database.find((item) => item.food.id === 'rice')!.food;
    expect(rice.nutrients.fiber_g).toBeNull();
    expect(rice.nutrients.sugar_g).toBe(0);
    const quantity = { amount: 1.5, unit: 'bowl' };
    const nutrients = calculateNutrition(rice, quantity);
    expect(nutrients.kcal).toBe(292.5);
    const unknownCounts = Object.fromEntries(nutrientKeys.map((key) => [key, key === 'fiber_g' ? 2 : 0])) as NonNullable<ReturnType<typeof entry>['unknown_nutrient_counts']>;
    const snapshot = entry({ food: rice, quantity, nutrients, unknown_nutrient_counts: unknownCounts });
    const diary = new DiaryRepo(user);
    await diary.upsertDraft(snapshot);
    expect(await diary.confirmEntry(snapshot)).toEqual(snapshot);
    expect(await diary.confirmEntry({ ...snapshot, id: generateId() })).toEqual(snapshot);
    expect((await diary.getDiaryDay(snapshot.date))?.completeness).toBe('partial');
    await catalog.close();
    await user.closeAsync();

    const reopened = await scope.user(userPath);
    const persisted = (await new DiaryRepo(reopened).getDiaryDay(snapshot.date))!;
    expect(persisted.entries).toEqual([snapshot]);
    expect(sumNutrients(persisted.entries).unknownCount.fiber_g).toBe(2);
    expect(sumNutrients(persisted.entries).nutrients?.fiber_g).toBeNull();
    const exported = await exportBundleV1(reopened, at);
    const restored = await scope.user(join(directory, 'restored.db'));
    await restoreBundleV1(restored, JSON.parse(JSON.stringify(exported)), { mode: 'replace' });
    expect(await exportBundleV1(restored, at)).toEqual(exported);

    const registry = new FoodSourceRegistry(reopened);
    await registry.mountPack('usda', scope.open(pack1Path, true), 1);
    await registry.mountPack('home', scope.open(pack2Path, true), 999);
    await new PacksRepo(reopened).registerPack(meta('home'), pack2Path, { priority: 999 });
    const local = food({ id: 'personal', name: 'Arhar dal family meal', provenance_kind: 'user', source_pack_id: null, source_id: null, source_version: null });
    await new LibraryRepo(reopened).upsertCustomFood(local);
    const search = await registry.search('arhar dal');
    expect(search.yours[0]?.food.id).toBe('personal');
    expect(search.database[0]).toMatchObject({ matchedAlias: 'arhar dal', matchTier: 0, food: { id: 'home-dal', provenance_kind: 'database', source_pack_id: 'home', source_id: 'home-dal', source_version: '2026.1' } });
    expect((await registry.search('chapati')).database[0]?.food.id).toBe('roti');
    const localSnapshot = await new DiaryRepo(reopened).confirmEntry(entry({ food: local, provenance_kind: 'user' }));
    await new LibraryRepo(reopened).upsertCustomFood({ ...local, name: 'Changed personal food', nutrients: { ...local.nutrients, kcal: 999 } });
    await registry.unmountPack('usda');
    expect(await new DiaryRepo(reopened).getEntry(snapshot.id)).toEqual(snapshot);
    expect(await new DiaryRepo(reopened).getEntry(localSnapshot.id)).toEqual(localSnapshot);
    await registry.close();
  });
});

describe('pack validation, safe FTS5 and hydration', () => {
  it('hydrates all nutrients, volume basis, aliases, units and provenance verbatim', async () => {
    const db = scope.open();
    const record = food({ name: 'Café milk', basis: 'per_100ml', serving_ml: 250, units: [{ label: 'glass', grams: null, ml: 250 }], nutrients: { ...food().nutrients, fiber_g: null, sugar_g: 0 } });
    await buildFixturePack(db, meta('home'), [{ food: record, aliases: ['coffee milk'] }]);
    const adapter = await SqlitePackAdapter.create(db);
    const hydrated = (await adapter.getById(record.id))!;
    expect(hydrated).toEqual({ ...record, source_pack_id: 'home' });
    expect((await adapter.search('coffee milk'))[0]?.matchedAlias).toBe('coffee milk');
    expect((await adapter.search('cafe'))[0]?.food.name).toBe('Café milk');
    expect(calculateNutrition(hydrated, { amount: 1, unit: 'glass' }).kcal).toBe(325);
  });
  it.each(['dal & rice (homemade)', '100% wheat', '"dal"', 'a-b', "o'brien", 'café', 'NOT OR AND NEAR', '"', '-()', '*', 'rice : ^ { } [ ]', 'rice" OR foods_fts:*'])('never throws for adversarial FTS input %s', async (query) => {
    const db = scope.open();
    await buildFixturePack(db, meta(), [{ food: food({ name: "Dal & rice (homemade) o'brien café 100% wheat a-b" }) }]);
    const adapter = await SqlitePackAdapter.create(db);
    await expect(adapter.search(query)).resolves.toBeInstanceOf(Array);
  });
  it('returns no arbitrary results for empty input and validates limit', async () => {
    const db = scope.open();
    await buildFixturePack(db, meta(), [{ food: food() }]);
    const adapter = await SqlitePackAdapter.create(db);
    expect(await adapter.search('')).toEqual([]);
    await expect(adapter.search('rice', { limit: -1 })).rejects.toThrow('limit');
  });
  it('rejects missing tables, invalid metadata, unsupported versions and a fake FTS table', async () => {
    const empty = scope.open();
    await expect(validatePackDatabase(empty)).rejects.toThrow('missing table');
    const db = scope.open();
    await buildFixturePack(db, meta(), [{ food: food() }]);
    await db.execAsync('UPDATE pack_meta SET schema_version=2');
    await expect(validatePackDatabase(db)).rejects.toThrow('Unsupported');
    await db.execAsync("UPDATE pack_meta SET schema_version=1,attribution_url='bad'");
    await expect(validatePackDatabase(db)).rejects.toThrow();
    await db.execAsync('UPDATE pack_meta SET attribution_url=NULL; DROP TABLE foods_fts; CREATE TABLE foods_fts(food_id,name,brand,aliases)');
    await expect(validatePackDatabase(db)).rejects.toThrow('FTS5');
  });
  it('opens real pack files read-only and rejects a mismatched mount id', async () => {
    const path = join(await scope.directory(), 'readonly.octpack.sqlite');
    const writer = scope.open(path);
    await buildFixturePack(writer, meta(), [{ food: food() }]);
    await writer.closeAsync();
    const reader = scope.open(path, true);
    await expect(reader.runAsync('DELETE FROM foods')).rejects.toThrow('readonly');
    const registry = new FoodSourceRegistry(await scope.user());
    await expect(registry.mountPack('wrong', reader)).rejects.toThrow('metadata');
    expect(registry.listMountedPacks()).toEqual([]);
  });
  it('resolves raw-only barcode rows with spelling variants while preserving eight-digit symbology', async () => {
    const db = scope.open();
    await buildFixturePack(db, meta(), [
      { food: food({ id: 'upce' }), barcodes: [{ rawCode: '01234558', symbology: 'UPC-E' }] },
      { food: food({ id: 'ean8' }), barcodes: [{ rawCode: '01234558', symbology: 'EAN-8' }] },
    ]);
    await db.execAsync('UPDATE food_barcodes SET gtin14=NULL');
    const adapter = await SqlitePackAdapter.create(db);
    const { normalizeBarcode } = await import('../../domain');
    expect((await adapter.lookupBarcode(normalizeBarcode('01234558', 'upc_e')))?.id).toBe('upce');
    expect((await adapter.lookupBarcode(normalizeBarcode('01234558', 'ean_8')))?.id).toBe('ean8');
  });
});

describe('corpus-independent ranking', () => {
  it('orders Yours first, then exact alias, prefix, all tokens and partial regardless of corpus score', () => {
    const candidates = [
      candidate({ food: food({ id: 'partial', name: 'Dal' }), packPriority: 1, withinPackRank: 0 }),
      candidate({ food: food({ id: 'all', name: 'Homemade arhar yellow dal' }), packPriority: 1 }),
      candidate({ food: food({ id: 'prefix', name: 'Arhar dal cooked' }), packPriority: 1 }),
      candidate({ food: food({ id: 'exact', name: 'Pigeon peas' }), matchedAlias: 'arhar dal', packPriority: 9999, withinPackRank: 9999 }),
      candidate({ food: food({ id: 'personal', name: 'Dal' }), bucket: 'yours', packPriority: 99999 }),
    ];
    expect(rankCandidates(candidates, 'arhar dal').map((item) => item.food.id)).toEqual(['personal', 'exact', 'prefix', 'all', 'partial']);
    expect(candidates[0]?.matchTier).toBe(0); // Pure: inputs stay untouched.
  });
  it('uses preparation, priority and within-pack rank in that order', () => {
    const raw = candidate({ food: food({ id: 'raw', prep_state: 'raw' }), packPriority: 1 });
    const cookedLow = candidate({ food: food({ id: 'cooked-low', prep_state: 'cooked' }), packPriority: 100, withinPackRank: 0 });
    const cookedHigh = candidate({ food: food({ id: 'cooked-high', prep_state: 'cooked' }), packPriority: 10, withinPackRank: 1 });
    const cookedFirst = candidate({ food: food({ id: 'cooked-first', prep_state: 'cooked' }), packPriority: 10, withinPackRank: 0 });
    expect(rankCandidates([raw, cookedLow, cookedHigh, cookedFirst], 'rice', 'cooked').map((item) => item.food.id)).toEqual(['cooked-first', 'cooked-high', 'cooked-low', 'raw']);
    expect(rankCandidates([raw, cookedLow], 'raw rice')[0]?.food.id).toBe('raw');
  });
  it.each([
    ['Café', 'cafe', 0], ['Arhar dal', 'ARHAR DAL', 0], ['Arhar dal cooked', 'arhar dal', 1],
    ['Yellow arhar split dal', 'arhar dal', 2], ['Dal', 'arhar dal', 3],
  ] as const)('classifies %s for %s as tier %s', (name, query, tier) => { expect(matchTier(name, query)).toBe(tier); });
});

describe('registry barcode tiers, pack controls and personal units', () => {
  it('distinguishes UPC-E from EAN-8, supports EAN-13 and uses custom override before pack priority', async () => {
    const user = await scope.user();
    const registry = new FoodSourceRegistry(user);
    const p1 = scope.open();
    await buildFixturePack(p1, meta(), [
      { food: food({ id: 'upce' }), barcodes: [{ rawCode: '01234558', symbology: 'upc_e' }] },
      { food: food({ id: 'ean8' }), barcodes: [{ rawCode: '01234558', symbology: 'ean_8' }] },
      { food: food({ id: 'ean13' }), barcodes: [{ rawCode: '4006381333931', symbology: 'ean_13' }] },
    ]);
    const p2 = scope.open();
    await buildFixturePack(p2, meta('home'), [{ food: food({ id: 'home-ean13' }), barcodes: [{ rawCode: '4006381333931', symbology: 'ean_13' }] }]);
    await registry.mountPack('usda', p1, 100);
    await registry.mountPack('home', p2, 10);
    await new PacksRepo(user).registerPack(meta('home'), 'home.octpack.sqlite', { priority: 10 });
    expect((await registry.lookupBarcode('01234558', 'upc_e'))?.id).toBe('upce');
    expect((await registry.lookupBarcode('01234558', 'ean_8'))?.id).toBe('ean8');
    await expect(registry.lookupBarcode('01234558')).rejects.toThrow('ambiguous');
    expect((await registry.lookupBarcode('4006381333931'))?.id).toBe('home-ean13');
    const custom = food({ id: 'custom', source_pack_id: null, provenance_kind: 'user' });
    await new LibraryRepo(user).upsertCustomFood(custom, { rawCode: '4006381333931' });
    expect((await registry.lookupBarcode('4006381333931'))?.id).toBe('custom');
    await new LibraryRepo(user).deleteCustomFood(custom.id);
    await registry.setPackPriority('home', 1000);
    expect((await registry.lookupBarcode('4006381333931'))?.id).toBe('ean13');
    await registry.setPackEnabled('usda', false);
    expect((await registry.lookupBarcode('4006381333931'))?.id).toBe('home-ean13');
    await registry.setPackEnabled('home', false);
    expect(await registry.lookupBarcode('4006381333931')).toBeNull();
    expect((await registry.search('rice')).database).toEqual([]);
    expect((await new PacksRepo(user).listInstalledPacks())[0]).toMatchObject({ enabled: false, priority: 1000 });
    await registry.close();
  });
  it('overlays personal units on pack search, detail and barcode results without changing the source', async () => {
    const user = await scope.user();
    const registry = new FoodSourceRegistry(user);
    const pack = scope.open();
    const base = food({ units: [{ label: 'bowl', grams: 150, ml: null }] });
    await buildFixturePack(pack, meta(), [{ food: base, barcodes: [{ rawCode: '4006381333931', symbology: 'ean_13' }] }]);
    await registry.mountPack('usda', pack);
    await new LibraryRepo(user).upsertUserFoodUnit('usda:rice', { label: 'bowl', grams: 200, ml: null });
    await new LibraryRepo(user).upsertUserFoodUnit('usda:rice', { label: 'katori', grams: 120, ml: null });
    for (const record of [(await registry.search('rice')).database[0]!.food, await registry.getById('usda', 'rice'), await registry.lookupBarcode('4006381333931')]) {
      expect(record?.units).toEqual([{ label: 'bowl', grams: 200, ml: null }, { label: 'katori', grams: 120, ml: null }]);
    }
    expect((await (await SqlitePackAdapter.create(pack)).getById('rice'))?.units).toEqual(base.units);
    await registry.close();
  });
  it('returns recipes and saved meals as loggable Yours items with personal units', async () => {
    const user = await scope.user();
    const library = new LibraryRepo(user);
    const ingredients = [{ food: food(), quantity: { amount: 200, unit: 'g' } }];
    const recipe = { id: generateId(), name: 'Rice recipe', version: 1, ingredients, cooked_weight_g: 300, servings_count: 2, notes: null };
    const meal = { id: generateId(), name: 'Rice meal', items: ingredients, pinned: false, use_count: 0, last_used_at: null };
    await library.upsertRecipe(recipe);
    await library.upsertSavedMeal(meal);
    await library.upsertUserFoodUnit(`recipe:${recipe.id}`, { label: 'bowl', grams: 150, ml: null });
    const adapter = new UserLibraryAdapter(user);
    const results = await adapter.search('rice');
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.bucket === 'yours')).toBe(true);
    const recipeFood = (await adapter.getById(`recipe:${recipe.id}`))!;
    expect(recipeFood).toMatchObject({ basis: 'per_serving', serving_g: 300, source_version: '1', nutrients: { kcal: 260, fiber_g: null } });
    expect(calculateNutrition(recipeFood, { amount: 1, unit: 'bowl' }).kcal).toBe(130);
    expect((await adapter.getById(`meal:${meal.id}`))?.nutrients.kcal).toBe(260);
  });
  it('carries partial ingredient unknown counts through recipe portions into diary snapshots', async () => {
    const user = await scope.user();
    const library = new LibraryRepo(user);
    const ingredients = [
      { food: food({ nutrients: { ...food().nutrients, fiber_g: 4 } }), quantity: { amount: 100, unit: 'g' } },
      { food: food({ id: 'unknown-fiber' }), quantity: { amount: 100, unit: 'g' } },
    ];
    const recipe = { id: generateId(), name: 'Partial fiber recipe', version: 1, ingredients, cooked_weight_g: 400, servings_count: 2, notes: null };
    await library.upsertRecipe(recipe);
    const adapter = new UserLibraryAdapter(user);
    const id = `recipe:${recipe.id}`;
    const quantity = { amount: 100, unit: 'g' };
    const result = (await adapter.getNutritionForQuantity(id, quantity))!;
    expect(result.nutrients?.fiber_g).toBe(1);
    expect(result.unknownCount.fiber_g).toBe(1);
    const snapshot = await new DiaryRepo(user).confirmEntry(entry({ food: (await adapter.getById(id))!, quantity, nutrients: result.nutrients!, unknown_nutrient_counts: result.unknownCount, provenance_kind: 'user' }));
    expect(sumNutrients([snapshot]).unknownCount.fiber_g).toBe(1);
    expect(sumNutrients([snapshot]).nutrients?.fiber_g).toBe(1);
  });
});
