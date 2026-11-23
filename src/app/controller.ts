import { calculateNutrition, calculateWeightTrend, exportBundleV1Schema, foodRecordSchema, generateId, getActiveGoalForDate, resolveQuantityToBasis, scaleNutrients, sumNutrients } from '../domain';
import type { DiaryDay, DiaryEntrySnapshot, FoodRecord, GoalPeriod, Quantity } from '../domain';
import { validatePackDatabase } from '../catalog';
import type { FoodSourceRegistry } from '../catalog';
import { exportBundleV1, restoreBundleV1 } from '../storage';
import type { DiaryRepo, GoalsRepo, LibraryRepo, PacksRepo, SqlDatabase } from '../storage';

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
}
export interface UndoAction { label: string; run: () => Promise<void> }

/** No platform imports: the same controller runs against Expo and real Node SQLite. */
export class AppController {
  readonly deps: ControllerDependencies;
  private listeners = new Set<() => void>();
  private revision = 0;
  private foodCounts = new Map<string, number>();
  undoAction: UndoAction | null = null;
  constructor(deps: ControllerDependencies) { this.deps = deps; }
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
  async confirm(input: { food: FoodRecord; quantity: Quantity; meal: Meal; date?: string; idempotencyKey: string }) {
    if (input.quantity.amount <= 0) throw new Error('Enter an amount greater than zero');
    const preview = await this.preview(input.food, input.quantity);
    if (!preview?.nutrients) throw new Error('This portion has no nutrition');
    const entry = await this.deps.diary.confirmEntry({
      id: generateId(), idempotency_key: input.idempotencyKey, date: input.date ?? localDate(),
      occurred_at: new Date().toISOString(), time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      meal: input.meal, food: input.food, quantity: input.quantity, nutrients: preview.nutrients,
      unknown_nutrient_counts: preview.unknownCount, provenance_kind: input.food.provenance_kind,
      portion_certainty: 'stated', estimate_range: null, draft_state: 'confirmed',
    });
    this.undoAction = { label: `Added to ${entry.meal}`, run: async () => { await this.deps.diary.deleteEntry(entry.id); } };
    this.refresh();
    return entry;
  }
  async deleteEntry(id: string) {
    const snapshot = await this.deps.diary.deleteEntry(id);
    if (snapshot) this.undoAction = { label: 'Entry deleted', run: async () => { await this.deps.diary.restoreEntry(snapshot); } };
    this.refresh();
    return snapshot;
  }
  async moveEntry(entry: DiaryEntrySnapshot, meal: Meal) {
    await this.deps.diary.moveEntry(entry.id, entry.date, meal); this.refresh();
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
  async close() { await this.deps.catalog.close(); await this.deps.userDb.closeAsync(); }
}
