import { z } from 'zod';
import { foodRecordSchema, foodUnitSchema, normalizeBarcode, quantitySchema, recipeBatchSchema, recipeIngredientSchema, recipeSchema } from '../../domain';
import type { FoodRecord, FoodUnit, NormalizedBarcode, Quantity, Recipe, RecipeBatch } from '../../domain';
import type { SqlDatabase } from '../driver';
import { nowIso, parseJson } from './shared';

// Saved meals have no domain/export schema in V1; keep their frozen ingredients explicit here.
export const savedMealSchema = z.strictObject({
  id: z.uuid(), name: z.string().trim().min(1), items: z.array(recipeIngredientSchema).min(1),
  pinned: z.boolean().default(false), use_count: z.int().nonnegative().default(0), last_used_at: z.iso.datetime({ offset: true }).nullable().default(null),
});
export type SavedMeal = z.infer<typeof savedMealSchema>;
export interface LearnedPortion extends Quantity { food_key: string; use_count: number; last_used_at: string }

export class LibraryRepo {
  constructor(private readonly db: SqlDatabase) {}
  async upsertCustomFood(input: FoodRecord, barcode?: { rawCode: string; symbology?: string } | null): Promise<FoodRecord> {
    const food = foodRecordSchema.parse(input);
    const code = barcode ? normalizeBarcode(barcode.rawCode, barcode.symbology) : null;
    await this.db.runAsync(`INSERT INTO custom_foods VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,brand=excluded.brand,food_json=excluded.food_json,
      barcode_raw=CASE WHEN ? THEN excluded.barcode_raw ELSE custom_foods.barcode_raw END,
      barcode_symbology=CASE WHEN ? THEN excluded.barcode_symbology ELSE custom_foods.barcode_symbology END,
      barcode_gtin14=CASE WHEN ? THEN excluded.barcode_gtin14 ELSE custom_foods.barcode_gtin14 END,updated_at=excluded.updated_at`,
    food.id, food.name, food.brand, JSON.stringify(food), code?.rawCode ?? null, code?.symbology ?? null, code?.gtin14 ?? null, nowIso(),
    barcode !== undefined ? 1 : 0, barcode !== undefined ? 1 : 0, barcode !== undefined ? 1 : 0);
    return food;
  }
  async getCustomFood(id: string): Promise<FoodRecord | null> {
    const row = await this.db.getFirstAsync<{ food_json: string }>('SELECT food_json FROM custom_foods WHERE id=?', id);
    return row ? parseJson(row.food_json, foodRecordSchema) : null;
  }
  async listCustomFoods(): Promise<FoodRecord[]> {
    const rows = await this.db.getAllAsync<{ food_json: string }>('SELECT food_json FROM custom_foods ORDER BY lower(name),id');
    return rows.map((row) => parseJson(row.food_json, foodRecordSchema));
  }
  async deleteCustomFood(id: string): Promise<void> { await this.db.runAsync('DELETE FROM custom_foods WHERE id=?', id); }
  async findCustomFoodByBarcode(code: NormalizedBarcode): Promise<FoodRecord | null> {
    const row = await this.db.getFirstAsync<{ food_json: string }>(`SELECT food_json FROM custom_foods
      WHERE barcode_gtin14=? OR (barcode_raw=? AND barcode_symbology=?) ORDER BY id LIMIT 1`, code.gtin14, code.rawCode, code.symbology);
    return row ? parseJson(row.food_json, foodRecordSchema) : null;
  }
  async upsertRecipe(input: Recipe): Promise<Recipe> {
    const recipe = recipeSchema.parse(input);
    return this.db.withTransactionAsync(async (tx) => {
      const old = await new LibraryRepo(tx).getRecipe(recipe.id);
      const value = { ...recipe, version: old ? old.version + 1 : recipe.version };
      await tx.runAsync('INSERT INTO recipes VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,recipe_json=excluded.recipe_json,updated_at=excluded.updated_at', value.id, value.name, value.version, JSON.stringify(value), nowIso());
      return value;
    });
  }
  async getRecipe(id: string): Promise<Recipe | null> {
    const row = await this.db.getFirstAsync<{ recipe_json: string }>('SELECT recipe_json FROM recipes WHERE id=?', id);
    return row ? parseJson(row.recipe_json, recipeSchema) : null;
  }
  async listRecipes(): Promise<Recipe[]> {
    return (await this.db.getAllAsync<{ recipe_json: string }>('SELECT recipe_json FROM recipes ORDER BY lower(name),id')).map((row) => parseJson(row.recipe_json, recipeSchema));
  }
  async deleteRecipe(id: string): Promise<void> { await this.db.runAsync('DELETE FROM recipes WHERE id=?', id); }
  async upsertRecipeBatch(input: RecipeBatch): Promise<RecipeBatch> {
    const batch = recipeBatchSchema.parse(input);
    await this.db.runAsync('INSERT INTO recipe_batches VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET recipe_id=excluded.recipe_id,recipe_version=excluded.recipe_version,created_at=excluded.created_at,batch_json=excluded.batch_json', batch.id, batch.recipe_id, batch.recipe_version, batch.created_at, JSON.stringify(batch));
    return batch;
  }
  async getRecipeBatch(id: string): Promise<RecipeBatch | null> {
    const row = await this.db.getFirstAsync<{ batch_json: string }>('SELECT batch_json FROM recipe_batches WHERE id=?', id);
    return row ? parseJson(row.batch_json, recipeBatchSchema) : null;
  }
  async listRecipeBatches(recipeId?: string): Promise<RecipeBatch[]> {
    return (await this.db.getAllAsync<{ batch_json: string }>('SELECT batch_json FROM recipe_batches WHERE (? IS NULL OR recipe_id=?) ORDER BY created_at,id', recipeId ?? null, recipeId ?? null)).map((row) => parseJson(row.batch_json, recipeBatchSchema));
  }
  async deleteRecipeBatch(id: string): Promise<void> { await this.db.runAsync('DELETE FROM recipe_batches WHERE id=?', id); }
  async upsertSavedMeal(input: SavedMeal): Promise<SavedMeal> {
    const meal = savedMealSchema.parse(input);
    await this.db.runAsync('INSERT INTO saved_meals VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,meal_json=excluded.meal_json,pinned=excluded.pinned,use_count=excluded.use_count,last_used_at=excluded.last_used_at', meal.id, meal.name, JSON.stringify(meal), Number(meal.pinned), meal.use_count, meal.last_used_at);
    return meal;
  }
  async getSavedMeal(id: string): Promise<SavedMeal | null> {
    const row = await this.db.getFirstAsync<{ meal_json: string }>('SELECT meal_json FROM saved_meals WHERE id=?', id);
    return row ? parseJson(row.meal_json, savedMealSchema) : null;
  }
  async listSavedMeals(): Promise<SavedMeal[]> {
    return (await this.db.getAllAsync<{ meal_json: string }>('SELECT meal_json FROM saved_meals ORDER BY pinned DESC,use_count DESC,last_used_at DESC,id')).map((row) => parseJson(row.meal_json, savedMealSchema));
  }
  async deleteSavedMeal(id: string): Promise<void> { await this.db.runAsync('DELETE FROM saved_meals WHERE id=?', id); }
  async upsertUserFoodUnit(key: string, input: FoodUnit): Promise<void> {
    const unit = foodUnitSchema.parse(input);
    await this.db.runAsync('INSERT INTO user_food_units VALUES(?,?,?,?) ON CONFLICT(food_key,label) DO UPDATE SET grams=excluded.grams,ml=excluded.ml', key, unit.label, unit.grams, unit.ml);
  }
  async listUserFoodUnits(key: string): Promise<FoodUnit[]> { return this.db.getAllAsync<FoodUnit>('SELECT label,grams,ml FROM user_food_units WHERE food_key=? ORDER BY label', key); }
  async deleteUserFoodUnit(key: string, label: string): Promise<void> { await this.db.runAsync('DELETE FROM user_food_units WHERE food_key=? AND label=?', key, label); }
  async recordLearnedPortion(key: string, input: Quantity, at = nowIso()): Promise<void> {
    const quantity = quantitySchema.parse(input);
    z.iso.datetime({ offset: true }).parse(at);
    await this.db.runAsync('INSERT INTO learned_portions(food_key,unit,amount,last_used_at) VALUES(?,?,?,?) ON CONFLICT(food_key,unit,amount) DO UPDATE SET use_count=use_count+1,last_used_at=excluded.last_used_at', key, quantity.unit, quantity.amount, at);
  }
  async listLearnedPortions(key: string): Promise<LearnedPortion[]> { return this.db.getAllAsync<LearnedPortion>('SELECT * FROM learned_portions WHERE food_key=? ORDER BY use_count DESC,last_used_at DESC,unit,amount', key); }
  async deleteLearnedPortion(key: string, quantity: Quantity): Promise<void> { await this.db.runAsync('DELETE FROM learned_portions WHERE food_key=? AND unit=? AND amount=?', key, quantity.unit, quantity.amount); }
}
export const createLibraryRepo = (db: SqlDatabase) => new LibraryRepo(db);
