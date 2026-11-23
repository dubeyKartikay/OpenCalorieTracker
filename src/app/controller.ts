import { z } from 'zod';
import { calculateBatchServing, calculateNutrition, calculateRecipeTotal, calculateWeightTrend, estimateDailyTarget, exportBundleV1Schema, foodRecordSchema, generateId, getActiveGoalForDate, isoDateSchema, nutrientKeys, resolveQuantityToBasis, scaleNutrients, sumNutrients } from '../domain';
import type { DiaryDay, DiaryEntrySnapshot, FoodRecord, FoodUnit, GoalPeriod, NutrientAggregate, Quantity, RecipeBatch, RecipeIngredient, TargetInputs } from '../domain';
import { UserLibraryAdapter, validatePackDatabase } from '../catalog';
import type { FoodSourceRegistry } from '../catalog';
import { DiaryRepo, GoalsRepo, LibraryRepo, exportBundleV1, foodKey, restoreBundleV1 } from '../storage';
import type { PacksRepo, SavedMeal, SqlDatabase } from '../storage';
import { BarcodeResolver, parseNutritionLabelText } from '../barcode';
import type { BarcodeResolution } from '../barcode';
import { AIError, OpenAIResponsesProvider, applyClarifyingAnswer, buildAuthorizationUrl, captureMealDraft, exchangeAuthorizationCode, extractNutritionLabel, generatePkcePair } from '../ai';
import type { AIAuthMode, AIProvider, LoopbackAuthPort, MealDraftProposal, NutritionLabelExtraction } from '../ai';
import { createMemoryCredentialStore, maskSecretKey } from './credentials';
import type { CredentialStore } from './credentials';

export const MEALS = ['Breakfast', 'Lunch', 'Snack', 'Dinner'] as const;
export type Meal = typeof MEALS[number];
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDate(value);
}
export function defaultQuantity(food: FoodRecord): Quantity {
  return food.basis === 'per_serving' ? { amount: 1, unit: 'serving' }
    : food.serving_g !== null ? { amount: food.serving_g, unit: 'g' }
      : food.serving_ml !== null ? { amount: food.serving_ml, unit: 'ml' }
        : { amount: 100, unit: food.basis === 'per_100ml' ? 'ml' : 'g' };
}
export function availableUnits(food: FoodRecord) {
  return [...new Set(['g', 'oz', 'ml', 'serving', ...food.units.map(unit => unit.label)])].filter(unit => {
    try { resolveQuantityToBasis(food, { amount: 1, unit }); return true; } catch { return false; }
  });
}
export const sourceLabel = (food: FoodRecord) => food.source_pack_id ?? (food.provenance_kind === 'user' ? 'Yours' : 'Custom');

export interface ControllerDependencies {
  userDb: SqlDatabase; catalog: FoodSourceRegistry; diary: DiaryRepo;
  library: LibraryRepo; goals: GoalsRepo; packs: PacksRepo;
  offCacheDb?: SqlDatabase | null;
  barcodeResolver?: BarcodeResolver;
  credentials?: CredentialStore;
  aiProviderFactory?: (token: string, mode: 'chatgpt_oauth' | 'api_key') => AIProvider;
  loopbackAuth?: LoopbackAuthPort | null;
}
export interface UndoAction { label: string; run: () => Promise<void> }

const preferencesSchema = z.strictObject({
  onboardingCompleted: z.boolean().default(false), ageConfirmed18Plus: z.boolean().default(false),
  energyUnit: z.enum(['kcal', 'kJ']).default('kcal'), weightUnit: z.enum(['kg', 'lb']).default('kg'),
  mealSections: z.array(z.string().trim().min(1)).min(1).default(() => [...MEALS]),
  allowLiveOffLookup: z.boolean().default(false), aiModel: z.string().trim().min(1).default('gpt-5-mini'),
  aiConsentAccepted: z.boolean().default(false),
});
export type AppPreferences = z.infer<typeof preferencesSchema>;
export type BatchServingAmount = { mode: 'grams'; grams: number } | { mode: 'fraction'; fraction: number };
export type TodaySuggestion = { kind: 'saved_meal'; id: string; name: string; savedMeal: SavedMeal }
  | { kind: 'food'; id: string; name: string; food: FoodRecord };

/** Starter Mifflin–St Jeor preview shared by Onboarding and Settings.
 * Product policy: 1,500 kcal/day floor, 1% current body weight/week cap,
 * and 7,700 kcal/kg for the estimated adjustment; manual goals remain available.
 * These are explicit starter defaults, not personalized clinical guidance.
 */
export function estimateTargetPreview(input: TargetInputs) {
  return estimateDailyTarget(input, {
    minimumKcal: 1500, maxWeeklyRateKg: input.weightKg * 0.01, kcalPerKg: 7700,
    rationale: 'Starter Settings estimate: 1500 kcal floor and 1% body weight per week cap.',
    source: 'OpenCalorieTracker Doop Settings · estimate product policy; equation: https://pubmed.ncbi.nlm.nih.gov/2305711/',
  });
}

async function readPreferences(db: SqlDatabase): Promise<AppPreferences> {
  const rows = await db.getAllAsync<{ key: string; value_json: string }>('SELECT key,value_json FROM preferences');
  const values = Object.fromEntries(rows.filter(row => row.key in preferencesSchema.shape).map(row => [row.key, JSON.parse(row.value_json)]));
  return preferencesSchema.parse(values);
}
async function writePreferences(db: SqlDatabase, patch: Partial<AppPreferences>) {
  const preferences = preferencesSchema.parse({ ...await readPreferences(db), ...patch });
  for (const [key, value] of Object.entries(preferences)) {
    await db.runAsync('INSERT INTO preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', key, JSON.stringify(value), new Date().toISOString());
  }
  return preferences;
}

/** No platform imports: the same controller runs against Expo and real Node SQLite. */
export class AppController {
  readonly deps: ControllerDependencies;
  private listeners = new Set<() => void>();
  private revision = 0;
  private foodCounts = new Map<string, number>();
  private readonly barcodeResolver: BarcodeResolver;
  private readonly credentials: CredentialStore;
  private activeDraft: { proposal: MealDraftProposal; meal: string; date: string } | null = null;
  private draftGeneration = 0;
  private confirmingDraft: Promise<DiaryEntrySnapshot[]> | null = null;
  undoAction: UndoAction | null = null;
  constructor(deps: ControllerDependencies) {
    this.deps = deps;
    this.credentials = deps.credentials ?? createMemoryCredentialStore();
    this.barcodeResolver = deps.barcodeResolver ?? new BarcodeResolver({ catalog: deps.catalog,
      offCacheDb: deps.offCacheDb ?? null, getAllowLiveOffLookup: () => this.getPreferences().then(p => p.allowLiveOffLookup) });
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getRevision = () => this.revision;
  refresh = () => { this.revision++; this.listeners.forEach(listener => listener()); };
  dismissUndo = () => { this.undoAction = null; this.refresh(); };
  async undo() {
    const action = this.undoAction;
    if (!action) return;
    await action.run();
    if (this.undoAction === action) this.undoAction = null;
    this.refresh();
  }
  search(query: string) { return this.deps.catalog.search(query); }
  async preview(food: FoodRecord, quantity: Quantity) {
    if (!food.source_pack_id && /^(recipe:|meal:)/.test(food.id)) {
      return this.deps.catalog.userLibrary.getNutritionForQuantity(food.id, quantity);
    }
    return sumNutrients([calculateNutrition(food, quantity)]);
  }
  private snapshot(input: { food: FoodRecord; quantity: Quantity; meal: string; date?: string; idempotencyKey: string }, preview: NutrientAggregate): DiaryEntrySnapshot {
    if (input.quantity.amount <= 0) throw new Error('Enter an amount greater than zero');
    if (!preview?.nutrients) throw new Error('This portion has no nutrition');
    return {
      id: generateId(), idempotency_key: input.idempotencyKey, date: input.date ?? localDate(),
      occurred_at: new Date().toISOString(), time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      meal: input.meal, food: input.food, quantity: input.quantity, nutrients: preview.nutrients,
      unknown_nutrient_counts: preview.unknownCount, provenance_kind: input.food.provenance_kind,
      portion_certainty: 'stated', estimate_range: null, draft_state: 'confirmed',
    };
  }
  private added(entry: DiaryEntrySnapshot) {
    this.undoAction = { label: `Added to ${entry.meal}`, run: async () => { await this.deps.diary.deleteEntry(entry.id); } };
    this.refresh();
    return entry;
  }
  async confirm(input: { food: FoodRecord; quantity: Quantity; meal: string; date?: string; idempotencyKey: string }) {
    const preview = await this.preview(input.food, input.quantity);
    if (!preview) throw new Error('This portion has no nutrition');
    return this.added(await this.deps.diary.confirmEntry(this.snapshot(input, preview)));
  }
  getPreferences() { return readPreferences(this.deps.userDb); }
  async updatePreferences(patch: Partial<AppPreferences>) {
    const value = await this.deps.userDb.withTransactionAsync(tx => writePreferences(tx, patch));
    this.refresh(); return value;
  }
  async completeOnboarding(input: { ageConfirmed18Plus: true; goal: Omit<GoalPeriod, 'id' | 'effective_from_date'>; energyUnit?: AppPreferences['energyUnit']; weightUnit?: AppPreferences['weightUnit'] }) {
    if (input.ageConfirmed18Plus !== true) throw new Error('You must confirm you are 18 or older');
    const preferences = await this.deps.userDb.withTransactionAsync(async tx => {
      const goals = new GoalsRepo(tx);
      const date = localDate();
      const existing = (await goals.listGoalPeriods()).find(goal => goal.effective_from_date === date);
      await goals.upsertGoalPeriod({ ...input.goal, id: existing?.id ?? generateId(), effective_from_date: date });
      return writePreferences(tx, { onboardingCompleted: true, ageConfirmed18Plus: true,
        ...(input.energyUnit === undefined ? {} : { energyUnit: input.energyUnit }),
        ...(input.weightUnit === undefined ? {} : { weightUnit: input.weightUnit }) });
    });
    this.refresh(); return preferences;
  }
  estimateTargetPreview(input: TargetInputs) { return estimateTargetPreview(input); }
  async quickAdd(input: { kcal: number; proteinG?: number | null; carbsG?: number | null; fatG?: number | null; label?: string; meal: string; date?: string; idempotencyKey: string }) {
    // V1 requires numeric macros; omitted macros use zero, while optional fiber stays unknown.
    const food = foodRecordSchema.parse({ id: generateId(), name: input.label ?? 'Quick add',
      prep_state: 'unknown', basis: 'per_serving', provenance_kind: 'user',
      nutrients: { kcal: input.kcal, protein_g: input.proteinG ?? 0, carbs_g: input.carbsG ?? 0, fat_g: input.fatG ?? 0, fiber_g: null } });
    return this.confirm({ ...input, food, quantity: { amount: 1, unit: 'serving' } });
  }
  listSavedMeals() { return this.deps.library.listSavedMeals(); }
  async saveSavedMeal(input: { id?: string; name: string; items: RecipeIngredient[]; pinned?: boolean }) {
    const meal = await this.deps.userDb.withTransactionAsync(async tx => {
      const library = new LibraryRepo(tx);
      const old = input.id ? await library.getSavedMeal(input.id) : null;
      return library.upsertSavedMeal({ id: input.id ?? generateId(), name: input.name, items: input.items,
        pinned: input.pinned ?? old?.pinned ?? false, use_count: old?.use_count ?? 0, last_used_at: old?.last_used_at ?? null });
    });
    this.refresh(); return meal;
  }
  async toggleSavedMealPinned(id: string, pinned: boolean) {
    const meal = await this.deps.userDb.withTransactionAsync(async tx => {
      const library = new LibraryRepo(tx); const old = await library.getSavedMeal(id);
      if (!old) throw new Error('Saved meal not found');
      return library.upsertSavedMeal({ ...old, pinned });
    });
    this.refresh(); return meal;
  }
  logSavedMeal(savedMealId: string, meal: string, idempotencyKey: string): Promise<DiaryEntrySnapshot>;
  logSavedMeal(savedMealId: string, meal: string, date: string | undefined, idempotencyKey: string): Promise<DiaryEntrySnapshot>;
  async logSavedMeal(savedMealId: string, meal: string, dateOrKey: string | undefined, key?: string) {
    const date = key === undefined ? undefined : dateOrKey;
    const idempotencyKey = key ?? dateOrKey;
    if (idempotencyKey === undefined) throw new Error('An idempotency key is required');
    const entry = await this.deps.userDb.withTransactionAsync(async tx => {
      const library = new LibraryRepo(tx); const saved = await library.getSavedMeal(savedMealId);
      if (!saved) throw new Error('Saved meal not found');
      const adapter = new UserLibraryAdapter(tx); const id = `meal:${savedMealId}`;
      const quantity = { amount: 1, unit: 'serving' };
      const food = await adapter.getById(id); const preview = await adapter.getNutritionForQuantity(id, quantity);
      if (!food || !preview) throw new Error('Saved meal not found');
      const candidate = this.snapshot({ food, quantity, meal, ...(date === undefined ? {} : { date }), idempotencyKey }, preview);
      const confirmed = await new DiaryRepo(tx).confirmEntry(candidate);
      if (confirmed.id === candidate.id) await library.upsertSavedMeal({ ...saved, use_count: saved.use_count + 1, last_used_at: confirmed.occurred_at });
      return confirmed;
    });
    return this.added(entry);
  }
  async getTodaySuggestions(limit = 3): Promise<TodaySuggestion[]> {
    if (!Number.isInteger(limit) || limit < 0) throw new Error('Suggestion limit must be a nonnegative integer');
    if (limit === 0) return [];
    const meals = await this.listSavedMeals();
    if (meals.length) return meals.slice(0, limit).map(savedMeal => ({ kind: 'saved_meal', id: savedMeal.id, name: savedMeal.name, savedMeal }));
    const custom = await this.deps.library.listCustomFoods();
    const foods: FoodRecord[] = [];
    for (const item of custom.slice(0, limit)) foods.push(await this.deps.catalog.getById(null, item.id) ?? item);
    if (foods.length < limit) {
      // Fetch enough candidates to replace pantry ingredients and drinks with useful meal picks.
      const { database } = await this.deps.catalog.search('a b c d e f g h i j k l m n o p q r s t u v w x y z 0 1 2 3 4 5 6 7 8 9', { limit: Math.max(50, limit * 5) });
      const mealFoods = database.map(item => item.food).filter(food =>
        (food.nutrients.kcal ?? 0) >= 40
        && !/oil|fat|condiment|spice|beverage|drink|water/i.test(food.category ?? '')
        && !/\b(oil|butter|ghee|salt|water|coffee|tea)\b/i.test(food.name));
      foods.push(...mealFoods.slice(0, limit - foods.length));
    }
    return foods.map(food => ({ kind: 'food', id: food.id, name: food.name, food }));
  }
  async getLearnedPortions(food: FoodRecord) {
    return (await this.deps.library.listLearnedPortions(foodKey(food))).slice(0, 3)
      .map(({ amount, unit, use_count, last_used_at }) => ({ amount, unit, useCount: use_count, lastUsedAt: last_used_at }));
  }
  async savePersonalUnit(food: FoodRecord, unit: FoodUnit) {
    await this.deps.library.upsertUserFoodUnit(foodKey(food), unit); this.refresh();
  }
  async deletePersonalUnit(food: FoodRecord, label: string) {
    await this.deps.library.deleteUserFoodUnit(foodKey(food), label); this.refresh();
  }
  listRecipes() { return this.deps.library.listRecipes(); }
  getRecipe(id: string) { return this.deps.library.getRecipe(id); }
  async saveRecipe(input: { id?: string; name: string; ingredients: RecipeIngredient[]; cooked_weight_g: number | null; servings_count: number | null; notes?: string | null }) {
    const recipe = await this.deps.library.upsertRecipe({ ...input, id: input.id ?? generateId(), version: 1, notes: input.notes ?? null });
    this.refresh(); return recipe;
  }
  previewRecipeTotals(ingredients: RecipeIngredient[]) { return calculateRecipeTotal(ingredients); }
  listBatches(recipeId: string) { return this.deps.library.listRecipeBatches(recipeId); }
  getBatch(batchId: string) { return this.deps.library.getRecipeBatch(batchId); }
  async cookBatch(input: { recipeId: string; ingredients?: RecipeIngredient[]; cooked_weight_g: number | null; servings_count: number | null; notes?: string | null }) {
    const batch = await this.deps.userDb.withTransactionAsync(async tx => {
      const library = new LibraryRepo(tx); const recipe = await library.getRecipe(input.recipeId);
      if (!recipe) throw new Error('Recipe not found');
      return library.upsertRecipeBatch({ id: generateId(), recipe_id: recipe.id, recipe_version: recipe.version,
        created_at: new Date().toISOString(), ingredients: input.ingredients ?? recipe.ingredients,
        cooked_weight_g: input.cooked_weight_g, servings_count: input.servings_count, notes: input.notes === undefined ? recipe.notes : input.notes });
    });
    this.refresh(); return batch;
  }
  previewBatchServing(batch: RecipeBatch, amount: BatchServingAmount) { return calculateBatchServing(batch, amount); }
  async logBatchServing(input: { batch: RecipeBatch; recipeName: string; amount: BatchServingAmount; meal: string; date?: string; idempotencyKey: string }) {
    const total = this.previewRecipeTotals(input.batch.ingredients);
    const food = foodRecordSchema.parse({ id: `batch:${input.batch.id}`, name: input.recipeName,
      prep_state: 'prepared', basis: 'per_serving', serving_g: input.batch.cooked_weight_g,
      nutrients: total.nutrients, provenance_kind: 'recipe_batch', source_id: input.batch.id, source_version: String(input.batch.recipe_version) });
    const quantity = input.amount.mode === 'grams' ? { amount: input.amount.grams, unit: 'g' } : { amount: input.amount.fraction, unit: 'serving' };
    const entry = this.snapshot({ ...input, food, quantity }, this.previewBatchServing(input.batch, input.amount));
    return this.added(await this.deps.diary.confirmEntry(entry));
  }
  async deleteEntry(id: string) {
    const snapshot = await this.deps.diary.deleteEntry(id);
    if (snapshot) this.undoAction = { label: 'Entry deleted', run: async () => { await this.deps.diary.restoreEntry(snapshot); } };
    this.refresh();
    return snapshot;
  }
  async moveEntry(entry: DiaryEntrySnapshot, meal: string) {
    await this.moveEntries([entry.id], entry.date, meal);
  }
  async copyEntries(ids: string[], toDate: string, toMeal?: string) {
    isoDateSchema.parse(toDate);
    const copies = await this.deps.userDb.withTransactionAsync(async tx => {
      const diary = new DiaryRepo(tx);
      const created: DiaryEntrySnapshot[] = [];
      for (const id of new Set(ids)) {
        const entry = await diary.getEntry(id);
        if (!entry || entry.draft_state !== 'confirmed') continue;
        created.push(await diary.confirmEntry({
          ...entry,
          id: generateId(),
          idempotency_key: generateId(),
          date: toDate,
          meal: toMeal ?? entry.meal,
          occurred_at: new Date().toISOString(),
        }));
      }
      return created;
    });
    if (copies.length) {
      this.undoAction = {
        label: toMeal ? `Copied to ${toMeal}` : `Copied ${copies.length} ${copies.length === 1 ? 'entry' : 'entries'}`,
        run: async () => {
          await this.deps.userDb.withTransactionAsync(async tx => {
            const diary = new DiaryRepo(tx);
            for (const entry of copies) await diary.deleteEntry(entry.id);
          });
        },
      };
    }
    this.refresh();
    return copies;
  }
  async getWeekSummary(endDate = localDate()) {
    isoDateSchema.parse(endDate);
    const [days, goals] = await Promise.all([
      this.deps.diary.listDiaryDays(shiftDate(endDate, -6), endDate), this.deps.goals.listGoalPeriods(),
    ]);
    return Array.from({ length: 7 }, (_, index) => {
      const date = shiftDate(endDate, index - 6); const day = days.find(item => item.date === date);
      const totals = sumNutrients(day?.entries ?? []);
      return { date, completeness: day?.completeness ?? 'none', kcal: totals.nutrients?.kcal ?? null,
        entryCount: totals.entryCount, targetKcal: getActiveGoalForDate(goals, date)?.target_kcal ?? null };
    });
  }
  async copyMeal(fromDate: string, fromMeal: string, toDate: string, toMeal: string) {
    isoDateSchema.parse(fromDate); isoDateSchema.parse(toDate);
    const entries = await this.deps.userDb.withTransactionAsync(async tx => {
      const diary = new DiaryRepo(tx); const day = await diary.getDiaryDay(fromDate);
      const copies: DiaryEntrySnapshot[] = [];
      for (const entry of day?.entries ?? []) {
        if (entry.meal !== fromMeal || entry.draft_state !== 'confirmed') continue;
        copies.push(await diary.confirmEntry({ ...entry, id: generateId(), idempotency_key: generateId(),
          date: toDate, meal: toMeal, occurred_at: new Date().toISOString() }));
      }
      return copies;
    });
    if (entries.length) this.undoAction = { label: `Copied to ${toMeal}`, run: async () => {
      await this.deps.userDb.withTransactionAsync(async tx => {
        const diary = new DiaryRepo(tx); for (const entry of entries) await diary.deleteEntry(entry.id);
      });
    } };
    this.refresh(); return entries;
  }
  async deleteEntries(ids: string[]) {
    const snapshots = await this.deps.userDb.withTransactionAsync(async tx => {
      const diary = new DiaryRepo(tx); const deleted: DiaryEntrySnapshot[] = [];
      for (const id of new Set(ids)) { const entry = await diary.deleteEntry(id); if (entry) deleted.push(entry); }
      return deleted;
    });
    if (snapshots.length) this.undoAction = { label: 'Entries deleted', run: async () => {
      await this.deps.userDb.withTransactionAsync(async tx => {
        const diary = new DiaryRepo(tx); for (const snapshot of snapshots) await diary.restoreEntry(snapshot);
      });
    } };
    this.refresh(); return snapshots;
  }
  async moveEntries(ids: string[], toDate: string, toMeal: string) {
    isoDateSchema.parse(toDate);
    const result = await this.deps.userDb.withTransactionAsync(async tx => {
      const diary = new DiaryRepo(tx); const originals: DiaryEntrySnapshot[] = []; const moved: DiaryEntrySnapshot[] = [];
      for (const id of new Set(ids)) {
        const entry = await diary.getEntry(id); if (!entry) throw new Error('Diary entry not found');
        originals.push(entry); moved.push(await diary.moveEntry(id, toDate, toMeal));
      }
      return { originals, moved };
    });
    if (result.originals.length) this.undoAction = { label: 'Entries moved', run: async () => {
      await this.deps.userDb.withTransactionAsync(async tx => {
        const diary = new DiaryRepo(tx); for (const entry of result.originals) await diary.updateEntry(entry);
      });
    } };
    this.refresh(); return result.moved;
  }
  async updateEntryQuantity(entry: DiaryEntrySnapshot, newQuantity: Quantity) {
    if (newQuantity.amount <= 0) throw new Error('Enter an amount greater than zero');
    const { original, updated } = await this.deps.userDb.withTransactionAsync(async tx => {
      const diary = new DiaryRepo(tx); const original = await diary.getEntry(entry.id);
      if (!original) throw new Error('Diary entry not found');
      // Recalculate from the frozen basis, never today's recipe or catalog record.
      const nutrients = calculateNutrition(original.food, newQuantity);
      const updated = await diary.updateEntry({ ...original, quantity: newQuantity, nutrients,
        unknown_nutrient_counts: original.unknown_nutrient_counts ?? sumNutrients([nutrients]).unknownCount });
      return { original, updated };
    });
    this.undoAction = { label: 'Portion updated', run: async () => { await this.deps.diary.updateEntry(original); } };
    this.refresh(); return updated;
  }
  async day(date: string) {
    const [day, goals] = await Promise.all([this.deps.diary.getDiaryDay(date), this.deps.goals.listGoalPeriods()]);
    return { day, totals: sumNutrients(day?.entries ?? []), goal: getActiveGoalForDate(goals, date) };
  }
  async setCompleteness(date: string, completeness: DiaryDay['completeness']) {
    await this.deps.diary.setDayCompleteness(date, completeness); this.refresh();
  }
  async saveCustomFood(input: unknown) {
    const food = foodRecordSchema.parse(input);
    await this.deps.library.upsertCustomFood(food); this.refresh(); return food;
  }
  resolveBarcode(rawCode: string, symbology?: string): Promise<BarcodeResolution> { return this.barcodeResolver.resolve(rawCode, symbology); }
  async saveCustomFoodWithBarcode(input: unknown, barcode: { rawCode: string; symbology?: string } | null): Promise<FoodRecord> {
    const food = foodRecordSchema.parse(input);
    await this.deps.library.upsertCustomFood(food, barcode); this.refresh(); return food;
  }
  parseLabelText(text: string) { return parseNutritionLabelText(text); }
  private async aiConnection() {
    const oauth = await this.credentials.getOAuthToken();
    if (oauth) return { mode: 'chatgpt_oauth' as const, token: oauth };
    const key = await this.credentials.getApiKey();
    return key ? { mode: 'api_key' as const, token: key } : null;
  }
  async getAIStatus(): Promise<{ mode: AIAuthMode; model: string; consentAccepted: boolean; maskedKey: string | null; statusLabel: string }> {
    const [connection, preferences, key] = await Promise.all([this.aiConnection(), this.getPreferences(), this.credentials.getApiKey()]);
    return { mode: connection?.mode ?? 'disconnected', model: preferences.aiModel, consentAccepted: preferences.aiConsentAccepted,
      maskedKey: key ? maskSecretKey(key) : null,
      statusLabel: connection?.mode === 'chatgpt_oauth' ? 'Connected with ChatGPT' : connection ? 'Connected with OpenAI API key' : 'AI disconnected' };
  }
  async setAIConsent(accepted: boolean): Promise<void> { await this.updatePreferences({ aiConsentAccepted: accepted }); }
  async setAIModel(model: string): Promise<void> { await this.updatePreferences({ aiModel: model }); }
  async saveApiKey(apiKey: string): Promise<void> {
    const key = apiKey.trim(); if (!key) throw new Error('Enter an OpenAI API key');
    await this.credentials.setApiKey(key); await this.credentials.clearOAuthToken(); this.draftGeneration++; this.refresh();
  }
  async connectChatGPTOAuth(): Promise<{ ok: boolean; message: string }> {
    if (!this.deps.loopbackAuth) return { ok: false, message: 'Sign in with ChatGPT requires a native mobile dev build with the 127.0.0.1 loopback listener. You can connect an OpenAI API key right now, or keep tracking manually.' };
    const clientId = process.env.EXPO_PUBLIC_OPENAI_OAUTH_CLIENT_ID;
    if (!clientId) return { ok: false, message: 'ChatGPT sign-in is not configured in this build. You can connect an OpenAI API key or keep tracking manually.' };
    let session: Awaited<ReturnType<LoopbackAuthPort['listen']>> | undefined;
    const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(), 120_000);
    try {
      const pkce = await generatePkcePair();
      session = await this.deps.loopbackAuth.listen({ host: '127.0.0.1', path: '/callback', expectedState: pkce.state, signal: timeout.signal });
      const callback = session.callback;
      // Attach a handler before opening the browser so cancellation cannot reject unobserved.
      void callback.catch(() => undefined);
      const { openURL } = await import('expo-linking');
      await openURL(buildAuthorizationUrl({ clientId, port: session.port, codeChallenge: pkce.codeChallenge, state: pkce.state }));
      const response = await Promise.race([callback, new Promise<never>((_, reject) => {
        const abort = () => reject(new AIError('timeout'));
        if (timeout.signal.aborted) abort(); else timeout.signal.addEventListener('abort', abort, { once: true });
      })]);
      const tokens = await exchangeAuthorizationCode({ clientId, port: session.port, ...response, codeVerifier: pkce.codeVerifier, expectedState: pkce.state, signal: timeout.signal });
      await this.credentials.setOAuthToken(tokens.access_token); this.draftGeneration++; this.refresh();
      return { ok: true, message: 'Connected with ChatGPT.' };
    } catch (error) { return { ok: false, message: error instanceof AIError ? error.message : 'ChatGPT sign-in could not finish. Try again or connect an OpenAI API key.' }; }
    finally { clearTimeout(timer); await session?.close(); }
  }
  async disconnectAI(): Promise<void> {
    this.draftGeneration++;
    await Promise.all([this.credentials.clearOAuthToken(), this.credentials.clearApiKey()]); this.refresh();
  }
  private async connectedProvider() {
    const connection = await this.aiConnection(); if (!connection) throw new AIError('not_connected');
    const preferences = await this.getPreferences();
    if (!preferences.aiConsentAccepted) throw new AIError('refusal');
    const provider = this.deps.aiProviderFactory?.(connection.token, connection.mode)
      ?? new OpenAIResponsesProvider({ authMode: connection.mode, getAccessToken: () => connection.mode === 'api_key' ? this.credentials.getApiKey() : this.credentials.getOAuthToken() });
    return { provider, model: preferences.aiModel };
  }
  async captureMealWithAI(input: { text: string; imageDataUrl?: string; meal: string; date?: string; signal?: AbortSignal }): Promise<MealDraftProposal> {
    const generation = ++this.draftGeneration;
    try {
      const date = isoDateSchema.parse(input.date ?? localDate());
      const connection = await this.connectedProvider();
      const proposal = await captureMealDraft({ ...input, ...connection, catalog: this.deps.catalog });
      if (generation !== this.draftGeneration || input.signal?.aborted) throw new AIError('timeout');
      this.activeDraft = { proposal, meal: input.meal, date }; this.refresh(); return proposal;
    } catch (error) { throw error instanceof AIError ? error : new AIError(input.signal?.aborted ? 'timeout' : 'malformed_output'); }
  }
  getActiveDraft() { return this.activeDraft; }
  async answerDraftQuestion(questionId: string, optionId: string): Promise<MealDraftProposal | null> {
    const draft = this.activeDraft; if (!draft || this.confirmingDraft) return draft?.proposal ?? null;
    const proposal = await applyClarifyingAnswer(draft.proposal, questionId, optionId, this.deps.catalog);
    if (this.activeDraft !== draft) return this.activeDraft?.proposal ?? null;
    this.activeDraft = { ...draft, proposal }; this.refresh(); return proposal;
  }
  private draftTotals(items: MealDraftProposal['items']) {
    const totals = sumNutrients(items.map(item => item.nutrients));
    for (const key of nutrientKeys) totals.unknownCount[key] = items.reduce((count, item) => count + item.unknownCount[key], 0);
    return totals;
  }
  removeDraftItem(itemId: string): void {
    const draft = this.activeDraft; if (!draft || this.confirmingDraft) return;
    const index = /^\d+$/.test(itemId) ? Number(itemId) : draft.proposal.items.findIndex(item => item.food.id === itemId);
    const items = draft.proposal.items.filter((_, itemIndex) => itemIndex !== index);
    if (items.length === draft.proposal.items.length) return;
    const proposal = draft.proposal;
    let baseItems = proposal.base_items;
    let questions = proposal.clarifying_questions;
    if (index < baseItems.length) {
      baseItems = baseItems.filter((_, baseIndex) => baseIndex !== index);
      questions = questions.filter(question => !question.options.some(option => option.effect.targetItemIndex === index))
        .map(question => ({ ...question, options: question.options.map(option => ({ ...option, effect: {
          ...option.effect, ...(option.effect.targetItemIndex !== undefined && option.effect.targetItemIndex > index
            ? { targetItemIndex: option.effect.targetItemIndex - 1 } : {}),
        } })) }));
    } else {
      let addedIndex = baseItems.length;
      questions = questions.filter(question => {
        const effect = question.options.find(option => option.id === proposal.answers[question.id])?.effect;
        return effect?.kind !== 'add_food' || addedIndex++ !== index;
      });
    }
    // If only clarification additions remain, freeze those as the reviewed starting point.
    if (!baseItems.length) { baseItems = items; questions = []; }
    const answers = Object.fromEntries(Object.entries(proposal.answers).filter(([id]) => questions.some(question => question.id === id)));
    this.activeDraft = items.length ? { ...draft, proposal: { ...proposal, items, base_items: baseItems,
      totals: this.draftTotals(items), answers, clarifying_questions: questions } } : null;
    this.draftGeneration++; this.refresh();
  }
  discardActiveDraft(): void { this.draftGeneration++; this.activeDraft = null; this.refresh(); }
  confirmActiveDraft(idempotencyPrefix = generateId()): Promise<DiaryEntrySnapshot[]> {
    if (this.confirmingDraft) return this.confirmingDraft;
    const draft = this.activeDraft; if (!draft) return Promise.resolve([]);
    const confirmation = this.deps.userDb.withTransactionAsync(async tx => {
      const diary = new DiaryRepo(tx); const entries: DiaryEntrySnapshot[] = [];
      for (const [index, item] of draft.proposal.items.entries()) {
        const aggregate = this.draftTotals([item]);
        const snapshot = this.snapshot({ food: item.food, quantity: item.quantity, meal: draft.meal, date: draft.date,
          idempotencyKey: `${idempotencyPrefix}:${index}` }, aggregate);
        entries.push(await diary.confirmEntry({ ...snapshot, provenance_kind: item.provenance_kind,
          portion_certainty: item.portion_certainty,
          estimate_range: item.estimate_range ? { min_g: item.estimate_range.min_g, max_g: item.estimate_range.max_g } : null }));
      }
      return entries;
    }).then(entries => {
      if (this.activeDraft === draft) this.activeDraft = null;
      this.undoAction = { label: `Added ${entries.length} ${entries.length === 1 ? 'item' : 'items'} to ${draft.meal}`, run: async () => {
        await this.deps.userDb.withTransactionAsync(async tx => {
          const diary = new DiaryRepo(tx); for (const entry of entries) await diary.deleteEntry(entry.id);
        });
      } };
      this.refresh(); return entries;
    }).finally(() => { this.confirmingDraft = null; });
    this.confirmingDraft = confirmation; return confirmation;
  }
  async extractLabelFromImage(imageDataUrl: string, signal?: AbortSignal): Promise<NutritionLabelExtraction> {
    try {
      const connection = await this.connectedProvider();
      return await extractNutritionLabel({ ...connection, imageDataUrl, ...(signal ? { signal } : {}) });
    } catch (error) { throw error instanceof AIError ? error : new AIError(signal?.aborted ? 'timeout' : 'network'); }
  }
  async saveGoal(input: Omit<GoalPeriod, 'id' | 'effective_from_date'>, date = localDate()) {
    // A same-day edit replaces today's period, never a period effective in the past.
    const sameDay = (await this.deps.goals.listGoalPeriods()).find(goal => goal.effective_from_date === date);
    await this.deps.goals.upsertGoalPeriod({ ...input, id: sameDay?.id ?? generateId(), effective_from_date: date });
    this.refresh();
  }
  async weighIn(weightKg: number, date = localDate()) {
    await this.deps.goals.recordWeighIn({ id: generateId(), measured_at: new Date().toISOString(), date,
      weight_kg: weightKg, source: 'manual', external_source_id: null }); this.refresh();
  }
  async progress(range: number, end = localDate()) {
    const days = await this.deps.diary.listDiaryDays(shiftDate(end, 1 - range), end);
    const complete = days.filter(day => day.completeness === 'complete' && sumNutrients(day.entries).entryCount > 0);
    const total = sumNutrients(complete.flatMap(day => day.entries));
    return { completeDays: complete.length, excludedDays: range - complete.length,
      averages: total.nutrients ? scaleNutrients(total.nutrients, 1 / complete.length) : null,
      unknownCount: total.unknownCount, trend: calculateWeightTrend(await this.deps.goals.listWeighIns()) };
  }
  async installPack(handle: SqlDatabase, path: string, priority = 100) {
    let owned = false;
    try {
      const meta = await validatePackDatabase(handle);
      const count = await handle.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM foods');
      await this.deps.catalog.unmountPack(meta.pack_id);
      await this.deps.catalog.mountPack(meta.pack_id, handle, priority); owned = true;
      await this.deps.packs.registerPack(meta, path, { priority });
      this.foodCounts.set(meta.pack_id, count?.count ?? 0); this.refresh(); return meta;
    } catch (error) { if (!owned) await handle.closeAsync(); throw error; }
  }
  async listPacks() {
    return (await this.deps.packs.listInstalledPacks()).map(pack => ({ ...pack,
      mounted: this.deps.catalog.listMountedPacks().some(item => item.packId === pack.pack_id),
      foodCount: this.foodCounts.get(pack.pack_id) ?? null }));
  }
  async setPackEnabled(id: string, enabled: boolean) { await this.deps.catalog.setPackEnabled(id, enabled); this.refresh(); }
  async setPackPriority(id: string, priority: number) { await this.deps.catalog.setPackPriority(id, priority); this.refresh(); }
  async exportJson() { return JSON.stringify(await exportBundleV1(this.deps.userDb), null, 2); }
  previewRestore(json: string) {
    const bundle = exportBundleV1Schema.parse(JSON.parse(json));
    return { bundle, days: bundle.diary_days.length, entries: bundle.diary_days.reduce((sum, day) => sum + day.entries.length, 0),
      foods: bundle.custom_foods.length, packs: bundle.packs.length, goals: bundle.goal_periods.length, weighIns: bundle.weigh_ins.length };
  }
  async restoreJson(json: string, mode: 'merge' | 'replace') {
    const { bundle } = this.previewRestore(json);
    await restoreBundleV1(this.deps.userDb, bundle, { mode });
    if (mode === 'replace') { await this.deps.catalog.close(); this.foodCounts.clear(); }
    this.undoAction = null; this.refresh();
  }
  async close() {
    this.draftGeneration++; await this.deps.catalog.close();
    await this.deps.offCacheDb?.closeAsync(); await this.deps.userDb.closeAsync();
  }
}
