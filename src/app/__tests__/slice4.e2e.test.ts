import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoodSourceRegistry } from '../../catalog';
import type { AIProvider, MealExtraction } from '../../ai';
import { calculateNutrition, calculateWeightTrend, foodRecordSchema, generateId, sumNutrients } from '../../domain';
import type { DiaryEntrySnapshot } from '../../domain';
import { APP_HEALTH_SOURCE_ID } from '../../health';
import type { ExternalNutritionPayload, ExternalWeightSample, HealthPermissionsState, HealthPlatformPort } from '../../health';
import { DiaryRepo, GoalsRepo, LibraryRepo, migrateDatabase, PacksRepo } from '../../storage';
import { createNodeSqliteDriver } from '../../storage/nodeDriver';
import { AppController, localDate } from '../controller';
import type { ControllerDependencies } from '../controller';

const DATE = '2026-11-23';
const directories: string[] = [];
const controllers = new Set<AppController>();
const food = foodRecordSchema.parse({ id: 'slice4-food', name: 'Oats', basis: 'per_100g',
  prep_state: 'raw', provenance_kind: 'user',
  nutrients: { kcal: 380, protein_g: 12, carbs_g: 60, fat_g: 8, fiber_g: null } });
const extraction: MealExtraction = { items: [{ query: 'Oats', display_name: 'Oats', prep_state: 'raw',
  amount: 100, unit: 'g', portion_certainty: 'estimated', estimate_range: { min_g: 80, max_g: 120 } }], clarifying_questions: [] };
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'oct-slice4-')); directories.push(path); return path;
}
async function open(extra: Partial<ControllerDependencies> = {}, path = join(directory(), 'user.db')) {
  const userDb = createNodeSqliteDriver(path); await migrateDatabase(userDb);
  const app = new AppController({ userDb, catalog: new FoodSourceRegistry(userDb), diary: new DiaryRepo(userDb),
    library: new LibraryRepo(userDb), goals: new GoalsRepo(userDb), packs: new PacksRepo(userDb), ...extra });
  controllers.add(app); return app;
}
async function close(app: AppController) { await app.close(); controllers.delete(app); }
function confirm(app: AppController) {
  return app.confirm({ food, quantity: { amount: 100, unit: 'g' }, meal: 'Lunch', date: DATE, idempotencyKey: generateId() });
}
async function prepareAI(app: AppController) {
  await app.saveCustomFood(food); await app.setAIConsent(true); await app.saveApiKey('sk-slice4-test');
}
async function capture(app: AppController) { return app.captureMealWithAI({ text: 'Oats', meal: 'Lunch', date: DATE }); }
function memoryHealth() {
  const records = new Map<string, ExternalNutritionPayload>();
  let permissions: HealthPermissionsState = { nutritionWrite: false, weightRead: false };
  const samples: ExternalWeightSample[] = [];
  const port: HealthPlatformPort = {
    getCapability: () => ({ available: true, platform: 'health_connect', label: 'Test Health', description: 'In-memory adapter' }),
    getPermissions: async () => ({ ...permissions }),
    requestPermissions: vi.fn(async scopes => {
      permissions = { nutritionWrite: permissions.nutritionWrite || scopes.includes('nutrition_write'),
        weightRead: permissions.weightRead || scopes.includes('weight_read') };
      return { ...permissions };
    }),
    writeNutrition: vi.fn(async (payload, existingExternalId) => {
      const externalRecordId = existingExternalId ?? generateId();
      records.set(externalRecordId, { ...payload }); return { externalRecordId };
    }),
    deleteNutrition: vi.fn(async id => { records.delete(id); }),
    readWeightSamples: vi.fn(async () => samples),
  };
  return { port, records, samples };
}
async function enableHealth(app: AppController) {
  await app.updatePreferences({ healthNutritionWriteEnabled: true, healthWeightReadEnabled: true });
  await app.requestHealthPermissions(['nutrition_write', 'weight_read']);
}
afterEach(async () => {
  for (const app of controllers) await app.close();
  controllers.clear();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Slice 4 against real Node SQLite', () => {
  it('adds water, totals by date, undoes additions/removals and round-trips current and legacy JSON', async () => {
    const app = await open();
    const first = await app.addWater(250, DATE);
    expect(app.undoAction?.label).toBe('Added 250 ml water');
    await app.addWater(500, DATE); await app.addWater(100, '2026-11-22');
    await app.undo(); expect((await app.getDailyWater('2026-11-22')).totalMl).toBe(0);
    expect(await app.getDailyWater(DATE)).toMatchObject({ totalMl: 750, logs: [first, { amount_ml: 500 }] });
    expect(await app.deleteWaterLog(first.id)).toEqual(first);
    expect(app.undoAction?.label).toBe('Water entry removed');
    expect((await app.getDailyWater(DATE)).totalMl).toBe(500);
    await app.undo(); expect((await app.getDailyWater(DATE)).totalMl).toBe(750);
    expect(await app.deleteWaterLog(generateId())).toBeNull();
    const json = await app.exportJson(); expect(app.previewRestore(json).waterLogs).toBe(2);
    const restored = await open(); await restored.restoreJson(json, 'replace');
    expect(await restored.getDailyWater(DATE)).toEqual(await app.getDailyWater(DATE));
    await restored.restoreJson(json, 'merge'); expect((await restored.getDailyWater(DATE)).totalMl).toBe(750);
    const legacy = JSON.parse(json); delete legacy.water_logs;
    expect(restored.previewRestore(JSON.stringify(legacy)).waterLogs).toBe(0);
    await restored.restoreJson(JSON.stringify(legacy), 'replace');
    expect(await restored.getDailyWater(DATE)).toEqual({ totalMl: 0, logs: [] });
    await app.addWater(200); expect((await app.getDailyWater()).logs[0]?.date).toBe(localDate());
    for (const amount of [0, -1, NaN, Infinity]) await expect(app.addWater(amount, DATE)).rejects.toThrow();
    await expect(app.addWater(100, '2026-02-30')).rejects.toThrow();
    await expect(app.getDailyWater('bad-date')).rejects.toThrow();
  });

  it('persists offline photos across reopen, analyzes one through the AI port and deletes it', async () => {
    const path = join(directory(), 'user.db');
    const ai = { completeJson: vi.fn<AIProvider['completeJson']>().mockResolvedValue(extraction) };
    let app = await open({ aiProviderFactory: () => ai }, path);
    const draft = await app.saveOfflinePhotoDraft({ meal: 'Lunch', note: 'Oats', imageDataUrl: 'data:image/jpeg;base64,AA==', date: DATE });
    await close(app); app = await open({ aiProviderFactory: () => ai }, path);
    expect(await app.listOfflinePhotoDrafts()).toEqual([draft]);
    await prepareAI(app);
    const proposal = await app.captureMealWithAI({ text: draft.note, imageDataUrl: draft.image_data_url, meal: draft.meal, date: draft.date });
    expect(proposal.items).toHaveLength(1);
    expect(ai.completeJson).toHaveBeenCalledWith(expect.objectContaining({ imageDataUrl: draft.image_data_url }));
    expect((await app.day(DATE)).totals.entryCount).toBe(0);
    expect(await app.deleteOfflinePhotoDraft(draft.id)).toEqual(draft);
    expect(await app.listOfflinePhotoDrafts()).toEqual([]);
    expect(await app.deleteOfflinePhotoDraft(draft.id)).toBeNull();
  });

  it('recalculates inline AI portions, removes estimation and saves a reusable meal without confirming the draft', async () => {
    const app = await open({ aiProviderFactory: () => ({ completeJson: async () => extraction }) });
    await prepareAI(app);
    expect(() => app.updateDraftItemQuantity(0, { amount: 200, unit: 'g' })).toThrow('No active draft');
    await expect(app.saveActiveDraftAsMeal('Meal')).rejects.toThrow();
    const proposal = await capture(app); expect(proposal.items[0]?.estimate_range).not.toBeNull();
    const revision = app.getRevision(); const quantity = { amount: 200, unit: 'g' };
    app.updateDraftItemQuantity(0, quantity);
    const edited = app.getActiveDraft()!.proposal;
    const nutrients = calculateNutrition(edited.items[0]!.food, quantity);
    expect(edited.items[0]).toMatchObject({ quantity, nutrients, unknownCount: sumNutrients([nutrients]).unknownCount,
      portion_certainty: 'stated', estimate_range: null });
    expect(edited.manual_quantities?.['0']).toEqual(quantity);
    expect(edited.totals).toEqual(sumNutrients([nutrients])); expect(app.getRevision()).toBeGreaterThan(revision);
    for (const index of [-1, 1, 0.5]) expect(() => app.updateDraftItemQuantity(index, quantity)).toThrow();
    for (const amount of [0, -1, NaN, Infinity]) expect(() => app.updateDraftItemQuantity(0, { amount, unit: 'g' })).toThrow();
    await expect(app.saveActiveDraftAsMeal('  ')).rejects.toThrow();
    const meal = await app.saveActiveDraftAsMeal('  Oats bowl  ');
    expect(meal.name).toBe('Oats bowl'); expect(meal.items[0]).toMatchObject({ quantity, food: edited.items[0]!.food });
    expect((await app.day(DATE)).totals.entryCount).toBe(0); expect(app.getActiveDraft()).not.toBeNull();
    const logged = await app.logSavedMeal(meal.id, 'Breakfast', DATE, 'saved-ai-meal');
    expect(logged.nutrients).toEqual(nutrients); expect((await app.day(DATE)).totals.entryCount).toBe(1);
    expect((await app.listSavedMeals())[0]?.use_count).toBe(1);
  });

  it('exports confirmed diary snapshots safely and preserves the EWMA in weight CSV', async () => {
    const app = await open();
    const entry = await app.quickAdd({ kcal: 250, label: '=1+1', meal: '@Lunch', date: DATE, idempotencyKey: 'csv' });
    await app.deps.diary.upsertDraft({ ...entry, id: generateId(), idempotency_key: 'csv-draft', food: { ...entry.food, name: 'Unconfirmed' } });
    const rows = (await app.exportDiaryCsv()).trimEnd().split('\r\n').map(row => row.split(','));
    expect(rows).toHaveLength(2);
    const header = rows[0]!; const values = rows[1]!;
    expect(values[header.indexOf('food_name')]).toBe("'=1+1");
    expect(values[header.indexOf('meal')]).toBe("'@Lunch");
    expect(values[header.indexOf('fiber_g')]).toBe(''); expect(values[header.indexOf('kcal')]).toBe('250');
    for (const [index, weight] of [80, 82, 79].entries()) {
      const date = `2026-11-${21 + index}`;
      await app.deps.goals.recordWeighIn({ id: generateId(), date, measured_at: `${date}T08:00:00Z`,
        weight_kg: weight, source: 'manual', external_source_id: null });
    }
    const trend = calculateWeightTrend(await app.deps.goals.listWeighIns());
    const csv = (await app.exportWeightCsv()).trimEnd().split('\r\n').slice(1).map(row => row.split(','));
    expect(csv.map(row => Number(row[3]))).toEqual(trend.map(point => point.trendKg));
    expect(Number(csv[2]![3])).toBeCloseTo(80.08, 10);
    expect(csv[0]).toEqual(['2026-11-21', '2026-11-21T08:00:00Z', '80', '80', 'manual']);
  });

  it('propagates confirmation, edits, delete and Undo through health and deduplicates external weights', async () => {
    const { port, records, samples } = memoryHealth(); const app = await open({ healthPort: port });
    expect(await app.getHealthStatus()).toMatchObject({ nutritionWriteEnabled: false, weightReadEnabled: false,
      permissions: { nutritionWrite: false, weightRead: false }, capability: { available: true } });
    await enableHealth(app);
    expect(await app.getHealthStatus()).toMatchObject({ nutritionWriteEnabled: true, weightReadEnabled: true,
      permissions: { nutritionWrite: true, weightRead: true } });
    const entry = await confirm(app); const externalId = [...records.keys()][0]!;
    expect(records.get(externalId)).toMatchObject({ entryId: entry.id, kcal: 380, sourceAppId: APP_HEALTH_SOURCE_ID });
    expect(records.get(externalId)).not.toHaveProperty('fiberG');
    const updated = await app.updateEntryQuantity(entry, { amount: 200, unit: 'g' });
    expect([...records.keys()]).toEqual([externalId]); expect(records.get(externalId)?.kcal).toBe(760);
    expect(port.writeNutrition).toHaveBeenLastCalledWith(expect.objectContaining({ entryId: entry.id, kcal: 760 }), externalId);
    await app.undo(); expect(records.get(externalId)?.kcal).toBe(380);
    await app.deleteEntry(updated.id); expect(records.size).toBe(0); expect(port.deleteNutrition).toHaveBeenCalledWith(externalId);
    await app.undo(); expect([...records.values()][0]).toMatchObject({ entryId: entry.id, kcal: 380 });
    const sample = { externalId: 'scale-1', date: DATE, measuredAt: `${DATE}T08:00:00Z`, weightKg: 81 };
    samples.push(sample, { ...sample }, { ...sample, externalId: 'own-echo', sourceAppId: APP_HEALTH_SOURCE_ID });
    const revision = app.getRevision();
    expect(await app.syncWeightFromHealth(DATE)).toEqual({ imported: 1, skippedDuplicates: 1, skippedOwnWrites: 1 });
    expect(port.readWeightSamples).toHaveBeenCalledWith(DATE); expect(app.getRevision()).toBeGreaterThan(revision);
    expect(await app.deps.goals.listWeighIns()).toEqual([expect.objectContaining({ weight_kg: 81, source: 'health_connect', external_source_id: 'scale-1' })]);
    const afterImport = app.getRevision();
    expect(await app.syncWeightFromHealth()).toEqual({ imported: 0, skippedDuplicates: 2, skippedOwnWrites: 1 });
    expect(app.getRevision()).toBe(afterImport);
  });

  it('propagates saved meals, batches, copies, moves and draft confirmations with their Undo actions', async () => {
    const { port, records } = memoryHealth();
    const app = await open({ healthPort: port, aiProviderFactory: () => ({ completeJson: async () => extraction }) });
    await enableHealth(app); await prepareAI(app);
    const entry = await confirm(app); await app.undo(); expect(records.size).toBe(0);
    const original = await confirm(app);
    const meal = await app.saveSavedMeal({ name: 'Bowl', items: [{ food, quantity: { amount: 100, unit: 'g' } }] });
    const saved = await app.logSavedMeal(meal.id, 'Lunch', DATE, 'health-saved');
    expect([...records.values()].some(record => record.entryId === saved.id)).toBe(true);
    await app.undo(); expect(records.size).toBe(1);
    const recipe = await app.saveRecipe({ name: 'Batch', ingredients: meal.items, cooked_weight_g: 100, servings_count: 1 });
    const batch = await app.cookBatch({ recipeId: recipe.id, cooked_weight_g: 100, servings_count: 1 });
    await app.logBatchServing({ batch, recipeName: recipe.name, amount: { mode: 'grams', grams: 50 }, meal: 'Lunch', date: DATE, idempotencyKey: 'health-batch' });
    expect(records.size).toBe(2); await app.undo(); expect(records.size).toBe(1);
    const copies = await app.copyEntries([original.id], '2026-11-24', 'Dinner');
    expect([...records.values()].some(record => record.entryId === copies[0]?.id)).toBe(true);
    await app.undo(); expect(records.size).toBe(1);
    const copiedMeal = await app.copyMeal(DATE, 'Lunch', '2026-11-24', 'Dinner');
    expect(copiedMeal).toHaveLength(1); expect(records.size).toBe(2); await app.undo(); expect(records.size).toBe(1);
    await app.moveEntries([original.id], DATE, 'Snack');
    expect([...records.values()][0]?.meal).toBe('Snack'); await app.undo(); expect([...records.values()][0]?.meal).toBe('Lunch');
    await capture(app); const pending = app.confirmActiveDraft('health-draft');
    expect(() => app.updateDraftItemQuantity(0, { amount: 200, unit: 'g' })).toThrow('being confirmed');
    const confirmed = await pending; expect(records.size).toBe(2);
    expect([...records.values()].some(record => record.entryId === confirmed[0]?.id)).toBe(true);
    await app.undo(); expect(records.size).toBe(1);
    await app.deleteEntries([original.id]); expect(records.size).toBe(0);
    await app.undo(); expect([...records.values()][0]?.entryId).toBe(original.id);
    expect(await app.deps.diary.getEntry(entry.id)).toBeNull();
  });

  it('keeps local diary mutations working when the health adapter fails', async () => {
    const { port } = memoryHealth(); const app = await open({ healthPort: port }); await enableHealth(app);
    vi.mocked(port.writeNutrition).mockRejectedValue(new Error('Health is offline'));
    const entry = await confirm(app); expect(await app.deps.diary.getEntry(entry.id)).toEqual(entry);
    const updated = await app.updateEntryQuantity(entry, { amount: 50, unit: 'g' });
    expect((await app.day(DATE)).totals.nutrients?.kcal).toBe(190);
    vi.mocked(port.writeNutrition).mockImplementation(async () => ({ externalRecordId: 'external-local-test' }));
    await app.updateEntryQuantity(updated, { amount: 100, unit: 'g' });
    vi.mocked(port.deleteNutrition).mockRejectedValue(new Error('Health delete failed'));
    await app.deleteEntry(entry.id); expect(await app.deps.diary.getEntry(entry.id)).toBeNull();
    vi.mocked(port.writeNutrition).mockRejectedValue(new Error('Health restore failed'));
    await app.undo(); expect(await app.deps.diary.getEntry(entry.id)).toMatchObject({ quantity: { amount: 100 } });
    vi.mocked(port.readWeightSamples).mockRejectedValue(new Error('Health read failed'));
    expect(await app.syncWeightFromHealth()).toMatchObject({ imported: 0, error: 'Health read failed' });
  });

  it('persists lead metric and health preferences across reopening while defaults keep health disabled', async () => {
    const path = join(directory(), 'user.db'); let app = await open({}, path);
    expect(await app.getPreferences()).toMatchObject({ leadMetric: 'calories', healthNutritionWriteEnabled: false, healthWeightReadEnabled: false });
    expect((await app.getHealthStatus()).capability).toMatchObject({ available: false, platform: null });
    await app.updatePreferences({ leadMetric: 'water', healthNutritionWriteEnabled: true, healthWeightReadEnabled: true });
    await close(app); app = await open({}, path);
    expect(await app.getPreferences()).toMatchObject({ leadMetric: 'water', healthNutritionWriteEnabled: true, healthWeightReadEnabled: true });
    // A preference alone cannot make an unlinked OS adapter available.
    const entry: DiaryEntrySnapshot = await confirm(app); expect(await app.deps.diary.getEntry(entry.id)).toEqual(entry);
  });

  it('pins and deletes custom foods and saved meals while keeping library pins clean', async () => {
    const app = await open();
    const savedFood = await app.saveCustomFood(food);
    await app.toggleFoodPin(savedFood, true);
    const pinsBefore = await app.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', 'libraryVisualPins');
    expect(JSON.parse(pinsBefore!.value_json)).toHaveLength(1);
    await app.deleteCustomFood(savedFood.id);
    expect(await app.deps.library.getCustomFood(savedFood.id)).toBeNull();
    const pinsAfter = await app.deps.userDb.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', 'libraryVisualPins');
    expect(JSON.parse(pinsAfter!.value_json)).toEqual([]);

    const meal = await app.saveSavedMeal({ name: 'Oats meal', items: [{ food, quantity: { amount: 100, unit: 'g' } }] });
    const mealFood = await app.deps.catalog.getById(null, `meal:${meal.id}`);
    await app.toggleFoodPin(mealFood!, true);
    expect((await app.deps.library.getSavedMeal(meal.id))?.pinned).toBe(true);
    await app.deleteSavedMeal(meal.id);
    expect(await app.deps.library.getSavedMeal(meal.id)).toBeNull();
  });
});
