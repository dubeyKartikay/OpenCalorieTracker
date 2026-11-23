# Wave 2A integration

Use `src/storage` and `src/catalog` for native runtime imports. The Node 24 test driver lives at `src/storage/nodeDriver` and is deliberately absent from the storage barrel so Metro never traverses `node:sqlite`. Expo's driver imports `SQLiteDatabase` as a type only.

## Open and initialize

```ts
import { openDatabaseAsync } from 'expo-sqlite';
import { createExpoSqliteDriver, migrateDatabase, DiaryRepo, LibraryRepo } from '@/storage';
import { FoodSourceRegistry } from '@/catalog';

const userDb = createExpoSqliteDriver(await openDatabaseAsync('user.db'));
await migrateDatabase(userDb);
const diary = new DiaryRepo(userDb);
const library = new LibraryRepo(userDb);
const catalog = new FoodSourceRegistry(userDb);
```

Each repository also has a `create…Repo(db)` factory. Dates use `YYYY-MM-DD`; timestamps must include a UTC offset. A missing diary day returns `null`; a stored empty day has `entries: []` and its explicit completeness. Draft entries are included in day reads; domain `sumNutrients` excludes drafts.

## Transactions, confirmation and Undo

`db.withTransactionAsync(async tx => { … })` provides a scoped handle. Use `tx` for every repository/query inside the callback. Calling the outer database from inside its transaction waits on itself. Scoped transactions can nest via savepoints. The driver serializes ordinary operations as well as transactions so outside writes cannot be rolled back by unrelated work.

`diary.confirmEntry(snapshotOrDraftId)` freezes the supplied snapshot, learns the portion once, and returns the original confirmed row on an idempotency-key retry. Keep an operation's idempotency key stable across retries. `deleteEntry(id)` returns the complete snapshot (or `null`); feed that snapshot to `restoreEntry` for Undo. Restoration does not increment learned frequency. Explicit `updateEntry`/`moveEntry` edit the stored snapshot; catalog/recipe edits and pack removal never do.

## Packs and search

Import/copy a pack file with the platform filesystem, open a **separate read-only** handle, then call `catalog.mountPack(packId, handle, priority)`. No `ATTACH` is used. Register its persistent path/metadata separately with `PacksRepo.registerPack`; on startup read `listInstalledPacks`, open each available file read-only, mount it, then apply its stored enabled state. `mountPack` validates without modifying the pack. Ownership of its handle transfers to the registry after a successful mount; close failed mount handles yourself. `unmountPack` and `catalog.close()` close owned pack handles, leaving `userDb` open.

Search returns `{ yours, database }`, each ordered by semantic tier, preparation, priority and within-source rank. `limit` is a per-source candidate bound and per-output-bucket bound (default 50). FTS/BM25 scores never cross pack boundaries. Barcode lookup returns a food or `null`; invalid/ambiguous input throws the domain `BarcodeError`. Eight digits require an explicit symbology.

Personal unit keys are `pack_id:food_id` for pack records and the record ID for personal items. Personal units override a pack unit with the same label without modifying that pack. Use the exported `foodKey(food)` helper to compute keys. Saved meals use `SavedMeal`/`savedMealSchema` from storage and frozen ingredient `items`. Search represents recipes as `recipe:<uuid>` and saved meals as `meal:<uuid>`. Their `per_serving` basis is the **entire recipe/meal**, with cooked weight available for converting gram quantities. Use the recipe's `servings_count` to choose an initial fraction for an individual serving.

For recipes/saved meals, call `catalog.userLibrary.getNutritionForQuantity(id, quantity)` and copy its `unknownCount` into the snapshot's `unknown_nutrient_counts`. This preserves partial nutrient coverage across multiple ingredients. A `FoodRecord` alone cannot represent missing ingredient counts. Cooked batches remain frozen `RecipeBatch` records; calculate them with domain `calculateBatchServing` and copy its counts in the same way.

## Export and restore

`exportBundleV1` returns the exact existing domain `ExportBundleV1` contract. `restoreBundleV1` validates before writing and uses one transaction. Merge retains existing rows on ID/idempotency conflicts; replace clears user tables before restoring. Diary snapshots, recipe versions and batch ingredients round-trip without recalculation.

The domain V1 contract contains diary days, custom food records, recipes, recipe batches, goals, weigh-ins and pack metadata. It has **no fields for custom barcode links, saved meals, personal units, learned portions, preferences, or installed file paths/settings**. Those cannot be exported under the current strict schema. Replace clears those local values; merge retains them. Restored pack metadata is registered with an empty path and disabled until its actual file is imported again. Extending backup coverage requires a separately versioned domain export contract.

## Verification

Storage/catalog tests use real Node SQLite, including FTS5, in-memory databases, actual temporary `.octpack.sqlite` files, read-only opens, close/reopen persistence, failure-trigger rollback, and the full search → portion → confirm → restart → export/restore path.
