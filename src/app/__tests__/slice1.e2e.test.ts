import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FoodSourceRegistry } from '../../catalog';
import { calculateNutrition, generateId, nutrientProfileSchema } from '../../domain';
import { DiaryRepo, GoalsRepo, LibraryRepo, migrateDatabase, PacksRepo } from '../../storage';
import { createNodeSqliteDriver } from '../../storage/nodeDriver';
import { AppController, availableUnits } from '../controller';

const PACK1 = resolve('assets/packs/usda-fdc-starter.octpack.sqlite');
const PACK2 = resolve('assets/packs/custom-home-pack.octpack.sqlite');
const DATE = '2026-11-23';
const tempDirs: string[] = [];
const controllers = new Set<AppController>();
async function open(path: string) {
  const userDb = createNodeSqliteDriver(path);
  await migrateDatabase(userDb);
  const controller = new AppController({ userDb, catalog: new FoodSourceRegistry(userDb), diary: new DiaryRepo(userDb),
    goals: new GoalsRepo(userDb), library: new LibraryRepo(userDb), packs: new PacksRepo(userDb) });
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
    await app.setCompleteness(DATE, 'complete');
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
    await app.saveCustomFood({ ...food, id: generateId(), name: 'My oats', source_pack_id: null, source_id: null, source_version: null, provenance_kind: 'user' });
    expect((await app.search('oats')).yours[0]?.food.name).toBe('My oats');
    const targets = { mode: 'maintain' as const, target_kcal: 2000, protein_g: 100, carbs_g: 250, fat_g: 60, fiber_g: 30 };
    await app.saveGoal(targets, '2026-11-22'); await app.saveGoal({ ...targets, target_kcal: 2200 }, DATE);
    await app.saveGoal({ ...targets, target_kcal: 2100 }, DATE);
    expect((await app.day('2026-11-22')).goal?.target_kcal).toBe(2000); expect((await app.day(DATE)).goal?.target_kcal).toBe(2100);
    expect((await app.progress(7, DATE)).averages).toBeNull();
    await app.setCompleteness(DATE, 'complete'); await app.setCompleteness('2026-11-22', 'complete');
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
});
