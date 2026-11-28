import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoodSourceRegistry } from '../../catalog';
import { calculateNutrition, generateId, nutrientProfileSchema } from '../../domain';
import type { HealthPlatformPort } from '../../health';
import { DiaryRepo, GoalsRepo, LibraryRepo, migrateDatabase, PacksRepo } from '../../storage';
import { createNodeSqliteDriver } from '../../storage/nodeDriver';
import { AppController, availableUnits, type ControllerDependencies } from '../controller';

const PACK1 = resolve('assets/packs/usda-fdc-starter.octpack.sqlite');
const PACK2 = resolve('assets/packs/custom-home-pack.octpack.sqlite');
const DATE = '2026-11-23';
const tempDirs: string[] = [];
const controllers = new Set<AppController>();
async function open(path: string, extra: Partial<ControllerDependencies> = {}) {
  const userDb = createNodeSqliteDriver(path);
  await migrateDatabase(userDb);
  const controller = new AppController({ userDb, catalog: new FoodSourceRegistry(userDb), diary: new DiaryRepo(userDb),
    goals: new GoalsRepo(userDb), library: new LibraryRepo(userDb), packs: new PacksRepo(userDb), ...extra });
  controllers.add(controller); return controller;
}
async function close(controller: AppController) { await controller.close(); controllers.delete(controller); }
function directory() { const path = mkdtempSync(join(tmpdir(), 'oct-slice1-')); tempDirs.push(path); return path; }
async function pack(controller: AppController, path = PACK1, priority = 100) { return controller.installPack(createNodeSqliteDriver(path, { readOnly: true }), path, priority); }
afterEach(async () => {
  for (const controller of controllers) await controller.close();
  controllers.clear(); for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});
describe('Slice 1 against real SQLite and both compiled starter packs', () => {
  it('rejects an invalid pack before registering or disturbing an existing mount', async () => {
    const dir = directory(); const app = await open(join(dir, 'user.db')); await pack(app);
    const before = await app.listPacks();
    const handle = createNodeSqliteDriver(join(dir, 'invalid.octpack.sqlite'));
    await expect(app.installPack(handle, join(dir, 'invalid.octpack.sqlite'), 0)).rejects.toThrow('Invalid pack');
    expect(await app.listPacks()).toEqual(before);
    expect((await app.search('oats')).database[0]?.food.source_pack_id).toBe('usda-fdc-starter');
    await expect(handle.getFirstAsync('SELECT 1')).rejects.toThrow();
  });
  it('boots → searches → portions → confirms → restarts → exports/restores → imports pack 2 without changing history', async () => {
    const dir = directory(); const path = join(dir, 'user.db'); let app = await open(path);
    const meta = await pack(app); expect(meta.pack_id).toBe('usda-fdc-starter');
    expect((await app.listPacks())[0]?.foodCount).toBe(50);
    expect((await app.day(DATE)).totals.nutrients).toBeNull();
    const oats = (await app.search('oats')).database[0]!.food;
    const egg = (await app.search('egg')).database[0]!.food;
    expect(availableUnits(oats)).toContain('oz');
    const breakfast = await app.confirm({ food: oats, quantity: { amount: 1.5, unit: 'oz' }, meal: 'Breakfast', date: DATE, idempotencyKey: 'oats-operation' });
    expect(breakfast.nutrients).toEqual(calculateNutrition(oats, { amount: 1.5, unit: 'oz' }));
    expect(await app.confirm({ food: oats, quantity: { amount: 200, unit: 'g' }, meal: 'Breakfast', date: DATE, idempotencyKey: 'oats-operation' })).toEqual(breakfast);
    await app.confirm({ food: egg, quantity: { amount: 50, unit: 'g' }, meal: 'Breakfast', date: DATE, idempotencyKey: 'egg-operation' });
    const originalDay = await app.day(DATE);
    expect(originalDay.totals.entryCount).toBe(2); expect(originalDay.totals.unknownCount.fiber_g).toBe(0);
    expect(originalDay.day?.completeness).toBe('complete');
    await close(app); app = await open(path);
    expect((await app.day(DATE)).day?.entries).toEqual(originalDay.day?.entries);
    expect((await app.day(DATE)).totals).toEqual(originalDay.totals);
    const json = await app.exportJson(); expect(app.previewRestore(json).entries).toBe(2);
    const restored = await open(join(dir, 'restored.db')); await restored.restoreJson(json, 'replace');
    expect((await restored.day(DATE)).day).toEqual((await app.day(DATE)).day);
    const roundTrip = JSON.parse(await restored.exportJson()); const originalBundle = JSON.parse(json);
    delete roundTrip.exported_at; delete originalBundle.exported_at; expect(roundTrip).toEqual(originalBundle);
    await pack(app); await pack(app, PACK2, 50);
    expect((await app.listPacks()).map(item => item.foodCount)).toEqual([35, 50]);
    const dalMatches = (await app.search('dal')).database;
    expect(dalMatches[0]?.food.source_pack_id).toBe('custom-home-pack');
    expect(new Set((await app.search('rice')).database.map(item => item.food.source_pack_id))).toEqual(new Set(['usda-fdc-starter', 'custom-home-pack']));
    const alias = (await app.search('arhar dal')).database[0]!;
    expect(alias.matchedAlias).toBe('arhar dal'); expect(alias.food.nutrients.fiber_g).toBeNull();
    expect(availableUnits(alias.food)).toContain('1 katori');
    const lunch = await app.confirm({ food: alias.food, quantity: { amount: 1, unit: '1 katori' }, meal: 'Lunch', date: DATE, idempotencyKey: 'dal-operation' });
    expect(lunch.nutrients.fiber_g).toBeNull(); expect((await app.day(DATE)).totals.unknownCount.fiber_g).toBe(1);
    await app.setPackEnabled('usda-fdc-starter', false);
    expect((await app.search('oats')).database.every(item => item.food.source_pack_id !== 'usda-fdc-starter')).toBe(true);
    await app.deps.catalog.unmountPack('usda-fdc-starter');
    expect((await app.day(DATE)).day?.entries.filter(entry => entry.meal === 'Breakfast')).toEqual(originalDay.day?.entries);
    expect(await app.deps.diary.getEntry(breakfast.id)).toEqual(breakfast);
  });
  it('supports delete/Undo, log/Undo, move meal, personal foods, dated targets and complete-day averages', async () => {
    const app = await open(join(directory(), 'user.db')); await pack(app);
    const food = (await app.search('oats')).database[0]!.food;
    const entry = await app.confirm({ food, quantity: { amount: 100, unit: 'g' }, meal: 'Breakfast', date: DATE, idempotencyKey: generateId() });
    await app.deleteEntry(entry.id); expect((await app.day(DATE)).totals.nutrients).toBeNull();
    await app.undo(); expect(await app.deps.diary.getEntry(entry.id)).toEqual(entry);
    await app.moveEntry(entry, 'Dinner'); expect((await app.day(DATE)).day?.entries[0]?.meal).toBe('Dinner');
    await app.confirm({ food, quantity: { amount: 30, unit: 'g' }, meal: 'Lunch', date: DATE, idempotencyKey: generateId() });
    await app.undo(); expect((await app.day(DATE)).totals.entryCount).toBe(1);
    const savedCustom = await app.saveCustomFood({ ...food, id: generateId(), name: 'My oats', source_pack_id: null, source_id: null, source_version: null, provenance_kind: 'user' });
    expect((await app.search('oats')).yours[0]?.food.name).toBe('My oats');
    await app.saveCustomFood({ ...savedCustom, name: 'Protein oats', nutrients: { ...savedCustom.nutrients, kcal: savedCustom.nutrients.kcal + 50 } }, { undoLabel: 'Edited Name and Energy' });
    expect(app.undoAction?.label).toBe('Edited Name and Energy');
    expect((await app.deps.library.getCustomFood(savedCustom.id))?.name).toBe('Protein oats');
    await app.undo();
    expect(await app.deps.library.getCustomFood(savedCustom.id)).toEqual(savedCustom);
    const savedRecipe = await app.saveRecipe({ name: 'Oat bowl', ingredients: [{ food, quantity: { amount: 100, unit: 'g' } }], cooked_weight_g: 200, servings_count: 1 });
    await app.renameRecipe(savedRecipe.id, 'Protein oat bowl');
    expect(app.undoAction?.label).toBe('Edited Name');
    expect((await app.getRecipe(savedRecipe.id))?.name).toBe('Protein oat bowl');
    await app.undo();
    expect((await app.getRecipe(savedRecipe.id))?.name).toBe('Oat bowl');
    const savedMeal = await app.saveSavedMeal({ name: 'Morning combo', items: [{ food, quantity: { amount: 50, unit: 'g' } }] });
    await app.renameSavedMeal(savedMeal.id, 'Quick breakfast');
    expect(app.undoAction?.label).toBe('Edited Name');
    expect((await app.deps.library.getSavedMeal(savedMeal.id))?.name).toBe('Quick breakfast');
    await app.undo();
    expect((await app.deps.library.getSavedMeal(savedMeal.id))?.name).toBe('Morning combo');
    const targets = { mode: 'maintain' as const, target_kcal: 2000, protein_g: 100, carbs_g: 250, fat_g: 60, fiber_g: 30 };
    await app.saveGoal(targets, '2026-11-22'); await app.saveGoal({ ...targets, target_kcal: 2200 }, DATE);
    await app.saveGoal({ ...targets, target_kcal: 2100 }, DATE);
    expect((await app.day('2026-11-22')).goal?.target_kcal).toBe(2000); expect((await app.day(DATE)).goal?.target_kcal).toBe(2100);
    expect((await app.progress(7, DATE)).completeDays).toBe(1);
    expect((await app.progress(7, DATE)).averages).toEqual(entry.nutrients);
    await app.weighIn(80, DATE); expect((await app.progress(7, DATE)).trend[0]?.trendKg).toBe(80);
  });
  it('validates restore before any write, merges idempotently, and unmounts packs on replace', async () => {
    const app = await open(join(directory(), 'user.db')); await pack(app);
    const food = (await app.search('egg')).database[0]!.food;
    await app.confirm({ food, quantity: { amount: 50, unit: 'g' }, meal: 'Breakfast', date: DATE, idempotencyKey: generateId() });
    const json = await app.exportJson();
    await expect(app.restoreJson('{"schema_version":1}', 'replace')).rejects.toThrow();
    expect((await app.day(DATE)).totals.entryCount).toBe(1);
    await app.restoreJson(json, 'merge'); await app.restoreJson(json, 'merge'); expect((await app.day(DATE)).totals.entryCount).toBe(1);
    await app.restoreJson(json, 'replace'); expect(app.deps.catalog.listMountedPacks()).toEqual([]);
    expect((await app.listPacks())[0]?.enabled).toBe(false);
    expect((await app.day(DATE)).day?.entries[0]?.nutrients).toEqual(nutrientProfileSchema.parse(calculateNutrition(food, { amount: 50, unit: 'g' })));
  });
  it('logs a food across multiple selected meals atomically with a single Undo action', async () => {
    const app = await open(join(directory(), 'user.db')); await pack(app);
    const egg = (await app.search('egg')).database[0]!.food;
    await expect(app.confirmToMeals({ food: egg, quantity: { amount: 50, unit: 'g' }, meals: [], date: DATE })).rejects.toThrow(/Select at least one meal/i);

    const added = await app.confirmToMeals({
      food: egg,
      quantity: { amount: 100, unit: 'g' },
      meals: ['Breakfast', 'Snack', 'Breakfast'],
      date: DATE,
    });
    expect(added.map(entry => entry.meal)).toEqual(['Breakfast', 'Snack']);
    expect(app.undoAction?.label).toBe('Added to Breakfast & Snack');
    expect((await app.day(DATE)).totals.entryCount).toBe(2);

    await app.undo();
    expect((await app.day(DATE)).totals.entryCount).toBe(0);

    const threeMeals = await app.confirmToMeals({
      food: egg,
      quantity: { amount: 50, unit: 'g' },
      meals: ['Breakfast', 'Lunch', 'Dinner'],
      date: DATE,
    });
    expect(threeMeals).toHaveLength(3);
    expect(app.undoAction?.label).toBe('Added to 3 meals');
    await app.undo();
    expect((await app.day(DATE)).totals.entryCount).toBe(0);
  });

  it('validates idempotency keys per meal in confirmToMeals and rejects cross-meal collisions', async () => {
    const app = await open(join(directory(), 'user.db')); await pack(app);
    const egg = (await app.search('egg')).database[0]!.food;

    await expect(app.confirmToMeals({
      food: egg,
      quantity: { amount: 50, unit: 'g' },
      meals: ['Breakfast', 'Breakfast'],
      idempotencyKeys: ['k1', 'k2'],
      date: DATE,
    })).rejects.toThrow(/Conflicting idempotency keys/i);

    await expect(app.confirmToMeals({
      food: egg,
      quantity: { amount: 50, unit: 'g' },
      meals: ['Breakfast', 'Lunch'],
      idempotencyKeys: ['same', 'same'],
      date: DATE,
    })).rejects.toThrow(/unique idempotency key/i);

    // Deduplicated meal keeps exact (meal, key) alignment
    const aligned = await app.confirmToMeals({
      food: egg,
      quantity: { amount: 50, unit: 'g' },
      meals: ['Breakfast', 'Breakfast', 'Lunch'],
      idempotencyKeys: ['k-breakfast', 'k-breakfast', 'k-lunch'],
      date: DATE,
    });
    expect(aligned.map(entry => entry.meal)).toEqual(['Breakfast', 'Lunch']);

    // Duplicate meal rows with empty first key still preserve the later explicit key
    const preserved = await app.confirmToMeals({
      food: egg,
      quantity: { amount: 50, unit: 'g' },
      meals: ['Dinner', ' Dinner '],
      idempotencyKeys: ['', 'dinner-explicit-key'],
      date: DATE,
    });
    expect(preserved).toHaveLength(1);
    const replayed = await app.confirmToMeals({
      food: egg,
      quantity: { amount: 50, unit: 'g' },
      meals: ['Dinner', ' Dinner '],
      idempotencyKeys: ['', 'dinner-explicit-key'],
      date: DATE,
    });
    expect(replayed[0]?.id).toBe(preserved[0]?.id);
    expect((await app.day(DATE)).totals.entryCount).toBe(3);

    // Replaying Breakfast's idempotency key for Lunch must fail cleanly without mutating the diary
    await expect(app.confirmToMeals({
      food: egg,
      quantity: { amount: 50, unit: 'g' },
      meals: ['Lunch'],
      idempotencyKeys: ['k-breakfast'],
      date: DATE,
    })).rejects.toThrow(/different meal or date/i);
    expect((await app.day(DATE)).totals.entryCount).toBe(3);
  });

  it('serializes delete behind an in-flight Health write so no external record is orphaned', async () => {
    let releaseWrite!: () => void;
    const written = new Set<string>();
    const healthPort: HealthPlatformPort = {
      getCapability: () => ({ platform: 'health_connect', available: true, label: 'Health Connect', description: 'Test' }),
      getPermissions: async () => ({ nutritionWrite: true, weightRead: false }),
      requestPermissions: async () => ({ nutritionWrite: true, weightRead: false }),
      writeNutrition: vi.fn(async payload => {
        await new Promise<void>(resolve => { releaseWrite = resolve; });
        const extId = `ext-${payload.entryId}`;
        written.add(extId);
        return { externalRecordId: extId };
      }),
      deleteNutrition: vi.fn(async extId => {
        written.delete(extId);
      }),
      readWeightSamples: async () => [],
    };
    const app = await open(join(directory(), 'user.db'), { healthPort });
    await pack(app);
    await app.updatePreferences({ healthNutritionWriteEnabled: true });
    const egg = (await app.search('egg')).database[0]!.food;

    const pendingConfirm = app.confirm({ food: egg, quantity: { amount: 50, unit: 'g' }, meal: 'Breakfast', date: DATE, idempotencyKey: 'race-del-1' });
    await vi.waitFor(() => expect(healthPort.writeNutrition).toHaveBeenCalledTimes(1));
    const localEntries = (await app.day(DATE)).day?.entries ?? [];
    expect(localEntries).toHaveLength(1);

    // Delete while the Health write is still in flight
    const pendingDelete = app.deleteEntry(localEntries[0]!.id);
    releaseWrite();
    await Promise.all([pendingConfirm, pendingDelete]);

    expect((await app.day(DATE)).totals.entryCount).toBe(0);
    expect(written.size).toBe(0);
  });

  it('derives realistic weekly weight rates for backdated weigh-ins', async () => {
    const app = await open(join(directory(), 'user.db'));
    await app.weighIn(70, '2026-11-01');
    await app.weighIn(71, '2026-11-08');
    const prog = await app.progress(30, '2026-11-08');
    expect(prog.trend).toHaveLength(2);
    const elapsedMs = Date.parse(prog.trend[1]!.weighIn.measured_at) - Date.parse(prog.trend[0]!.weighIn.measured_at);
    expect(Math.round(elapsedMs / 86_400_000)).toBe(7);
  });

  it('keeps the newer Undo action intact when an earlier Health sync completes later', async () => {
    let releaseFirstSync!: () => void;
    let calls = 0;
    const healthPort: HealthPlatformPort = {
      getCapability: () => ({ platform: 'health_connect', available: true, label: 'Health Connect', description: 'Test' }),
      getPermissions: async () => ({ nutritionWrite: true, weightRead: false }),
      requestPermissions: async () => ({ nutritionWrite: true, weightRead: false }),
      writeNutrition: vi.fn(async payload => {
        calls += 1;
        if (calls === 1) {
          await new Promise<void>(resolve => { releaseFirstSync = resolve; });
        }
        return { externalRecordId: `ext-${payload.entryId}` };
      }),
      deleteNutrition: vi.fn(async () => {}),
      readWeightSamples: async () => [],
    };
    const app = await open(join(directory(), 'user.db'), { healthPort });
    await pack(app);
    await app.updatePreferences({ healthNutritionWriteEnabled: true });
    const egg = (await app.search('egg')).database[0]!.food;

    const firstConfirm = app.confirm({ food: egg, quantity: { amount: 50, unit: 'g' }, meal: 'Breakfast', date: DATE, idempotencyKey: 'slow-1' });
    await vi.waitFor(() => expect(calls).toBe(1));
    expect(app.undoAction?.meal).toBe('Breakfast');

    await app.confirm({ food: egg, quantity: { amount: 50, unit: 'g' }, meal: 'Lunch', date: DATE, idempotencyKey: 'fast-2' });
    expect(app.undoAction?.meal).toBe('Lunch');

    releaseFirstSync();
    await firstConfirm;
    // The earlier slow Health sync finishing must NOT overwrite the newer Lunch Undo action
    expect(app.undoAction?.meal).toBe('Lunch');
  });
});
