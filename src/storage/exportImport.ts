import { exportBundleV1Schema } from '../domain';
import type { ExportBundleV1 } from '../domain';
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
    return exportBundleV1Schema.parse({
      schema_version: 1, exported_at: exportedAt,
      diary_days: await new DiaryRepo(tx).listDiaryDays(),
      custom_foods: await library.listCustomFoods(), recipes: await library.listRecipes(),
      recipe_batches: await library.listRecipeBatches(), goal_periods: await goals.listGoalPeriods(),
      weigh_ins: await goals.listWeighIns(), packs: (await new PacksRepo(tx).listInstalledPacks()).map((row) => row.meta),
      water_logs: await new WaterRepo(tx).listWaterLogs(),
    });
  });
}

/** V1 exports pack metadata, never local filesystem paths or pack database contents. */
export async function restoreBundleV1(db: SqlDatabase, rawBundle: unknown, options: { mode: 'replace' | 'merge' }): Promise<void> {
  const bundle = exportBundleV1Schema.parse(rawBundle);
  if (options.mode !== 'replace' && options.mode !== 'merge') throw new Error('Invalid restore mode');
  await db.withTransactionAsync(async (tx) => {
    if (options.mode === 'replace') {
      for (const table of ['health_sync_records', 'offline_photo_drafts', 'water_logs', 'diary_entries', 'diary_days', 'custom_foods', 'recipes', 'recipe_batches', 'saved_meals', 'user_food_units', 'learned_portions', 'goal_periods', 'weigh_ins', 'installed_packs', 'preferences']) {
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
    for (const food of bundle.custom_foods) if (!await library.getCustomFood(food.id)) await library.upsertCustomFood(food);
    // Restore versions verbatim, bypassing the editor's intentional version bump.
    for (const recipe of bundle.recipes) await tx.runAsync('INSERT INTO recipes VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING', recipe.id, recipe.name, recipe.version, JSON.stringify(recipe), nowIso());
    for (const batch of bundle.recipe_batches) if (!await library.getRecipeBatch(batch.id)) await library.upsertRecipeBatch(batch);
    for (const goal of bundle.goal_periods) await tx.runAsync('INSERT INTO goal_periods VALUES(?,?,?) ON CONFLICT(id) DO NOTHING', goal.id, goal.effective_from_date, JSON.stringify(goal));
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
