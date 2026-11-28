import { z } from 'zod';
import { calculateBatchServing, calculateNutrition, calculateRecipeTotal, calculateWeightTrend, estimateDailyTarget, exportBundleV1Schema, foodRecordSchema, formatDiaryCsv, formatWeightTrendsCsv, generateId, getActiveGoalForDate, isoDateSchema, MAX_BATCH_FRACTION, nutrientKeys, resolveQuantityToBasis, scaleNutrients, sumNutrients } from '../domain';
import type { DiaryDay, DiaryEntrySnapshot, FoodRecord, FoodUnit, GoalPeriod, NutrientAggregate, OfflinePhotoDraft, Quantity, RecipeBatch, RecipeIngredient, TargetInputs, WaterLog } from '../domain';
import { UserLibraryAdapter, validatePackDatabase } from '../catalog';
import type { FoodSourceRegistry } from '../catalog';
import { DiaryRepo, GoalsRepo, HealthSyncRepo, LibraryRepo, PhotoDraftRepo, WaterRepo, deduplicateGoalPeriods, exportBundleV1, foodKey, restoreBundleV1 } from '../storage';
import type { PacksRepo, SavedMeal, SqlDatabase } from '../storage';
import { createUnavailableHealthPort, HealthSyncEngine } from '../health';
import type { HealthCapability, HealthPermissionsState, HealthPermissionScope, HealthPlatformPort, HealthWeightImportResult } from '../health';
import { BarcodeResolver, parseNutritionLabelText } from '../barcode';
import type { BarcodeResolution } from '../barcode';
import { AIError, DEFAULT_AGENT_NAME_HINT, OPENAI_DYNAMIC_CLIENT_ID, OpenAIResponsesProvider, applyClarifyingAnswer, buildAuthorizationUrl, captureMealDraft, exchangeAuthorizationCode, extractNutritionLabel, generatePkcePair, hasRequiredOAuthScope, refreshAccessToken, revokeOAuthToken, verifyOAuthIdToken } from '../ai';
import type { AIAuthMode, AIProvider, LoopbackAuthPort, MealDraftProposal, NutritionLabelExtraction, PkceCryptoProvider } from '../ai';
import { createMemoryCredentialStore, maskSecretKey } from './credentials';
import type { CredentialStore, OAuthSession } from './credentials';

export const MEALS = ['Breakfast', 'Lunch', 'Snack', 'Dinner'] as const;
export const UNDO_TIMEOUT_MS = 5000;
export type Meal = typeof MEALS[number];
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDate(value);
}
export function parseRouteDate(
  value: string | string[] | undefined,
  options?: { maxDate?: string | null },
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  if (!trimmed || !isoDateSchema.safeParse(trimmed).success) return undefined;
  const maxDate = options?.maxDate === undefined ? localDate() : options.maxDate;
  if (maxDate && trimmed > maxDate) return undefined;
  return trimmed;
}
export function mealsForDay(
  configuredMeals: readonly string[],
  entries: readonly DiaryEntrySnapshot[],
  extraMeals: readonly (string | null | undefined)[] = [],
): string[] {
  return [...new Set([
    ...configuredMeals,
    ...entries.map(entry => entry.meal),
    ...extraMeals.map(meal => meal?.trim()).filter((meal): meal is string => Boolean(meal)),
  ])];
}

export function defaultQuantity(food: FoodRecord): Quantity {
  const candidates: Quantity[] = food.basis === 'per_serving'
    ? [{ amount: 1, unit: 'serving' }]
    : food.basis === 'per_100ml'
      ? [
          ...(food.serving_ml !== null ? [{ amount: food.serving_ml, unit: 'ml' }] : []),
          { amount: 100, unit: 'ml' },
        ]
      : [
          ...(food.serving_g !== null ? [{ amount: food.serving_g, unit: 'g' }] : []),
          { amount: 100, unit: 'g' },
        ];
  for (const candidate of candidates) {
    try {
      resolveQuantityToBasis(food, candidate);
      return candidate;
    } catch { /* fall through to canonical basis */ }
  }
  return {
    amount: food.basis === 'per_serving' ? 1 : 100,
    unit: food.basis === 'per_serving' ? 'serving' : food.basis === 'per_100ml' ? 'ml' : 'g',
  };
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
  aiProviderFactory?: ((token: string, mode: 'chatgpt_oauth' | 'api_key') => AIProvider) | undefined;
  loopbackAuth?: LoopbackAuthPort | null;
  pkceCrypto?: PkceCryptoProvider | null;
  aiFetch?: typeof globalThis.fetch | undefined;
  water?: WaterRepo;
  healthSync?: HealthSyncRepo;
  photoDrafts?: PhotoDraftRepo;
  healthPort?: HealthPlatformPort;
  resolveBundledPack?: ((packId: string) => Promise<{ db: SqlDatabase; filePath: string } | null>) | undefined;
}
export interface UndoAction {
  label: string;
  kind?: 'add' | 'move' | 'update' | 'delete' | 'copy' | 'water';
  date?: string;
  meal?: string;
  run: () => Promise<void>;
}

export function canUndoMealAdd(undo: UndoAction | null | undefined, date: string, meal: string): boolean {
  return Boolean(undo && undo.kind === 'add' && undo.date === date && undo.meal === meal);
}

const preferencesSchema = z.strictObject({
  onboardingCompleted: z.boolean().default(false), ageConfirmed18Plus: z.boolean().default(false),
  energyUnit: z.enum(['kcal', 'kJ']).default('kcal'), weightUnit: z.enum(['kg', 'lb']).default('kg'),
  mealSections: z.array(z.string().trim().min(1)).min(1).default(() => [...MEALS]),
  allowLiveOffLookup: z.boolean().default(false), aiModel: z.string().trim().min(1).default('gpt-5-mini'),
  aiConsentAccepted: z.boolean().default(false),
  leadMetric: z.enum(['calories', 'protein', 'fiber', 'water']).default('calories'),
  healthNutritionWriteEnabled: z.boolean().default(false),
  healthWeightReadEnabled: z.boolean().default(false),
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
  private readonly water: WaterRepo;
  private readonly photoDrafts: PhotoDraftRepo;
  private readonly healthPort: HealthPlatformPort;
  private readonly healthEngine: HealthSyncEngine;
  private activeDraft: { proposal: MealDraftProposal; meal: string; date: string } | null = null;
  private draftGeneration = 0;
  private credentialGeneration = 0;
  private pendingCredentialMutations = 0;
  private aiConsentGeneration = 0;
  private credentialAbortController = new AbortController();
  private credentialOpChain: Promise<void> = Promise.resolve();
  private oauthConnectAttempt = 0;
  private activeOAuthCancel: (() => void) | null = null;
  private activeOAuthCallbackCancel: (() => void) | null = null;
  private confirmingDraft: Promise<DiaryEntrySnapshot[]> | null = null;
  private refreshingOAuth: { gen: number; promise: Promise<string | null> } | null = null;
  private entryHealthChains = new Map<string, Promise<void>>();
  private abortActiveAIRequests() {
    this.credentialAbortController.abort();
    this.credentialAbortController = new AbortController();
  }
  private invalidateCredentials() {
    this.credentialGeneration++;
    this.abortActiveAIRequests();
    this.refreshingOAuth = null;
  }
  private invalidateAIConsent() {
    this.aiConsentGeneration++;
    this.draftGeneration++;
    this.abortActiveAIRequests();
  }
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  undoAction: UndoAction | null = null;
  constructor(deps: ControllerDependencies) {
    this.deps = deps;
    this.water = deps.water ?? new WaterRepo(deps.userDb);
    this.photoDrafts = deps.photoDrafts ?? new PhotoDraftRepo(deps.userDb);
    this.healthPort = deps.healthPort ?? createUnavailableHealthPort('web');
    this.healthEngine = new HealthSyncEngine({ port: this.healthPort,
      records: deps.healthSync ?? new HealthSyncRepo(deps.userDb), weights: deps.goals,
      isNutritionWriteEnabled: () => this.getPreferences().then(p => p.healthNutritionWriteEnabled),
      isWeightReadEnabled: () => this.getPreferences().then(p => p.healthWeightReadEnabled) });
    this.credentials = deps.credentials ?? createMemoryCredentialStore();
    this.barcodeResolver = deps.barcodeResolver ?? new BarcodeResolver({ catalog: deps.catalog,
      offCacheDb: deps.offCacheDb ?? null, getAllowLiveOffLookup: () => this.getPreferences().then(p => p.allowLiveOffLookup) });
  }
  private clearUndoTimer() {
    if (this.undoTimer !== null) {
      clearTimeout(this.undoTimer);
      this.undoTimer = null;
    }
  }
  private setUndoAction(action: UndoAction | null) {
    this.clearUndoTimer();
    this.undoAction = action;
    if (action) {
      const timer = setTimeout(() => {
        if (this.undoAction === action) {
          this.undoTimer = null;
          this.undoAction = null;
          this.refresh();
        }
      }, UNDO_TIMEOUT_MS);
      if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
        timer.unref();
      }
      this.undoTimer = timer;
    }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getRevision = () => this.revision;
  refresh = () => { this.revision++; this.listeners.forEach(listener => listener()); };
  dismissUndo = () => { this.setUndoAction(null); this.refresh(); };
  async undo() {
    const action = this.undoAction;
    if (!action) return;
    this.clearUndoTimer();
    try {
      await action.run();
      if (this.undoAction === action) this.setUndoAction(null);
      this.refresh();
    } catch (error) {
      if (this.undoAction === action) this.setUndoAction(action);
      throw error;
    }
  }
  search(query: string) { return this.deps.catalog.search(query); }
  async preview(food: FoodRecord, quantity: Quantity) {
    if (!food.source_pack_id && /^(recipe:|meal:)/.test(food.id)) {
      return this.deps.catalog.userLibrary.getNutritionForQuantity(food.id, quantity, food.units);
    }
    return sumNutrients([calculateNutrition(food, quantity)]);
  }
  private occurredAtForDate(date: string): string {
    return date === localDate() ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString();
  }
  private snapshot(input: { food: FoodRecord; quantity: Quantity; meal: string; date?: string; idempotencyKey: string }, preview: NutrientAggregate): DiaryEntrySnapshot {
    if (input.quantity.amount <= 0) throw new Error('Enter an amount greater than zero');
    if (!preview?.nutrients) throw new Error('This portion has no nutrition');
    const date = input.date ?? localDate();
    return {
      id: generateId(), idempotency_key: input.idempotencyKey, date,
      occurred_at: this.occurredAtForDate(date), time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      meal: input.meal, food: input.food, quantity: input.quantity, nutrients: preview.nutrients,
      unknown_nutrient_counts: preview.unknownCount, provenance_kind: input.food.provenance_kind,
      portion_certainty: 'stated', estimate_range: null, draft_state: 'confirmed',
    };
  }
  private async confirmEntryInTx(tx: SqlDatabase, candidate: DiaryEntrySnapshot, savedMealId?: string | null) {
    const result = await new DiaryRepo(tx).confirmEntryWithStatus(candidate);
    if (savedMealId && result.changed) {
      const library = new LibraryRepo(tx);
      const saved = await library.getSavedMeal(savedMealId);
      if (saved) await library.upsertSavedMeal({ ...saved, use_count: saved.use_count + 1, last_used_at: result.entry.occurred_at });
    }
    return result;
  }
  private withCredentialLock<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.credentialOpChain.then(operation, operation);
    this.credentialOpChain = next.then(() => undefined, () => undefined);
    return next;
  }
  private enqueueEntryHealthSync<T>(entryId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.entryHealthChains.get(entryId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const cleanup = next.then(
      () => { if (this.entryHealthChains.get(entryId) === cleanup) this.entryHealthChains.delete(entryId); },
      () => { if (this.entryHealthChains.get(entryId) === cleanup) this.entryHealthChains.delete(entryId); },
    );
    this.entryHealthChains.set(entryId, cleanup);
    return next;
  }
  private flushPendingHealthDeletes(): Promise<number> {
    return this.healthEngine.flushPendingDeletes((entryId, run) =>
      this.enqueueEntryHealthSync(entryId, async () => {
        if (await this.deps.diary.getEntry(entryId)) return { synced: false };
        return run();
      }),
    );
  }
  private async added(result: { entry: DiaryEntrySnapshot; changed: boolean }) {
    if (!result.changed) return result.entry;
    const { entry } = result;
    this.setUndoAction({
      label: `Added to ${entry.meal}`,
      kind: 'add',
      date: entry.date,
      meal: entry.meal,
      run: async () => {
        await this.deps.diary.deleteEntry(entry.id);
        await this.enqueueEntryHealthSync(entry.id, () => this.healthEngine.syncEntryDeleted(entry.id));
      },
    });
    this.refresh();
    await this.enqueueEntryHealthSync(entry.id, () => this.healthEngine.syncEntryConfirmed(entry));
    return entry;
  }
  async confirm(input: { food: FoodRecord; quantity: Quantity; meal: string; date?: string; idempotencyKey: string }) {
    const isComposite = !input.food.source_pack_id && /^(recipe:|meal:)/.test(input.food.id);
    let resolvedFood = input.food;
    let preview: NutrientAggregate | null;
    if (isComposite) {
      const resolved = await this.deps.catalog.userLibrary.resolveForQuantity(input.food.id, input.quantity, input.food.units);
      if (!resolved) throw new Error('This portion has no nutrition');
      resolvedFood = resolved.food;
      preview = resolved.aggregate;
    } else {
      preview = await this.preview(input.food, input.quantity);
    }
    if (!preview) throw new Error('This portion has no nutrition');
    const candidate = this.snapshot({ ...input, food: resolvedFood }, preview);
    const savedMealId = !resolvedFood.source_pack_id && resolvedFood.id.startsWith('meal:') ? resolvedFood.id.slice(5) : null;
    if (savedMealId) {
      const confirmed = await this.deps.userDb.withTransactionAsync(tx => this.confirmEntryInTx(tx, candidate, savedMealId));
      return this.added(confirmed);
    }
    return this.added(await this.deps.diary.confirmEntryWithStatus(candidate));
  }
  async confirmToMeals(input: {
    food: FoodRecord;
    quantity: Quantity;
    meals: readonly string[];
    date?: string;
    idempotencyKeys?: readonly string[];
  }): Promise<DiaryEntrySnapshot[]> {
    const mealKeys = new Map<string, string | undefined>();
    for (let index = 0; index < input.meals.length; index++) {
      const meal = input.meals[index]?.trim() ?? '';
      if (!meal) continue;
      const explicitKey = input.idempotencyKeys?.[index]?.trim() || undefined;
      if (mealKeys.has(meal)) {
        const priorKey = mealKeys.get(meal);
        if (explicitKey && priorKey && explicitKey !== priorKey) {
          throw new Error(`Conflicting idempotency keys for ${meal}`);
        }
        if (explicitKey && !priorKey) {
          mealKeys.set(meal, explicitKey);
        }
        continue;
      }
      mealKeys.set(meal, explicitKey);
    }
    const targets: { meal: string; idempotencyKey: string }[] = [];
    const seenKeys = new Set<string>();
    for (const [meal, explicitKey] of mealKeys.entries()) {
      const key = explicitKey ?? generateId();
      if (seenKeys.has(key)) {
        throw new Error('Each meal requires a unique idempotency key');
      }
      seenKeys.add(key);
      targets.push({ meal, idempotencyKey: key });
    }
    if (targets.length === 0) throw new Error('Select at least one meal');
    const isComposite = !input.food.source_pack_id && /^(recipe:|meal:)/.test(input.food.id);
    let resolvedFood = input.food;
    let preview: NutrientAggregate | null;
    if (isComposite) {
      const resolved = await this.deps.catalog.userLibrary.resolveForQuantity(input.food.id, input.quantity, input.food.units);
      if (!resolved) throw new Error('This portion has no nutrition');
      resolvedFood = resolved.food;
      preview = resolved.aggregate;
    } else {
      preview = await this.preview(input.food, input.quantity);
    }
    if (!preview) throw new Error('This portion has no nutrition');
    const savedMealId = !resolvedFood.source_pack_id && resolvedFood.id.startsWith('meal:') ? resolvedFood.id.slice(5) : null;
    const candidates = targets.map(target =>
      this.snapshot(
        {
          food: resolvedFood,
          quantity: input.quantity,
          meal: target.meal,
          ...(input.date ? { date: input.date } : {}),
          idempotencyKey: target.idempotencyKey,
        },
        preview,
      ),
    );
    const results = await this.deps.userDb.withTransactionAsync(async tx => {
      const confirmed: { entry: DiaryEntrySnapshot; changed: boolean }[] = [];
      for (const candidate of candidates) {
        const res = await this.confirmEntryInTx(tx, candidate, savedMealId);
        if (res.entry.meal !== candidate.meal || res.entry.date !== candidate.date) {
          throw new Error('Idempotency key already belongs to a different meal or date');
        }
        confirmed.push(res);
      }
      return confirmed;
    });
    const addedEntries = results.filter(result => result.changed).map(result => result.entry);
    if (addedEntries.length > 0) {
      const addedMeals = addedEntries.map(entry => entry.meal);
      const label =
        addedMeals.length === 1
          ? `Added to ${addedMeals[0]}`
          : addedMeals.length === 2
            ? `Added to ${addedMeals[0]} & ${addedMeals[1]}`
            : `Added to ${addedMeals.length} meals`;
      const addedIds = addedEntries.map(entry => entry.id);
      this.setUndoAction({
        label,
        kind: 'add',
        ...(addedEntries[0]?.date ? { date: addedEntries[0].date } : {}),
        ...(addedMeals.length === 1 && addedMeals[0] ? { meal: addedMeals[0] } : {}),
        run: async () => {
          await this.deps.userDb.withTransactionAsync(async tx => {
            const diary = new DiaryRepo(tx);
            for (const id of addedIds) {
              await diary.deleteEntry(id);
            }
          });
          await Promise.all(
            addedIds.map(id => this.enqueueEntryHealthSync(id, () => this.healthEngine.syncEntryDeleted(id))),
          );
        },
      });
      this.refresh();
      await Promise.all(
        addedEntries.map(entry => this.enqueueEntryHealthSync(entry.id, () => this.healthEngine.syncEntryConfirmed(entry))),
      );
    }
    return results.map(result => result.entry);
  }
  getPreferences() { return readPreferences(this.deps.userDb); }
  async addWater(amountMl: number, date = localDate()): Promise<WaterLog> {
    if (!Number.isFinite(amountMl) || amountMl <= 0) throw new Error('Enter an amount greater than zero');
    isoDateSchema.parse(date);
    const log = await this.water.addWaterLog({ id: generateId(), date, occurred_at: new Date().toISOString(), amount_ml: amountMl });
    this.setUndoAction({ label: `Added ${amountMl} ml water`, kind: 'water', run: async () => { await this.water.deleteWaterLog(log.id); } });
    this.refresh(); return log;
  }
  async deleteWaterLog(id: string): Promise<WaterLog | null> {
    const log = await this.water.deleteWaterLog(id);
    if (log) this.setUndoAction({ label: 'Water entry removed', kind: 'water', run: async () => { await this.water.addWaterLog(log); } });
    this.refresh(); return log;
  }
  async getDailyWater(date = localDate()): Promise<{ totalMl: number; logs: WaterLog[] }> {
    const logs = await this.water.listWaterLogs(date);
    return { totalMl: logs.reduce((total, log) => total + log.amount_ml, 0), logs };
  }
  async saveOfflinePhotoDraft(input: { meal: string; note?: string; imageDataUrl: string; date?: string }): Promise<OfflinePhotoDraft> {
    const draft = await this.photoDrafts.saveDraft({ id: generateId(), date: input.date ?? localDate(), meal: input.meal,
      note: input.note ?? '', image_data_url: input.imageDataUrl, created_at: new Date().toISOString() });
    this.refresh(); return draft;
  }
  listOfflinePhotoDrafts(): Promise<OfflinePhotoDraft[]> { return this.photoDrafts.listDrafts(); }
  async deleteOfflinePhotoDraft(id: string): Promise<OfflinePhotoDraft | null> {
    const draft = await this.photoDrafts.deleteDraft(id); this.refresh(); return draft;
  }
  async getHealthStatus(): Promise<{ capability: HealthCapability; permissions: HealthPermissionsState; nutritionWriteEnabled: boolean; weightReadEnabled: boolean }> {
    const preferences = await this.getPreferences();
    return { capability: this.healthPort.getCapability(), permissions: await this.healthPort.getPermissions(),
      nutritionWriteEnabled: preferences.healthNutritionWriteEnabled, weightReadEnabled: preferences.healthWeightReadEnabled };
  }
  async requestHealthPermissions(scopes: HealthPermissionScope[]): Promise<HealthPermissionsState> {
    const permissions = await this.healthPort.requestPermissions(scopes);
    if (permissions.nutritionWrite) await this.flushPendingHealthDeletes();
    this.refresh(); return permissions;
  }
  async syncWeightFromHealth(sinceIsoDate?: string): Promise<HealthWeightImportResult> {
    await this.flushPendingHealthDeletes();
    const result = await this.healthEngine.importWeightSamples(sinceIsoDate);
    if (result.imported > 0) this.refresh();
    return result;
  }
  async updatePreferences(patch: Partial<AppPreferences>) {
    if (patch.aiConsentAccepted === false) {
      this.invalidateAIConsent();
    }
    const value = await this.deps.userDb.withTransactionAsync(tx => writePreferences(tx, patch));
    if (patch.healthNutritionWriteEnabled) await this.flushPendingHealthDeletes();
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
      // V1 ingredients persist the frozen food basis and portion; derived draft nutrition is recalculated on reuse.
      const items = input.items.map(({ food, quantity }) => ({ food, quantity }));
      return library.upsertSavedMeal({ id: input.id ?? generateId(), name: input.name, items,
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
  async deleteSavedMeal(id: string) {
    await this.deps.library.deleteSavedMeal(id);
    this.refresh();
  }
  async toggleFoodPin(food: FoodRecord, pinned: boolean) {
    if (!food.source_pack_id && food.id.startsWith('meal:')) {
      await this.toggleSavedMealPinned(food.id.slice(5), pinned);
      return;
    }
    const key = foodKey(food);
    await this.deps.userDb.withTransactionAsync(async tx => {
      const [records, pins] = await Promise.all([
        tx.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', 'libraryPinnedFoods'),
        tx.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', 'libraryVisualPins'),
      ]);
      const foods: FoodRecord[] = records ? JSON.parse(records.value_json) : [];
      const nextFoods = foods.filter(item => foodKey(item) !== key);
      if (pinned) nextFoods.push(food);
      const ids: string[] = pins ? JSON.parse(pins.value_json) : [];
      const nextIds = ids.filter(id => id !== key);
      if (pinned) nextIds.push(key);
      const now = new Date().toISOString();
      await tx.runAsync('INSERT INTO preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', 'libraryPinnedFoods', JSON.stringify(nextFoods), now);
      await tx.runAsync('INSERT INTO preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', 'libraryVisualPins', JSON.stringify(nextIds), now);
    });
    this.refresh();
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
      const resolved = await adapter.resolveForQuantity(id, quantity);
      if (!resolved) throw new Error('Saved meal not found');
      const candidate = this.snapshot({ food: resolved.food, quantity, meal, ...(date === undefined ? {} : { date }), idempotencyKey }, resolved.aggregate);
      return this.confirmEntryInTx(tx, candidate, savedMealId);
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
  async renameRecipe(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Enter a recipe name before saving.');
    const previous = await this.deps.library.getRecipe(id);
    if (!previous) throw new Error('Recipe not found');
    if (previous.name === trimmed) return previous;
    const updated = await this.deps.library.upsertRecipe({ ...previous, name: trimmed });
    this.setUndoAction({
      label: 'Edited Name',
      kind: 'update',
      run: async () => {
        const current = await this.deps.library.getRecipe(id);
        if (current) await this.deps.library.upsertRecipe({ ...current, name: previous.name });
      },
    });
    this.refresh();
    return updated;
  }
  async renameSavedMeal(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Enter a meal name before saving.');
    const previous = await this.deps.library.getSavedMeal(id);
    if (!previous) throw new Error('Saved meal not found');
    if (previous.name === trimmed) return previous;
    const updated = await this.deps.library.upsertSavedMeal({ ...previous, name: trimmed });
    this.setUndoAction({
      label: 'Edited Name',
      kind: 'update',
      run: async () => {
        const current = await this.deps.library.getSavedMeal(id);
        if (current) await this.deps.library.upsertSavedMeal({ ...current, name: previous.name });
      },
    });
    this.refresh();
    return updated;
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
    return this.added(await this.deps.diary.confirmEntryWithStatus(entry));
  }
  async deleteEntry(id: string) {
    const snapshot = await this.deps.diary.deleteEntry(id);
    if (snapshot) {
      this.setUndoAction({ label: 'Entry deleted', kind: 'delete', run: async () => {
        const restored = await this.deps.diary.restoreEntry(snapshot);
        await this.enqueueEntryHealthSync(restored.id, () => this.healthEngine.syncEntryConfirmed(restored));
      } });
      this.refresh();
      await this.enqueueEntryHealthSync(id, () => this.healthEngine.syncEntryDeleted(id));
    } else {
      this.refresh();
    }
    return snapshot;
  }
  async moveEntry(entry: DiaryEntrySnapshot, meal: string) {
    await this.moveEntries([entry.id], entry.date, meal);
  }
  private async copyResolvedEntries(
    select: (diary: DiaryRepo) => Promise<DiaryEntrySnapshot[]>,
    toDate: string,
    toMeal?: string,
  ): Promise<DiaryEntrySnapshot[]> {
    isoDateSchema.parse(toDate);
    const copies = await this.deps.userDb.withTransactionAsync(async tx => {
      const diary = new DiaryRepo(tx);
      const selected = await select(diary);
      const created: DiaryEntrySnapshot[] = [];
      for (const entry of selected) {
        if (entry.draft_state !== 'confirmed') continue;
        created.push(await diary.confirmEntry({
          ...entry,
          id: generateId(),
          idempotency_key: generateId(),
          date: toDate,
          meal: toMeal ?? entry.meal,
          occurred_at: this.occurredAtForDate(toDate),
        }));
      }
      return created;
    });
    if (copies.length) {
      this.setUndoAction({
        label: toMeal ? `Copied to ${toMeal}` : `Copied ${copies.length} ${copies.length === 1 ? 'entry' : 'entries'}`,
        kind: 'copy',
        run: async () => {
          await this.deps.userDb.withTransactionAsync(async tx => {
            const diary = new DiaryRepo(tx);
            for (const entry of copies) await diary.deleteEntry(entry.id);
          });
          await Promise.all(
            copies.map(entry => this.enqueueEntryHealthSync(entry.id, () => this.healthEngine.syncEntryDeleted(entry.id))),
          );
        },
      });
      this.refresh();
      await Promise.all(
        copies.map(entry => this.enqueueEntryHealthSync(entry.id, () => this.healthEngine.syncEntryConfirmed(entry))),
      );
    } else {
      this.refresh();
    }
    return copies;
  }
  async copyEntries(ids: string[], toDate: string, toMeal?: string) {
    return this.copyResolvedEntries(async diary => {
      const found: DiaryEntrySnapshot[] = [];
      for (const id of new Set(ids)) {
        const entry = await diary.getEntry(id);
        if (entry) found.push(entry);
      }
      return found;
    }, toDate, toMeal);
  }
  async getWeekSummary(endDate = localDate()) {
    isoDateSchema.parse(endDate);
    const [days, goals] = await Promise.all([
      this.deps.diary.listDiaryDays(shiftDate(endDate, -6), endDate), this.deps.goals.listGoalPeriods(),
    ]);
    return Array.from({ length: 7 }, (_, index) => {
      const date = shiftDate(endDate, index - 6); const day = days.find(item => item.date === date);
      const totals = sumNutrients(day?.entries ?? []);
      return { date, completeness: totals.entryCount > 0 ? ('complete' as const) : ('none' as const), kcal: totals.nutrients?.kcal ?? null,
        entryCount: totals.entryCount, targetKcal: getActiveGoalForDate(goals, date)?.target_kcal ?? null };
    });
  }
  async copyMeal(fromDate: string, fromMeal: string, toDate: string, toMeal: string) {
    isoDateSchema.parse(fromDate);
    return this.copyResolvedEntries(async diary => {
      const day = await diary.getDiaryDay(fromDate);
      return (day?.entries ?? []).filter(entry => entry.meal === fromMeal);
    }, toDate, toMeal);
  }
  async deleteEntries(ids: string[]) {
    const snapshots = await this.deps.userDb.withTransactionAsync(async tx => {
      const diary = new DiaryRepo(tx); const deleted: DiaryEntrySnapshot[] = [];
      for (const id of new Set(ids)) { const entry = await diary.deleteEntry(id); if (entry) deleted.push(entry); }
      return deleted;
    });
    if (snapshots.length) {
      this.setUndoAction({ label: 'Entries deleted', kind: 'delete', run: async () => {
        const restored = await this.deps.userDb.withTransactionAsync(async tx => {
          const diary = new DiaryRepo(tx); const entries: DiaryEntrySnapshot[] = [];
          for (const snapshot of snapshots) entries.push(await diary.restoreEntry(snapshot));
          return entries;
        });
        await Promise.all(
          restored.map(entry => this.enqueueEntryHealthSync(entry.id, () => this.healthEngine.syncEntryConfirmed(entry))),
        );
      } });
      this.refresh();
      await Promise.all(
        snapshots.map(snapshot => this.enqueueEntryHealthSync(snapshot.id, () => this.healthEngine.syncEntryDeleted(snapshot.id))),
      );
    } else {
      this.refresh();
    }
    return snapshots;
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
    if (result.originals.length) {
      this.setUndoAction({
        label: result.originals.length === 1
          ? `Moved ${result.originals[0]!.food.name} to ${toMeal}`
          : `Moved ${result.originals.length} entries to ${toMeal}`,
        kind: 'move',
        run: async () => {
          await this.deps.userDb.withTransactionAsync(async tx => {
            const diary = new DiaryRepo(tx); for (const entry of result.originals) await diary.updateEntry(entry);
          });
          await Promise.all(
            result.originals.map(entry => this.enqueueEntryHealthSync(entry.id, () => this.healthEngine.syncEntryConfirmed(entry))),
          );
        },
      });
      this.refresh();
      await Promise.all(
        result.moved.map(entry => this.enqueueEntryHealthSync(entry.id, () => this.healthEngine.syncEntryConfirmed(entry))),
      );
    } else {
      this.refresh();
    }
    return result.moved;
  }
  async updateEntryQuantity(entry: DiaryEntrySnapshot, newQuantity: Quantity) {
    if (newQuantity.amount <= 0) throw new Error('Enter an amount greater than zero');
    const { original, updated } = await this.deps.userDb.withTransactionAsync(async tx => {
      const diary = new DiaryRepo(tx); const original = await diary.getEntry(entry.id);
      if (!original) throw new Error('Diary entry not found');
      if (original.provenance_kind === 'recipe_batch') {
        const resolved = resolveQuantityToBasis(original.food, newQuantity);
        if (resolved.factor > MAX_BATCH_FRACTION + 1e-9) {
          throw new Error('Batch portion cannot exceed the cooked batch');
        }
      }
      // Recalculate from the frozen basis, never today's recipe or catalog record.
      const nutrients = calculateNutrition(original.food, newQuantity);
      const updated = await diary.updateEntry({ ...original, quantity: newQuantity, nutrients,
        unknown_nutrient_counts: original.unknown_nutrient_counts ?? sumNutrients([nutrients]).unknownCount });
      return { original, updated };
    });
    this.setUndoAction({ label: 'Portion updated', kind: 'update', run: async () => {
      await this.deps.diary.updateEntry(original);
      await this.enqueueEntryHealthSync(original.id, () => this.healthEngine.syncEntryConfirmed(original));
    } });
    this.refresh();
    await this.enqueueEntryHealthSync(updated.id, () => this.healthEngine.syncEntryConfirmed(updated));
    return updated;
  }
  async day(date: string) {
    const [day, goals] = await Promise.all([this.deps.diary.getDiaryDay(date), this.deps.goals.listGoalPeriods()]);
    return { day, totals: sumNutrients(day?.entries ?? []), goal: getActiveGoalForDate(goals, date) };
  }
  private buildDailySeries(start: string, count: number, days: DiaryDay[], goals: GoalPeriod[]) {
    const byDate = new Map(days.map(item => [item.date, item]));
    return Array.from({ length: count }, (_, index) => {
      const date = shiftDate(start, index);
      const day = byDate.get(date);
      const totals = sumNutrients(day?.entries ?? []);
      const goal = getActiveGoalForDate(goals, date);
      return {
        date,
        shortLabel: date.slice(8),
        kcal: totals.nutrients?.kcal ?? 0,
        targetKcal: goal?.target_kcal ?? null,
        completeness: totals.entryCount > 0 ? ('complete' as const) : ('none' as const),
        proteinG: totals.nutrients?.protein_g,
        carbsG: totals.nutrients?.carbs_g,
        fatG: totals.nutrients?.fat_g,
      };
    });
  }
  async dailyRange(start: string, count: number) {
    const safeCount = Math.max(0, Math.floor(count));
    if (safeCount === 0) return [];
    const end = shiftDate(start, safeCount - 1);
    const [days, goals] = await Promise.all([
      this.deps.diary.listDiaryDays(start, end),
      this.deps.goals.listGoalPeriods(),
    ]);
    return this.buildDailySeries(start, safeCount, days, goals);
  }
  async saveCustomFood(input: unknown, options?: { undoLabel?: string }) {
    const food = foodRecordSchema.parse(input);
    const previous = options?.undoLabel ? await this.deps.library.getCustomFood(food.id) : null;
    await this.deps.library.upsertCustomFood(food);
    if (previous && options?.undoLabel) {
      this.setUndoAction({
        label: options.undoLabel,
        kind: 'update',
        run: async () => {
          await this.deps.library.upsertCustomFood(previous);
        },
      });
    }
    this.refresh();
    return food;
  }
  async deleteCustomFood(id: string) {
    await this.deps.userDb.withTransactionAsync(async tx => {
      const library = new LibraryRepo(tx);
      const existing = await library.getCustomFood(id);
      await library.deleteCustomFood(id);
      if (!existing) return;
      const key = foodKey(existing);
      const [records, pins] = await Promise.all([
        tx.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', 'libraryPinnedFoods'),
        tx.getFirstAsync<{ value_json: string }>('SELECT value_json FROM preferences WHERE key=?', 'libraryVisualPins'),
      ]);
      const now = new Date().toISOString();
      if (records) {
        const foods: FoodRecord[] = JSON.parse(records.value_json);
        await tx.runAsync('INSERT INTO preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', 'libraryPinnedFoods', JSON.stringify(foods.filter(item => foodKey(item) !== key)), now);
      }
      if (pins) {
        const ids: string[] = JSON.parse(pins.value_json);
        await tx.runAsync('INSERT INTO preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', 'libraryVisualPins', JSON.stringify(ids.filter(item => item !== key)), now);
      }
    });
    this.refresh();
  }
  resolveBarcode(rawCode: string, symbology?: string): Promise<BarcodeResolution> { return this.barcodeResolver.resolve(rawCode, symbology); }
  async saveCustomFoodWithBarcode(input: unknown, barcode: { rawCode: string; symbology?: string } | null): Promise<FoodRecord> {
    const food = foodRecordSchema.parse(input);
    await this.deps.library.upsertCustomFood(food, barcode); this.refresh(); return food;
  }
  parseLabelText(text: string) { return parseNutritionLabelText(text); }
  private async readOAuthSession(): Promise<OAuthSession | null> {
    if (this.credentials.getOAuthSession) return this.credentials.getOAuthSession();
    const token = await this.credentials.getOAuthToken();
    return token ? { accessToken: token } : null;
  }
  private async saveOAuthSession(session: OAuthSession): Promise<void> {
    if (this.credentials.setOAuthSession) await this.credentials.setOAuthSession(session);
    else await this.credentials.setOAuthToken(session.accessToken);
  }
  private async resolveValidOAuthAccessToken(
    forceRefresh = false,
    expectedGen = this.credentialGeneration,
    callerSignal?: AbortSignal,
  ): Promise<string | null> {
    if (callerSignal?.aborted) throw new AIError('timeout');
    if (this.credentialGeneration !== expectedGen) return null;
    const session = await this.readOAuthSession();
    if (!session || this.credentialGeneration !== expectedGen) return null;
    const expiringSoon = session.expiresAtMs !== undefined && Date.now() >= session.expiresAtMs - 60_000;
    if (!forceRefresh && !expiringSoon) return session.accessToken;
    const clientId = session.clientId ?? process.env.EXPO_PUBLIC_OPENAI_OAUTH_CLIENT_ID?.trim();
    if (!session.refreshToken || !clientId) {
      if (forceRefresh) {
        await this.withCredentialLock(async () => {
          if (this.credentialGeneration !== expectedGen) return;
          this.invalidateCredentials();
          await this.credentials.clearOAuthToken();
          this.refresh();
        });
        return null;
      }
      return session.accessToken;
    }
    if (!this.refreshingOAuth || this.refreshingOAuth.gen !== expectedGen) {
      const refreshGen = expectedGen;
      const attemptedRefreshToken = session.refreshToken!;
      const refreshAbort = new AbortController();
      const refreshTimer = setTimeout(() => refreshAbort.abort(), 15_000);
      let promise: Promise<string | null> | undefined;
      promise = (async () => {
        try {
          // Re-check latest stored session before hitting the token endpoint in case a peer just rotated the refresh token.
          const latest = await this.readOAuthSession();
          if (this.credentialGeneration !== refreshGen || !latest) return null;
          if (latest.refreshToken && latest.refreshToken !== attemptedRefreshToken) {
            const stillFresh = latest.expiresAtMs === undefined || Date.now() < latest.expiresAtMs - 60_000;
            if (!forceRefresh && stillFresh) return latest.accessToken;
          }
          const activeRefreshToken = latest.refreshToken ?? attemptedRefreshToken;
          const tokens = await refreshAccessToken({
            clientId,
            refreshToken: activeRefreshToken,
            fetch: this.deps.aiFetch,
            signal: refreshAbort.signal,
          });
          if (tokens.scope !== undefined && !hasRequiredOAuthScope(tokens.scope)) {
            throw new AIError('auth_expired');
          }
          const next: OAuthSession = {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? activeRefreshToken,
            expiresAtMs: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
            clientId,
            ...(latest.accountSubject ?? session.accountSubject ? { accountSubject: latest.accountSubject ?? session.accountSubject } : {}),
          };
          let saved = false;
          await this.withCredentialLock(async () => {
            if (this.credentialGeneration !== refreshGen) return;
            await this.saveOAuthSession(next);
            saved = true;
          });
          return saved ? next.accessToken : null;
        } catch (error) {
          if (error instanceof AIError && error.code === 'auth_expired') {
            await this.withCredentialLock(async () => {
              if (this.credentialGeneration !== refreshGen) return;
              const current = await this.readOAuthSession();
              if (current?.refreshToken && current.refreshToken !== attemptedRefreshToken) return;
              this.invalidateCredentials();
              await this.credentials.clearOAuthToken();
              this.refresh();
            });
          }
          throw error;
        } finally {
          clearTimeout(refreshTimer);
          if (this.refreshingOAuth?.promise === promise) {
            this.refreshingOAuth = null;
          }
        }
      })();
      this.refreshingOAuth = { gen: refreshGen, promise };
    }
    const inflight = this.refreshingOAuth.promise;
    const waitResult = callerSignal
      ? new Promise<string | null>((resolve, reject) => {
          if (callerSignal.aborted) {
            reject(new AIError('timeout'));
            return;
          }
          const onAbort = () => reject(new AIError('timeout'));
          callerSignal.addEventListener('abort', onAbort, { once: true });
          inflight.then(
            value => { callerSignal.removeEventListener('abort', onAbort); resolve(value); },
            error => { callerSignal.removeEventListener('abort', onAbort); reject(error); },
          );
        })
      : inflight;
    try {
      return await waitResult;
    } catch (error) {
      if (
        !forceRefresh &&
        !(error instanceof AIError && error.code === 'auth_expired') &&
        !callerSignal?.aborted &&
        this.credentialGeneration === expectedGen
      ) {
        return session.accessToken;
      }
      throw error;
    }
  }
  private async aiConnection() {
    const oauth = await this.readOAuthSession();
    if (oauth?.accessToken) return { mode: 'chatgpt_oauth' as const, token: oauth.accessToken };
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
    this.pendingCredentialMutations++;
    this.invalidateCredentials();
    try {
      await this.withCredentialLock(async () => {
        this.invalidateCredentials();
        await this.credentials.setApiKey(key);
        await this.credentials.clearOAuthToken();
        this.draftGeneration++;
        this.refresh();
      });
    } finally {
      this.pendingCredentialMutations--;
    }
  }
  cancelChatGPTOAuth(): void {
    this.activeOAuthCancel?.();
  }
  cancelPendingOAuthCallback(): void {
    this.activeOAuthCallbackCancel?.();
  }
  private oauthHostId: string | null = null;
  private async getOrCreateOAuthHostId(): Promise<string> {
    const stored = (await this.credentials.getOAuthHostId?.())?.trim();
    if (stored) {
      this.oauthHostId = stored;
      return stored;
    }
    if (this.oauthHostId) return this.oauthHostId;
    const hostId = `urn:uuid:${generateId()}`;
    this.oauthHostId = hostId;
    await this.credentials.setOAuthHostId?.(hostId);
    return hostId;
  }
  async connectChatGPTOAuth(): Promise<{ ok: boolean; message: string }> {
    if (!this.deps.loopbackAuth) return { ok: false, message: 'Sign in with ChatGPT requires a native mobile dev build with the 127.0.0.1 loopback listener. You can connect an OpenAI API key right now, or keep tracking manually.' };
    const attemptId = ++this.oauthConnectAttempt;
    const startGen = this.credentialGeneration;
    let session: Awaited<ReturnType<LoopbackAuthPort['listen']>> | undefined;
    let cancelledByUser = false;
    let callbackReceived = false;
    const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(), 120_000);
    const cancelAttempt = () => {
      cancelledByUser = true;
      timeout.abort();
    };
    const cancelIfAwaitingCallback = () => {
      if (!callbackReceived) cancelAttempt();
    };
    this.activeOAuthCancel = cancelAttempt;
    this.activeOAuthCallbackCancel = cancelIfAwaitingCallback;
    try {
      const envClientId = process.env.EXPO_PUBLIC_OPENAI_OAUTH_CLIENT_ID?.trim();
      const [existingSession, storedRegistration] = await Promise.all([
        this.readOAuthSession(),
        this.credentials.getOAuthRegistration?.() ?? Promise.resolve(null),
      ]);
      if (cancelledByUser || timeout.signal.aborted) {
        throw new AIError('timeout');
      }
      const requestedClientId = envClientId || existingSession?.clientId?.trim() || storedRegistration?.clientId?.trim() || OPENAI_DYNAMIC_CLIENT_ID;
      const extAgentHostId = envClientId ? undefined : await this.getOrCreateOAuthHostId();
      if (cancelledByUser || timeout.signal.aborted) {
        throw new AIError('timeout');
      }
      const pkce = await generatePkcePair(this.deps.pkceCrypto ?? undefined);
      if (cancelledByUser || timeout.signal.aborted) {
        throw new AIError('timeout');
      }
      session = await this.deps.loopbackAuth.listen({ host: '127.0.0.1', path: '/callback', expectedState: pkce.state, signal: timeout.signal });
      const callback = session.callback;
      // Attach a handler before opening the browser so cancellation cannot reject unobserved.
      void callback.catch(() => undefined);
      const authUrl = buildAuthorizationUrl({
        clientId: requestedClientId,
        port: session.port,
        codeChallenge: pkce.codeChallenge,
        state: pkce.state,
        nonce: pkce.nonce,
        extAgentHostId,
        agentNameHint: requestedClientId === OPENAI_DYNAMIC_CLIENT_ID ? DEFAULT_AGENT_NAME_HINT : undefined,
      });
      let dismissBrowser: (() => void) | undefined;
      let browserOutcome: Promise<never> | null = null;
      try {
        const webBrowser = await import('expo-web-browser');
        // Launch in-app Custom Tabs / Safari without awaiting Android's immediate 'opened' result;
        // fail fast on iOS user cancel/dismiss or launch failure instead of waiting for the 2-minute timeout.
        browserOutcome = webBrowser.openBrowserAsync(authUrl).then(
          result => {
            if (result?.type === 'cancel' || result?.type === 'dismiss') {
              cancelledByUser = true;
              throw new Error('ChatGPT sign-in was cancelled.');
            }
            return new Promise<never>(() => {});
          },
          async () => {
            const { openURL } = await import('expo-linking');
            await openURL(authUrl);
            return new Promise<never>(() => {});
          },
        );
        void browserOutcome.catch(() => undefined);
        dismissBrowser = () => {
          void Promise.resolve().then(() => webBrowser.dismissBrowser?.()).catch(() => undefined);
        };
      } catch {
        const { openURL } = await import('expo-linking');
        await openURL(authUrl);
      }
      const timeoutPromise = new Promise<never>((_, reject) => {
        const abort = () => reject(new AIError('timeout'));
        if (timeout.signal.aborted) abort(); else timeout.signal.addEventListener('abort', abort, { once: true });
      });
      const response = await Promise.race([
        callback,
        timeoutPromise,
        ...(browserOutcome ? [browserOutcome] : []),
      ]).finally(() => { dismissBrowser?.(); });
      callbackReceived = true;
      const issuedClientId = response.clientId?.trim();
      if (requestedClientId !== OPENAI_DYNAMIC_CLIENT_ID && issuedClientId && issuedClientId !== requestedClientId) {
        throw new AIError('auth_expired');
      }
      const effectiveClientId = issuedClientId || requestedClientId;
      if (effectiveClientId === OPENAI_DYNAMIC_CLIENT_ID) {
        throw new AIError('auth_expired');
      }
      const tokens = await exchangeAuthorizationCode({
        clientId: effectiveClientId,
        port: session.port,
        code: response.code,
        state: response.state,
        codeVerifier: pkce.codeVerifier,
        expectedState: pkce.state,
        fetch: this.deps.aiFetch,
        signal: timeout.signal,
      });
      if (!hasRequiredOAuthScope(tokens.scope)) {
        return {
          ok: false,
          message: 'Your ChatGPT plan did not grant direct token access for this app. Check your ChatGPT plan settings or connect an OpenAI API key.',
        };
      }
      if (!tokens.id_token) {
        throw new AIError('auth_expired');
      }
      const verifiedIdentity = await verifyOAuthIdToken({
        idToken: tokens.id_token,
        expectedNonce: pkce.nonce,
        expectedAudience: effectiveClientId,
        fetch: this.deps.aiFetch,
        pkceCrypto: this.deps.pkceCrypto ?? undefined,
        signal: timeout.signal,
      });
      if (
        existingSession?.accountSubject &&
        existingSession.clientId === effectiveClientId &&
        verifiedIdentity.sub !== existingSession.accountSubject
      ) {
        return {
          ok: false,
          message: 'Signed in to a different ChatGPT account than the active session. Disconnect first to switch accounts.',
        };
      }
      const committed = await this.withCredentialLock(async () => {
        if (cancelledByUser || timeout.signal.aborted || this.oauthConnectAttempt !== attemptId || this.credentialGeneration !== startGen) {
          return false;
        }
        this.pendingCredentialMutations++;
        this.invalidateCredentials();
        try {
          await this.saveOAuthSession({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAtMs: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
            clientId: effectiveClientId,
            accountSubject: verifiedIdentity.sub,
          });
          await this.credentials.setOAuthRegistration?.({
            clientId: effectiveClientId,
            accountSubject: verifiedIdentity.sub,
          });
          await this.credentials.clearApiKey();
          this.draftGeneration++;
          this.refresh();
          return true;
        } finally {
          this.pendingCredentialMutations--;
        }
      });
      if (!committed) {
        if (cancelledByUser) return { ok: false, message: 'ChatGPT sign-in was cancelled.' };
        return { ok: false, message: 'AI settings changed during sign-in. Try connecting again if needed.' };
      }
      return { ok: true, message: 'Connected with ChatGPT.' };
    } catch (error) {
      if (cancelledByUser) return { ok: false, message: 'ChatGPT sign-in was cancelled.' };
      return { ok: false, message: error instanceof AIError ? error.message : 'ChatGPT sign-in could not finish. Try again or connect an OpenAI API key.' };
    }
    finally {
      clearTimeout(timer);
      if (this.activeOAuthCancel === cancelAttempt) this.activeOAuthCancel = null;
      if (this.activeOAuthCallbackCancel === cancelIfAwaitingCallback) this.activeOAuthCallbackCancel = null;
      await session?.close();
    }
  }
  async disconnectAI(): Promise<{ revokedRemote: boolean }> {
    this.pendingCredentialMutations++;
    this.invalidateCredentials();
    let revokedContext: { clientId: string | undefined; tokenToRevoke: string | undefined };
    try {
      revokedContext = await this.withCredentialLock(async () => {
        this.invalidateCredentials();
        this.draftGeneration++;
        const session = await this.readOAuthSession();
        const clientId = session?.clientId ?? process.env.EXPO_PUBLIC_OPENAI_OAUTH_CLIENT_ID?.trim();
        const tokenToRevoke = session?.refreshToken ?? session?.accessToken;
        const results = await Promise.allSettled([
          this.credentials.clearOAuthToken(),
          this.credentials.clearApiKey(),
        ]);
        this.refresh();
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failed) throw failed.reason;
        return { clientId, tokenToRevoke };
      });
    } finally {
      this.pendingCredentialMutations--;
    }
    if (!revokedContext.clientId || !revokedContext.tokenToRevoke) {
      return { revokedRemote: true };
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5_000);
    try {
      const revokedRemote = await revokeOAuthToken({
        clientId: revokedContext.clientId,
        token: revokedContext.tokenToRevoke,
        fetch: this.deps.aiFetch,
        signal: abort.signal,
      });
      return { revokedRemote };
    } finally {
      clearTimeout(timer);
    }
  }
  private async connectedProvider() {
    if (this.pendingCredentialMutations > 0) throw new AIError('not_connected');
    const capturedGen = this.credentialGeneration;
    const capturedConsentGen = this.aiConsentGeneration;
    const authAbortSignal = this.credentialAbortController.signal;
    const connection = await this.aiConnection();
    if (!connection || this.pendingCredentialMutations > 0 || this.credentialGeneration !== capturedGen) throw new AIError('not_connected');
    const preferences = await this.getPreferences();
    if (this.pendingCredentialMutations > 0 || this.credentialGeneration !== capturedGen) throw new AIError('not_connected');
    if (this.aiConsentGeneration !== capturedConsentGen || !preferences.aiConsentAccepted) throw new AIError('refusal');
    const provider = this.deps.aiProviderFactory?.(connection.token, connection.mode)
      ?? new OpenAIResponsesProvider({
        authMode: connection.mode,
        getAccessToken: async signal => {
          if (this.pendingCredentialMutations > 0 || this.credentialGeneration !== capturedGen || this.aiConsentGeneration !== capturedConsentGen) return null;
          if (connection.mode === 'api_key') {
            const key = await this.credentials.getApiKey();
            return this.pendingCredentialMutations === 0 && this.credentialGeneration === capturedGen && this.aiConsentGeneration === capturedConsentGen ? key : null;
          }
          return this.resolveValidOAuthAccessToken(false, capturedGen, signal);
        },
        onAuthExpiredRetry:
          connection.mode === 'chatgpt_oauth'
            ? signal => {
                if (this.pendingCredentialMutations > 0 || this.aiConsentGeneration !== capturedConsentGen) return Promise.resolve(null);
                return this.resolveValidOAuthAccessToken(true, capturedGen, signal);
              }
            : undefined,
        canSendRequest: () =>
          this.pendingCredentialMutations === 0 && this.credentialGeneration === capturedGen && this.aiConsentGeneration === capturedConsentGen,
        authAbortSignal,
        fetch: this.deps.aiFetch,
      });
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
  updateDraftItemQuantity(itemIndex: number, quantity: Quantity): void {
    const draft = this.activeDraft;
    if (!draft) throw new Error('No active draft');
    if (this.confirmingDraft) throw new Error('The draft is being confirmed');
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= draft.proposal.items.length) throw new Error('Draft item not found');
    if (!Number.isFinite(quantity.amount) || quantity.amount <= 0) throw new Error('Enter an amount greater than zero');
    const item = draft.proposal.items[itemIndex]!;
    const nutrients = calculateNutrition(item.food, quantity);
    const { unknownCount } = sumNutrients([nutrients]);
    const updated = { ...item, quantity, nutrients, unknownCount, portion_certainty: 'stated' as const, estimate_range: null };
    const items = [...draft.proposal.items]; items[itemIndex] = updated;
    const manualQuantities = { ...(draft.proposal.manual_quantities ?? {}), [String(itemIndex)]: quantity };
    this.activeDraft = { ...draft, proposal: { ...draft.proposal, items, manual_quantities: manualQuantities, totals: this.draftTotals(items) } };
    this.draftGeneration++; this.refresh();
  }
  async saveActiveDraftAsMeal(name: string): Promise<SavedMeal> {
    if (!name.trim()) throw new Error('Enter a meal name');
    const draft = this.activeDraft;
    if (!draft?.proposal.items.length) throw new Error('No active draft items');
    const items: RecipeIngredient[] = draft.proposal.items.map(({ food, quantity, nutrients }) => ({ food, quantity, nutrients }));
    return this.saveSavedMeal({ name: name.trim(), items });
  }
  removeDraftItem(itemId: string): void {
    const draft = this.activeDraft; if (!draft || this.confirmingDraft) return;
    const index = /^\d+$/.test(itemId) ? Number(itemId) : draft.proposal.items.findIndex(item => item.food.id === itemId);
    const items = draft.proposal.items.filter((_, itemIndex) => itemIndex !== index);
    if (items.length === draft.proposal.items.length) return;
    const proposal = draft.proposal;
    let baseItems = proposal.base_items;
    let questions = proposal.clarifying_questions;
    const nextManual: Record<string, Quantity> = {};
    for (const [key, qty] of Object.entries(proposal.manual_quantities ?? {})) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx === index) continue;
      nextManual[String(idx > index ? idx - 1 : idx)] = qty;
    }
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
    const { manual_quantities: _removedManual, ...restProposal } = proposal;
    void _removedManual;
    this.activeDraft = items.length ? { ...draft, proposal: { ...restProposal, items, base_items: baseItems,
      ...(Object.keys(nextManual).length ? { manual_quantities: nextManual } : {}),
      totals: this.draftTotals(items), answers, clarifying_questions: questions } } : null;
    this.draftGeneration++; this.refresh();
  }
  discardActiveDraft(): void { this.draftGeneration++; this.activeDraft = null; this.refresh(); }
  confirmActiveDraft(idempotencyPrefix = generateId()): Promise<DiaryEntrySnapshot[]> {
    if (this.confirmingDraft) return this.confirmingDraft;
    const draft = this.activeDraft; if (!draft) return Promise.resolve([]);
    const confirmation = this.deps.userDb.withTransactionAsync(async tx => {
      const diary = new DiaryRepo(tx);
      const entries: DiaryEntrySnapshot[] = [];
      const newlyConfirmed: DiaryEntrySnapshot[] = [];
      for (const [index, item] of draft.proposal.items.entries()) {
        const aggregate = this.draftTotals([item]);
        const snapshot = this.snapshot({ food: item.food, quantity: item.quantity, meal: draft.meal, date: draft.date,
          idempotencyKey: `${idempotencyPrefix}:${index}` }, aggregate);
        const result = await diary.confirmEntryWithStatus({ ...snapshot, provenance_kind: item.provenance_kind,
          portion_certainty: item.portion_certainty,
          estimate_range: item.estimate_range ? { min_g: item.estimate_range.min_g, max_g: item.estimate_range.max_g } : null });
        entries.push(result.entry);
        if (result.changed) newlyConfirmed.push(result.entry);
      }
      return { entries, newlyConfirmed };
    }).then(async ({ entries, newlyConfirmed }) => {
      if (this.activeDraft === draft) this.activeDraft = null;
      if (newlyConfirmed.length) {
        this.setUndoAction({
          label: `Added ${newlyConfirmed.length} ${newlyConfirmed.length === 1 ? 'item' : 'items'} to ${draft.meal}`,
          kind: 'add',
          date: draft.date,
          meal: draft.meal,
          run: async () => {
            await this.deps.userDb.withTransactionAsync(async tx => {
              const diary = new DiaryRepo(tx); for (const entry of newlyConfirmed) await diary.deleteEntry(entry.id);
            });
            await Promise.all(
              newlyConfirmed.map(entry => this.enqueueEntryHealthSync(entry.id, () => this.healthEngine.syncEntryDeleted(entry.id))),
            );
          },
        });
      }
      this.refresh();
      await Promise.all(
        newlyConfirmed.map(entry => this.enqueueEntryHealthSync(entry.id, () => this.healthEngine.syncEntryConfirmed(entry))),
      );
      return entries;
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
    // A same-day edit replaces today's period atomically, never creating duplicate dates.
    await this.deps.userDb.withTransactionAsync(async tx => {
      const goals = new GoalsRepo(tx);
      const sameDay = (await goals.listGoalPeriods()).find(goal => goal.effective_from_date === date);
      await goals.upsertGoalPeriod({ ...input, id: sameDay?.id ?? generateId(), effective_from_date: date });
    });
    this.refresh();
  }
  async weighIn(weightKg: number, date = localDate(), measuredAt?: string) {
    isoDateSchema.parse(date);
    const resolvedMeasuredAt = measuredAt ?? (date === localDate() ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString());
    await this.deps.goals.recordWeighIn({ id: generateId(), measured_at: resolvedMeasuredAt, date,
      weight_kg: weightKg, source: 'manual', external_source_id: null }); this.refresh();
  }
  async progress(range: number, end = localDate()) {
    const safeRange = Math.max(0, Math.floor(range));
    const start = shiftDate(end, 1 - safeRange);
    const today = localDate();
    const statsEnd = end > today ? today : end;
    const [days, goals, weighIns] = await Promise.all([
      safeRange > 0 ? this.deps.diary.listDiaryDays(start, end) : Promise.resolve([]),
      this.deps.goals.listGoalPeriods(),
      this.deps.goals.listWeighIns(),
    ]);
    const complete = days.filter(day => sumNutrients(day.entries).entryCount > 0);
    const total = sumNutrients(complete.flatMap(day => day.entries));
    return {
      completeDays: complete.length,
      excludedDays: safeRange - complete.length,
      averages: total.nutrients ? scaleNutrients(total.nutrients, 1 / complete.length) : null,
      unknownCount: total.unknownCount,
      trend: calculateWeightTrend(weighIns),
      daily: safeRange > 0 ? this.buildDailySeries(start, safeRange, days, goals) : [],
      targetGoal: getActiveGoalForDate(goals, statsEnd),
    };
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
  async exportDiaryCsv(): Promise<string> { return formatDiaryCsv(await this.deps.diary.listDiaryDays()); }
  async exportWeightCsv(): Promise<string> { return formatWeightTrendsCsv(calculateWeightTrend(await this.deps.goals.listWeighIns())); }
  previewRestore(json: string) {
    const bundle = exportBundleV1Schema.parse(JSON.parse(json));
    for (const recipe of bundle.recipes) {
      for (const ingredient of recipe.ingredients) calculateNutrition(ingredient.food, ingredient.quantity);
    }
    for (const batch of bundle.recipe_batches) {
      for (const ingredient of batch.ingredients) calculateNutrition(ingredient.food, ingredient.quantity);
    }
    for (const meal of bundle.saved_meals ?? []) {
      for (const ingredient of meal.items) calculateNutrition(ingredient.food, ingredient.quantity);
    }
    const { goals, dropped } = deduplicateGoalPeriods(bundle.goal_periods);
    return { bundle, days: bundle.diary_days.length, entries: bundle.diary_days.reduce((sum, day) => sum + day.entries.length, 0),
      foods: bundle.custom_foods.length, packs: bundle.packs.length, goals: goals.length, droppedDuplicateGoals: dropped,
      weighIns: bundle.weigh_ins.length, waterLogs: bundle.water_logs.length };
  }
  async restoreJson(json: string, mode: 'merge' | 'replace'): Promise<{ packErrors: string[] }> {
    const { bundle } = this.previewRestore(json);
    await restoreBundleV1(this.deps.userDb, bundle, { mode });
    const packErrors: string[] = [];
    if (mode === 'replace') {
      this.activeDraft = null;
      this.draftGeneration++;
      this.setUndoAction(null);
      await this.deps.catalog.close();
      this.foodCounts.clear();
      this.refresh();
      if (this.deps.resolveBundledPack) {
        const installed = await this.deps.packs.listInstalledPacks();
        let usdaMounted = false;
        const tryRemount = async (packId: string, priority: number) => {
          let bundledPack: { db: SqlDatabase; filePath: string } | null = null;
          try {
            bundledPack = await this.deps.resolveBundledPack!(packId);
          } catch (error) {
            packErrors.push(`${packId}: ${error instanceof Error ? error.message : 'Could not load bundled pack'}`);
            return false;
          }
          if (!bundledPack) return false;
          try {
            await this.installPack(bundledPack.db, bundledPack.filePath, priority);
            return true;
          } catch (error) {
            packErrors.push(`${packId}: ${error instanceof Error ? error.message : 'Could not mount bundled pack'}`);
            return false;
          }
        };
        for (const pack of installed) {
          if (pack.file_path) continue;
          const mounted = await tryRemount(pack.pack_id, pack.priority);
          if (mounted && pack.pack_id === 'usda-fdc-starter') usdaMounted = true;
        }
        if (!usdaMounted) {
          await tryRemount('usda-fdc-starter', 100);
        }
      }
      return { packErrors };
    }
    this.setUndoAction(null); this.refresh();
    return { packErrors };
  }
  async deleteLocalData(options?: { clearSandboxExports?: (() => Promise<void>) | undefined }): Promise<void> {
    this.invalidateCredentials();
    this.invalidateAIConsent();
    this.activeDraft = null;
    this.setUndoAction(null);
    await this.restoreJson(
      JSON.stringify({
        schema_version: 1,
        exported_at: new Date().toISOString(),
        diary_days: [],
        custom_foods: [],
        recipes: [],
        recipe_batches: [],
        goal_periods: [],
        weigh_ins: [],
        packs: [],
        water_logs: [],
        saved_meals: [],
        user_food_units: [],
        custom_food_barcodes: [],
        learned_portions: [],
      }),
      'replace',
    );
    if (this.deps.offCacheDb) {
      await this.deps.offCacheDb.runAsync('DELETE FROM off_products').catch(() => undefined);
    }
    await options?.clearSandboxExports?.();
    await this.disconnectAI();
  }
  async close() {
    this.clearUndoTimer();
    this.draftGeneration++; await this.deps.catalog.close();
    await this.deps.offCacheDb?.closeAsync(); await this.deps.userDb.closeAsync();
  }
}
