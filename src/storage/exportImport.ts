import { calculateNutrition, exportBundleV1Schema } from '../domain';
import type { ExportBundleV1, GoalPeriod } from '../domain';
import type { SqlDatabase } from './driver';
import { DiaryRepo } from './repos/diaryRepo';
import { GoalsRepo } from './repos/goalsRepo';
import { LibraryRepo } from './repos/libraryRepo';
import { PacksRepo } from './repos/packsRepo';
import { WaterRepo } from './repos/waterRepo';
import { nowIso } from './repos/shared';

export async function exportBundleV1(db: SqlDatabase, exportedAt = nowIso()): Promise<ExportBundleV1> {
  return db.withTransactionAsync(async (tx) => {
    const library = new LibraryRepo(tx);
    const goals = new GoalsRepo(tx);
    const userFoodUnits = await tx.getAllAsync<{ food_key: string; label: string; grams: number | null; ml: number | null }>(
      'SELECT food_key,label,grams,ml FROM user_food_units ORDER BY food_key,label',
    );
    const customFoodBarcodes = await tx.getAllAsync<{ food_id: string; raw_code: string; symbology: string; gtin14: string | null }>(
      'SELECT id AS food_id,barcode_raw AS raw_code,barcode_symbology AS symbology,barcode_gtin14 AS gtin14 FROM custom_foods WHERE barcode_raw IS NOT NULL AND barcode_symbology IS NOT NULL ORDER BY id',
    );
    return exportBundleV1Schema.parse({
      schema_version: 1, exported_at: exportedAt,
      diary_days: await new DiaryRepo(tx).listDiaryDays(),
      custom_foods: await library.listCustomFoods(), recipes: await library.listRecipes(),
      recipe_batches: await library.listRecipeBatches(), goal_periods: await goals.listGoalPeriods(),
      weigh_ins: await goals.listWeighIns(), packs: (await new PacksRepo(tx).listInstalledPacks()).map((row) => row.meta),
      water_logs: await new WaterRepo(tx).listWaterLogs(),
      saved_meals: await library.listSavedMeals(),
      user_food_units: userFoodUnits,
      custom_food_barcodes: customFoodBarcodes,
      learned_portions: await library.listAllLearnedPortions(),
    });
  });
}

export function deduplicateGoalPeriods(goals: readonly GoalPeriod[]): { goals: GoalPeriod[]; dropped: number } {
  const byDate = new Map<string, GoalPeriod>();
  for (const goal of goals) {
    byDate.set(goal.effective_from_date, goal);
  }
  const unique = [...byDate.values()];
  return { goals: unique, dropped: goals.length - unique.length };
}

/** V1 exports pack metadata, never local filesystem paths or pack database contents. */
export async function restoreBundleV1(db: SqlDatabase, rawBundle: unknown, options: { mode: 'replace' | 'merge' }): Promise<void> {
  const bundle = exportBundleV1Schema.parse(rawBundle);
  if (options.mode !== 'replace' && options.mode !== 'merge') throw new Error('Invalid restore mode');
  // Validate ingredient conversions before modifying any stored records.
  for (const recipe of bundle.recipes) {
    for (const ingredient of recipe.ingredients) calculateNutrition(ingredient.food, ingredient.quantity);
  }
  for (const batch of bundle.recipe_batches) {
    for (const ingredient of batch.ingredients) calculateNutrition(ingredient.food, ingredient.quantity);
  }
  for (const meal of bundle.saved_meals ?? []) {
    for (const ingredient of meal.items) calculateNutrition(ingredient.food, ingredient.quantity);
  }
  const { goals: uniqueGoals } = deduplicateGoalPeriods(bundle.goal_periods);
  const hasSavedMeals = bundle.saved_meals !== undefined;
  const hasUserFoodUnits = bundle.user_food_units !== undefined;
  const hasCustomFoodBarcodes = bundle.custom_food_barcodes !== undefined;
  const hasLearnedPortions = bundle.learned_portions !== undefined;
  await db.withTransactionAsync(async (tx) => {
    const preservedBarcodes = new Map<string, { raw_code: string; symbology: string; gtin14: string | null }>();
    if (options.mode === 'replace') {
      if (!hasCustomFoodBarcodes) {
        const existingBarcodes = await tx.getAllAsync<{ food_id: string; raw_code: string; symbology: string; gtin14: string | null }>(
          'SELECT id AS food_id,barcode_raw AS raw_code,barcode_symbology AS symbology,barcode_gtin14 AS gtin14 FROM custom_foods WHERE barcode_raw IS NOT NULL AND barcode_symbology IS NOT NULL',
        );
        for (const row of existingBarcodes) preservedBarcodes.set(row.food_id, row);
      }
      const tables = [
        'health_sync_records',
        'offline_photo_drafts',
        'water_logs',
        'diary_entries',
        'diary_days',
        'custom_foods',
        'recipes',
        'recipe_batches',
        ...(hasSavedMeals ? ['saved_meals'] : []),
        ...(hasUserFoodUnits ? ['user_food_units'] : []),
        ...(hasLearnedPortions ? ['learned_portions'] : []),
        'goal_periods',
        'weigh_ins',
        'installed_packs',
        'preferences',
      ];
      for (const table of tables) {
        await tx.execAsync(`DELETE FROM ${table}`);
      }
    }
    const diary = new DiaryRepo(tx);
    const library = new LibraryRepo(tx);
    const goals = new GoalsRepo(tx);
    for (const day of bundle.diary_days) {
      await tx.runAsync('INSERT INTO diary_days VALUES(?,?,?) ON CONFLICT(date) DO NOTHING', day.date, day.completeness, nowIso());
      for (const entry of day.entries) {
        const exists = await tx.getFirstAsync('SELECT id FROM diary_entries WHERE id=? OR idempotency_key=?', entry.id, entry.idempotency_key);
        if (!exists) await diary.writeSnapshot(entry);
      }
    }
    const barcodesByFoodId = new Map<string, { rawCode: string; symbology: string }>();
    for (const row of bundle.custom_food_barcodes ?? []) {
      barcodesByFoodId.set(row.food_id, { rawCode: row.raw_code, symbology: row.symbology });
    }
    for (const food of bundle.custom_foods) {
      if (!await library.getCustomFood(food.id)) {
        const barcode = barcodesByFoodId.get(food.id)
          ?? (preservedBarcodes.has(food.id)
            ? { rawCode: preservedBarcodes.get(food.id)!.raw_code, symbology: preservedBarcodes.get(food.id)!.symbology }
            : undefined);
        await library.upsertCustomFood(food, barcode);
      }
    }
    // Restore versions verbatim, bypassing the editor's intentional version bump.
    for (const recipe of bundle.recipes) await tx.runAsync('INSERT INTO recipes VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING', recipe.id, recipe.name, recipe.version, JSON.stringify(recipe), nowIso());
    for (const batch of bundle.recipe_batches) if (!await library.getRecipeBatch(batch.id)) await library.upsertRecipeBatch(batch);
    for (const meal of bundle.saved_meals ?? []) {
      if (!await library.getSavedMeal(meal.id)) await library.upsertSavedMeal(meal);
    }
    for (const unit of bundle.user_food_units ?? []) {
      await tx.runAsync(
        'INSERT INTO user_food_units(food_key,label,grams,ml) VALUES(?,?,?,?) ON CONFLICT(food_key,label) DO NOTHING',
        unit.food_key, unit.label, unit.grams, unit.ml,
      );
    }
    for (const learned of bundle.learned_portions ?? []) {
      await tx.runAsync(
        'INSERT INTO learned_portions(food_key,unit,amount,use_count,last_used_at) VALUES(?,?,?,?,?) ON CONFLICT(food_key,unit,amount) DO NOTHING',
        learned.food_key, learned.unit, learned.amount, learned.use_count, learned.last_used_at,
      );
    }
    for (const goal of uniqueGoals) {
      const conflict = await tx.getFirstAsync('SELECT id FROM goal_periods WHERE id=? OR effective_from_date=?', goal.id, goal.effective_from_date);
      if (!conflict) {
        await tx.runAsync('INSERT INTO goal_periods VALUES(?,?,?)', goal.id, goal.effective_from_date, JSON.stringify(goal));
      }
    }
    for (const entry of bundle.weigh_ins) if (!await tx.getFirstAsync('SELECT id FROM weigh_ins WHERE id=? OR (external_source_id IS NOT NULL AND external_source_id=?)', entry.id, entry.external_source_id)) await goals.recordWeighIn(entry);
    for (const log of bundle.water_logs) {
      await tx.runAsync('INSERT INTO water_logs(id,date,occurred_at,amount_ml) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',
        log.id, log.date, log.occurred_at, log.amount_ml);
    }
    for (const meta of bundle.packs) {
      if (!await tx.getFirstAsync('SELECT pack_id FROM installed_packs WHERE pack_id=?', meta.pack_id)) {
        // Requires re-import of the actual pack file on this device before enabling it.
        await new PacksRepo(tx).registerPack(meta, '', { enabled: false });
      }
    }
  });
}
