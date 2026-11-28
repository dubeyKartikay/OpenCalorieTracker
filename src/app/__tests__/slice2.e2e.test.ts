import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FoodSourceRegistry } from '../../catalog';
import { calculateBatchServing, calculateNutrition, calculateRecipeTotal, generateId } from '../../domain';
import type { FoodRecord, TargetInputs } from '../../domain';
import { DiaryRepo, GoalsRepo, LibraryRepo, migrateDatabase, PacksRepo } from '../../storage';
import { createNodeSqliteDriver } from '../../storage/nodeDriver';
import { AppController, availableUnits, estimateTargetPreview, localDate, shiftDate } from '../controller';

const PACK = resolve('assets/packs/usda-fdc-starter.octpack.sqlite');
const HOME_PACK = resolve('assets/packs/custom-home-pack.octpack.sqlite');
const DATE = '2026-11-23';
const goal = { mode: 'maintain' as const, target_kcal: 2200, protein_g: 100, carbs_g: 250, fat_g: 70, fiber_g: 30 };
const directories: string[] = [];
const controllers = new Set<AppController>();
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'oct-slice2-')); directories.push(path); return path;
}
async function open(path = join(directory(), 'user.db')) {
  const userDb = createNodeSqliteDriver(path); await migrateDatabase(userDb);
  const app = new AppController({ userDb, catalog: new FoodSourceRegistry(userDb), diary: new DiaryRepo(userDb),
    library: new LibraryRepo(userDb), goals: new GoalsRepo(userDb), packs: new PacksRepo(userDb) });
  controllers.add(app); return app;
}
async function close(app: AppController) { await app.close(); controllers.delete(app); }
async function pack(app: AppController, path = PACK) {
  await app.installPack(createNodeSqliteDriver(path, { readOnly: true }), path);
}
async function food(app: AppController, query = 'oats') { return (await app.search(query)).database[0]!.food; }
function confirm(app: AppController, item: FoodRecord, amount = 100, unit = 'g', date = DATE) {
  return app.confirm({ food: item, quantity: { amount, unit }, meal: 'Breakfast', date, idempotencyKey: generateId() });
}
function packHash() { return createHash('sha256').update(readFileSync(PACK)).digest('hex'); }
afterEach(async () => {
  for (const app of controllers) await app.close();
  controllers.clear();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Slice 2 against real SQLite and compiled packs', () => {
  it('gates onboarding at 18+, and persists defaults, preferences and the initial goal across reopen', async () => {
    const path = join(directory(), 'user.db'); let app = await open(path);
    expect(await app.getPreferences()).toMatchObject({ onboardingCompleted: false, ageConfirmed18Plus: false,
      energyUnit: 'kcal', weightUnit: 'kg', mealSections: ['Breakfast', 'Lunch', 'Snack', 'Dinner'] });
    await expect(app.completeOnboarding({ ageConfirmed18Plus: false as unknown as true, goal })).rejects.toThrow('18');
    expect(await app.deps.goals.listGoalPeriods()).toEqual([]);
    await app.updatePreferences({ mealSections: ['Brunch', 'Dinner'] });
    await app.completeOnboarding({ ageConfirmed18Plus: true, goal, energyUnit: 'kJ', weightUnit: 'lb' });
    await close(app); app = await open(path);
    expect(await app.getPreferences()).toMatchObject({ onboardingCompleted: true, ageConfirmed18Plus: true,
      energyUnit: 'kJ', weightUnit: 'lb', mealSections: ['Brunch', 'Dinner'] });
    expect((await app.day(localDate())).goal).toMatchObject({ ...goal, effective_from_date: localDate() });
    await app.completeOnboarding({ ageConfirmed18Plus: true, goal: { ...goal, target_kcal: 2300 } });
    expect(await app.deps.goals.listGoalPeriods()).toHaveLength(1);
  });

  it('rolls onboarding and preference writes back together if a later preference write fails', async () => {
    const app = await open();
    await app.deps.userDb.execAsync("CREATE TRIGGER reject_preferences BEFORE INSERT ON preferences WHEN NEW.key='weightUnit' BEGIN SELECT RAISE(ABORT,'preference failure'); END");
    const revision = app.getRevision();
    await expect(app.completeOnboarding({ ageConfirmed18Plus: true, goal })).rejects.toThrow('preference failure');
    expect(await app.deps.goals.listGoalPeriods()).toEqual([]);
    expect(await app.deps.userDb.getAllAsync('SELECT * FROM preferences')).toEqual([]);
    expect(app.getRevision()).toBe(revision);
    await app.deps.userDb.execAsync('DROP TRIGGER reject_preferences');
    await expect(app.updatePreferences({ mealSections: [] })).rejects.toThrow();
    expect((await app.getPreferences()).onboardingCompleted).toBe(false);
  });

  it('shares the documented Mifflin–St Jeor floor and body-weight rate cap', async () => {
    const app = await open();
    const input: TargetInputs = { adultConfirmed: true, ageYears: 30, weightKg: 80, heightCm: 180,
      equationCoefficient: 5, activityFactor: 1.2, activityAssumption: 'Sedentary', mode: 'lose', weeklyRateKg: 2 };
    const estimate = estimateTargetPreview(input);
    expect(app.estimateTargetPreview(input)).toEqual(estimate);
    expect(estimate.appliedWeeklyRateKg).toBe(0.8);
    expect(estimate.targetKcal).toBe(1500);
    expect(estimate.breakdown.policy).toMatchObject({ minimumKcal: 1500, maxWeeklyRateKg: 0.8, kcalPerKg: 7700 });
    expect(estimate.notices).toHaveLength(2);
    expect(estimateTargetPreview({ ...input, mode: 'observe' }).targetKcal).toBeNull();
    expect(() => estimateTargetPreview({ ...input, ageYears: 17 })).toThrow();
  });

  it('quick-adds calories and optional macros with unknown fiber, idempotency and Undo', async () => {
    const app = await open();
    const first = await app.quickAdd({ kcal: 300, proteinG: 20, carbsG: 25, fatG: 10,
      label: 'Lunch estimate', meal: 'Lunch', date: DATE, idempotencyKey: 'quick-lunch' });
    expect(first.food.provenance_kind).toBe('user');
    expect(first.nutrients).toMatchObject({ kcal: 300, protein_g: 20, carbs_g: 25, fat_g: 10, fiber_g: null });
    expect(first.food.nutrients.fiber_g).toBeNull();
    expect((await app.day(DATE)).totals.unknownCount.fiber_g).toBe(1);
    expect(await app.quickAdd({ kcal: 999, meal: 'Dinner', date: DATE, idempotencyKey: 'quick-lunch' })).toEqual(first);
    expect((await app.day(DATE)).totals.entryCount).toBe(1);
    await app.undo(); expect(await app.deps.diary.getEntry(first.id)).toBeNull();
    const caloriesOnly = await app.quickAdd({ kcal: 100, proteinG: null, meal: 'Snack', date: DATE, idempotencyKey: 'quick-snack' });
    expect(caloriesOnly.nutrients).toMatchObject({ kcal: 100, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: null });
    await expect(app.quickAdd({ kcal: -1, meal: 'Snack', idempotencyKey: 'invalid' })).rejects.toThrow();
    await app.undo(); expect((await app.day(DATE)).totals.entryCount).toBe(0);
  });

  it('attaches personal units to read-only pack foods and learns the top three portions exactly once per confirmation', async () => {
    const path = join(directory(), 'user.db'); let app = await open(path); await pack(app);
    const hash = packHash(); const oats = await food(app);
    await app.savePersonalUnit(oats, { label: 'katori', grams: 150, ml: null });
    const personal = await food(app); expect(availableUnits(personal)).toContain('katori');
    expect(personal.units.find(unit => unit.label === 'katori')?.grams).toBe(150);
    const first = await confirm(app, personal, 1, 'katori');
    expect(first.nutrients).toEqual(calculateNutrition(oats, { amount: 150, unit: 'g' }));
    await app.confirm({ food: personal, quantity: first.quantity, meal: 'Breakfast', date: DATE, idempotencyKey: first.idempotency_key });
    await confirm(app, personal, 1, 'katori'); await confirm(app, personal, 1, 'katori');
    for (const grams of [50, 75, 100]) await confirm(app, personal, grams);
    const learned = await app.getLearnedPortions(oats);
    expect(learned).toHaveLength(3);
    expect(learned[0]).toMatchObject({ amount: 1, unit: 'katori', useCount: 3 });
    expect(learned[0]?.lastUsedAt).toBeTruthy();
    await app.deleteEntry(first.id); await app.undo();
    expect((await app.getLearnedPortions(oats))[0]?.useCount).toBe(3);
    await close(app); app = await open(path); await pack(app);
    expect((await app.getLearnedPortions(oats))[0]?.useCount).toBe(3);
    expect(availableUnits(await food(app))).toContain('katori');
    await app.deletePersonalUnit(oats, 'katori'); expect(availableUnits(await food(app))).not.toContain('katori');
    expect(packHash()).toBe(hash);
    expect(await app.deps.diary.getEntry(first.id)).toEqual(first);
  });

  it('falls back to real pack/custom quick picks, then ranks pinned and most-used saved meals', async () => {
    const app = await open(); expect(await app.getTodaySuggestions()).toEqual([]);
    await pack(app); const picks = await app.getTodaySuggestions();
    expect(picks).toHaveLength(3);
    for (const pick of picks) {
      expect(pick.kind).toBe('food');
      if (pick.kind === 'food') expect(await app.deps.catalog.getById(pick.food.source_pack_id, pick.food.id)).not.toBeNull();
    }
    const oats = await food(app);
    const custom = await app.saveCustomFood({ ...oats, id: generateId(), name: 'My bowl', provenance_kind: 'user', source_pack_id: null, source_id: null, source_version: null });
    expect((await app.getTodaySuggestions(1))[0]).toMatchObject({ kind: 'food', food: { id: custom.id } });
    const items = [{ food: oats, quantity: { amount: 100, unit: 'g' } }];
    const frequent = await app.saveSavedMeal({ name: 'Oat breakfast', items });
    const pinned = await app.saveSavedMeal({ name: 'Pinned bowl', items });
    await app.logSavedMeal(frequent.id, 'Breakfast', DATE, 'frequent-1');
    await app.toggleSavedMealPinned(pinned.id, true);
    expect((await app.getTodaySuggestions()).map(item => item.id)).toEqual([pinned.id, frequent.id]);
    expect((await app.getTodaySuggestions())[0]?.kind).toBe('saved_meal');
    await app.toggleSavedMealPinned(pinned.id, false);
    expect((await app.getTodaySuggestions(1))[0]?.id).toBe(frequent.id);
    const renamed = await app.saveSavedMeal({ id: frequent.id, name: 'Renamed bowl', items });
    expect(renamed.use_count).toBe(1); expect(await app.listSavedMeals()).toHaveLength(2);
    expect((await app.logSavedMeal(frequent.id, 'Snack', 'saved-today')).date).toBe(localDate());
    expect(await app.getTodaySuggestions(0)).toEqual([]);
    await expect(app.getTodaySuggestions(-1)).rejects.toThrow();
  });

  it('logs saved meals with composite unknown counts, idempotent usage tracking and frozen quantity edits', async () => {
    const app = await open(); await pack(app); await pack(app, HOME_PACK);
    const oats = await food(app); const dal = await food(app, 'arhar dal');
    expect(dal.nutrients.fiber_g).toBeNull();
    const items = [{ food: oats, quantity: { amount: 100, unit: 'g' } }, { food: dal, quantity: { amount: 100, unit: 'g' } }];
    const saved = await app.saveSavedMeal({ name: 'Dal and oats', items });
    const entry = await app.logSavedMeal(saved.id, 'Dinner', DATE, 'saved-dinner');
    const total = calculateRecipeTotal(items);
    expect(entry.nutrients).toEqual(total.nutrients);
    expect(entry.unknown_nutrient_counts).toEqual(total.unknownCount);
    expect(entry.nutrients.fiber_g).toBeGreaterThan(0); expect(entry.unknown_nutrient_counts?.fiber_g).toBe(1);
    expect(await app.logSavedMeal(saved.id, 'Lunch', DATE, 'saved-dinner')).toEqual(entry);
    expect((await app.listSavedMeals())[0]?.use_count).toBe(1);
    await app.undo(); expect(await app.deps.diary.getEntry(entry.id)).toBeNull();
    await app.deps.diary.restoreEntry(entry);
    await app.saveSavedMeal({ id: saved.id, name: 'Changed meal', items: [{ food: oats, quantity: { amount: 1, unit: 'g' } }] });
    const updated = await app.updateEntryQuantity(entry, { amount: 0.5, unit: 'serving' });
    expect(updated.nutrients.kcal).toBe(entry.nutrients.kcal / 2);
    expect(updated.unknown_nutrient_counts).toEqual(entry.unknown_nutrient_counts);
    expect((await app.day(DATE)).totals.unknownCount.fiber_g).toBe(1);
    await app.undo(); expect(await app.deps.diary.getEntry(entry.id)).toEqual(entry);
  });

  it('versions recipes, freezes overridden cooked batches and 150 g logs through subsequent recipe edits and reopen', async () => {
    const path = join(directory(), 'user.db'); let app = await open(path); await pack(app); await pack(app, HOME_PACK);
    const dal = await food(app, 'arhar dal'); const oats = await food(app);
    const ingredients = [{ food: dal, quantity: { amount: 500, unit: 'g' } }, { food: oats, quantity: { amount: 100, unit: 'g' } }];
    const recipe = await app.saveRecipe({ name: 'Dal tadka', ingredients, cooked_weight_g: 1000, servings_count: 6 });
    expect(recipe.version).toBe(1);
    const edited = await app.saveRecipe({ ...recipe, notes: 'More dal', ingredients: [{ food: dal, quantity: { amount: 600, unit: 'g' } }] });
    expect(edited.version).toBe(2); expect(await app.getRecipe(recipe.id)).toEqual(edited);
    expect(await app.listRecipes()).toEqual([edited]);
    expect(app.previewRecipeTotals(ingredients)).toEqual(calculateRecipeTotal(ingredients));
    const batch = await app.cookBatch({ recipeId: recipe.id, ingredients, cooked_weight_g: 1180, servings_count: 6, notes: 'Actual yield' });
    expect(batch).toMatchObject({ recipe_version: 2, ingredients, cooked_weight_g: 1180 });
    expect(await app.listBatches(recipe.id)).toEqual([batch]);
    const amount = { mode: 'grams' as const, grams: 150 };
    const expected = calculateBatchServing(batch, { grams: 150 });
    expect(app.previewBatchServing(batch, amount)).toEqual(expected);
    const entry = await app.logBatchServing({ batch, recipeName: recipe.name, amount, meal: 'Lunch', date: DATE, idempotencyKey: 'batch-lunch' });
    expect(entry.nutrients).toEqual(expected.nutrients); expect(entry.unknown_nutrient_counts).toEqual(expected.unknownCount);
    expect(entry.provenance_kind).toBe('recipe_batch'); expect(entry.food.source_version).toBe('2');
    await app.undo(); expect(await app.deps.diary.getEntry(entry.id)).toBeNull(); await app.deps.diary.restoreEntry(entry);
    await app.saveRecipe({ ...edited, ingredients: [{ food: oats, quantity: { amount: 1, unit: 'g' } }], cooked_weight_g: 20 });
    expect((await app.getRecipe(recipe.id))?.version).toBe(3);
    expect(await app.getBatch(batch.id)).toEqual(batch); expect(await app.deps.diary.getEntry(entry.id)).toEqual(entry);
    const updated = await app.updateEntryQuantity(entry, { amount: 300, unit: 'g' });
    expect(updated.nutrients.kcal).toBeCloseTo(entry.nutrients.kcal * 2, 10);
    expect(updated.unknown_nutrient_counts).toEqual(expected.unknownCount);
    await app.undo();
    await close(app); app = await open(path);
    expect(await app.getBatch(batch.id)).toEqual(batch); expect(await app.deps.diary.getEntry(entry.id)).toEqual(entry);
    const fraction = await app.logBatchServing({ batch, recipeName: 'Dal tadka', amount: { mode: 'fraction', fraction: 0.25 }, meal: 'Dinner', date: DATE, idempotencyKey: 'batch-quarter' });
    expect(fraction.nutrients).toEqual(calculateBatchServing(batch, { fraction: 0.25 }).nutrients);
    expect(() => app.previewBatchServing(batch, { mode: 'fraction', fraction: 1.1 })).toThrow();
  });

  it('cooks from the current recipe by default and validates missing yields and invalid portions', async () => {
    const app = await open(); await pack(app); const oats = await food(app);
    const recipe = await app.saveRecipe({ name: 'Unweighed bowl', ingredients: [{ food: oats, quantity: { amount: 100, unit: 'g' } }], cooked_weight_g: null, servings_count: 2 });
    const batch = await app.cookBatch({ recipeId: recipe.id, cooked_weight_g: null, servings_count: 2 });
    expect(batch.ingredients).toEqual(recipe.ingredients);
    expect(() => app.previewBatchServing(batch, { mode: 'grams', grams: 150 })).toThrow('weight');
    await expect(app.logBatchServing({ batch, recipeName: recipe.name, amount: { mode: 'fraction', fraction: 0 }, meal: 'Lunch', idempotencyKey: 'zero' })).rejects.toThrow();
    await expect(app.cookBatch({ recipeId: generateId(), cooked_weight_g: 100, servings_count: 1 })).rejects.toThrow('not found');
    expect(await app.getBatch(generateId())).toBeNull();
  });

  it('summarizes seven days with historical targets, empty days, completeness and confirmed entries only', async () => {
    const app = await open(); await pack(app); const oats = await food(app);
    await app.saveGoal({ ...goal, target_kcal: 2000 }, shiftDate(DATE, -6));
    await app.saveGoal(goal, DATE);
    const entry = await confirm(app, oats, 100);
    await app.deps.diary.upsertDraft({ ...entry, id: generateId(), idempotency_key: generateId() });
    const week = await app.getWeekSummary(DATE);
    expect(week).toHaveLength(7);
    expect(week[0]).toEqual({ date: shiftDate(DATE, -6), completeness: 'none', kcal: null, entryCount: 0, targetKcal: 2000 });
    expect(week[6]).toEqual({ date: DATE, completeness: 'complete', kcal: entry.nutrients.kcal, entryCount: 1, targetKcal: 2200 });
    expect(week[5]?.targetKcal).toBe(2000);
    expect((await app.getWeekSummary())[6]?.date).toBe(localDate());
  });

  it('copies confirmed meal snapshots to Today and supports atomic batch delete/Undo, move/Undo and quantity edits', async () => {
    const app = await open(); await pack(app); const oats = await food(app);
    const yesterday = shiftDate(localDate(), -1);
    const originals = [await confirm(app, oats, 100, 'g', yesterday), await confirm(app, oats, 50, 'g', yesterday)];
    await app.deps.diary.upsertDraft({ ...originals[0]!, id: generateId(), idempotency_key: generateId() });
    const copies = await app.copyMeal(yesterday, 'Breakfast', localDate(), 'Brunch');
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(originals.some(item => item.id === copy.id || item.idempotency_key === copy.idempotency_key)).toBe(false);
      expect(copy).toMatchObject({ date: localDate(), meal: 'Brunch', food: oats });
    }
    expect(copies.map(item => item.nutrients.kcal).sort()).toEqual(originals.map(item => item.nutrients.kcal).sort());
    await app.undo(); expect((await app.day(localDate())).totals.entryCount).toBe(0);
    const again = await app.copyMeal(yesterday, 'Breakfast', localDate(), 'Brunch'); const ids = again.map(item => item.id);
    const learnedBefore = await app.getLearnedPortions(oats);
    await app.deleteEntries([...ids, ids[0]!]); expect((await app.day(localDate())).totals.entryCount).toBe(0);
    await app.undo(); expect((await app.day(localDate())).day?.entries).toEqual(again);
    expect(await app.getLearnedPortions(oats)).toEqual(learnedBefore);
    const moved = await app.moveEntries(ids, shiftDate(localDate(), 1), 'Dinner');
    expect(moved.every(entry => entry.meal === 'Dinner' && entry.date === shiftDate(localDate(), 1))).toBe(true);
    expect((await app.day(localDate())).totals.entryCount).toBe(0);
    await app.undo(); expect((await app.day(localDate())).day?.entries).toEqual(again);
    const updated = await app.updateEntryQuantity(again[0]!, { amount: 200, unit: 'g' });
    expect(updated.nutrients).toEqual(calculateNutrition(oats, { amount: 200, unit: 'g' }));
    expect(updated.id).toBe(again[0]!.id); expect(updated.idempotency_key).toBe(again[0]!.idempotency_key);
    await expect(app.updateEntryQuantity(updated, { amount: -1, unit: 'g' })).rejects.toThrow();
    expect(await app.deps.diary.getEntry(updated.id)).toEqual(updated);
    await app.undo(); expect(await app.deps.diary.getEntry(updated.id)).toEqual(again[0]);
  });

  it('rolls multi-entry deletes and moves back on a later failure and leaves Undo unchanged', async () => {
    const app = await open(); await pack(app); const oats = await food(app);
    const first = await confirm(app, oats); const second = await confirm(app, oats, 50);
    const undo = app.undoAction; const revision = app.getRevision();
    await app.deps.userDb.execAsync(`CREATE TRIGGER reject_delete BEFORE DELETE ON diary_entries WHEN OLD.id='${second.id}' BEGIN SELECT RAISE(ABORT,'delete failure'); END`);
    await expect(app.deleteEntries([first.id, second.id])).rejects.toThrow('delete failure');
    expect(await app.deps.diary.getEntry(first.id)).toEqual(first); expect(await app.deps.diary.getEntry(second.id)).toEqual(second);
    expect(app.undoAction).toBe(undo); expect(app.getRevision()).toBe(revision);
    await expect(app.moveEntries([first.id, generateId()], shiftDate(DATE, 1), 'Dinner')).rejects.toThrow('not found');
    expect(await app.deps.diary.getEntry(first.id)).toEqual(first); expect(app.undoAction).toBe(undo);
  });
});
