import { calculateNutrition, calculateRecipeTotal, foodRecordSchema, resolveQuantityToBasis, scaleNutrients, sumNutrients } from '../domain';
import type { FoodRecord, FoodUnit, NormalizedBarcode, NutrientAggregate, PackMeta, Quantity, RecipeIngredient } from '../domain';
import type { SqlDatabase } from '../storage/driver';
import { LibraryRepo } from '../storage/repos/libraryRepo';
import { foodKey } from '../storage/repos/shared';
import { matchTier, mergeFoodUnits, normalizeSearchText, preferredPreparation, queryTokens } from './ranker';
import type { FoodSourceAdapter, SearchCandidate, SearchOptions } from './types';

export class UserLibraryAdapter implements FoodSourceAdapter {
  readonly sourceId = 'user';
  readonly bucket = 'yours' as const;
  private readonly library: LibraryRepo;
  constructor(private readonly db: SqlDatabase) { this.library = new LibraryRepo(db); }
  async getMeta(): Promise<PackMeta> {
    return { pack_id: 'user', name: 'Yours', version: '1', kind: 'custom', region: null, license: 'Private', attribution_text: 'Your library', attribution_url: null, schema_version: 1 };
  }
  private mergePersonalUnits(food: FoodRecord, personal: FoodUnit[]): FoodRecord {
    // Keep auto-derived recipe `portion` authoritative over any stale personal row with the same label.
    const isDerivedRecipe = !food.source_pack_id && food.id.startsWith('recipe:') && food.units.some((unit) => unit.label === 'portion');
    const filteredPersonal = isDerivedRecipe ? personal.filter((unit) => unit.label !== 'portion') : personal;
    return filteredPersonal.length > 0 ? { ...food, units: mergeFoodUnits(food.units, filteredPersonal) } : food;
  }
  private async personalUnits(food: FoodRecord): Promise<FoodRecord> {
    return this.mergePersonalUnits(food, await this.library.listUserFoodUnits(foodKey(food)));
  }
  private loggable(
    id: string,
    name: string,
    ingredients: RecipeIngredient[],
    cookedWeight: number | null,
    version: number | null,
    servingsCount: number | null = null,
  ): FoodRecord {
    const total = calculateRecipeTotal(ingredients);
    const derivedUnits: FoodUnit[] =
      id.startsWith('recipe:') && cookedWeight !== null && servingsCount !== null && servingsCount > 1
        ? [{ label: 'portion', grams: Math.round((cookedWeight / servingsCount) * 10_000) / 10_000, ml: null }]
        : [];
    return foodRecordSchema.parse({
      id, name, category: id.startsWith('recipe:') ? 'Recipe' : 'Saved meal', prep_state: 'prepared',
      basis: 'per_serving', serving_g: cookedWeight, nutrients: total.nutrients, units: derivedUnits,
      provenance_kind: 'user', source_id: id, source_version: version === null ? null : String(version),
    });
  }
  async getById(id: string): Promise<FoodRecord | null> {
    let food = await this.library.getCustomFood(id);
    if (!food && id.startsWith('recipe:')) {
      const recipe = await this.library.getRecipe(id.slice(7));
      if (recipe) food = this.loggable(id, recipe.name, recipe.ingredients, recipe.cooked_weight_g, recipe.version, recipe.servings_count);
    }
    if (!food && id.startsWith('meal:')) {
      const meal = await this.library.getSavedMeal(id.slice(5));
      if (meal) food = this.loggable(id, meal.name, meal.items, null, null);
    }
    return food ? this.personalUnits(food) : null;
  }
  async search(query: string, options: SearchOptions = {}): Promise<SearchCandidate[]> {
    const tokens = queryTokens(query);
    if (tokens.length === 0) return [];
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Search limit must be a positive integer');
    const [custom, recipes, meals] = await Promise.all([this.library.listCustomFoods(), this.library.listRecipes(), this.library.listSavedMeals()]);
    const foods = [...custom,
      ...recipes.map((recipe) => this.loggable(`recipe:${recipe.id}`, recipe.name, recipe.ingredients, recipe.cooked_weight_g, recipe.version, recipe.servings_count)),
      ...meals.map((meal) => this.loggable(`meal:${meal.id}`, meal.name, meal.items, null, null))];
    const matching = foods.filter((food) => tokens.some((token) => queryTokens(`${food.name} ${food.brand ?? ''}`).some((word) => word.startsWith(token))))
      .sort((a, b) => matchTier(a.name, query) - matchTier(b.name, query) || normalizeSearchText(a.name).localeCompare(normalizeSearchText(b.name)) || a.id.localeCompare(b.id)).slice(0, limit);
    const prep = preferredPreparation(query, options.preferredPrepState);
    const unitsByKey = await this.library.listUserFoodUnitsForKeys(matching.map((food) => foodKey(food)));
    return matching.map((food, index) => ({
      food: this.mergePersonalUnits(food, unitsByKey.get(foodKey(food)) ?? []),
      bucket: this.bucket,
      sourceLabel: 'Yours',
      packPriority: 0,
      matchTier: matchTier(food.name, query),
      prepStateMatch: prep !== undefined && food.prep_state === prep,
      withinPackRank: index,
      matchedAlias: null,
    }));
  }
  async lookupBarcode(code: NormalizedBarcode): Promise<FoodRecord | null> {
    const food = await this.library.findCustomFoodByBarcode(code);
    return food ? this.personalUnits(food) : null;
  }
  /**
   * Resolves a fresh food snapshot and nutrient aggregate from a single transaction.
   * `fallbackUnits` (e.g. global units) are appended only for labels not already defined on the food,
   * preserving food-specific unit and density precedence.
   */
  async resolveForQuantity(
    id: string,
    quantity: Quantity,
    fallbackUnits: FoodUnit[] = [],
  ): Promise<{ food: FoodRecord; aggregate: NutrientAggregate } | null> {
    return this.db.withTransactionAsync(async (tx) => {
      const adapter = new UserLibraryAdapter(tx);
      let baseFood: FoodRecord | null = null;
      let ingredients: RecipeIngredient[] | undefined;
      if (id.startsWith('recipe:')) {
        const recipe = await adapter.library.getRecipe(id.slice(7));
        if (recipe) {
          ingredients = recipe.ingredients;
          baseFood = adapter.loggable(id, recipe.name, recipe.ingredients, recipe.cooked_weight_g, recipe.version, recipe.servings_count);
        }
      } else if (id.startsWith('meal:')) {
        const meal = await adapter.library.getSavedMeal(id.slice(5));
        if (meal) {
          ingredients = meal.items;
          baseFood = adapter.loggable(id, meal.name, meal.items, null, null);
        }
      } else {
        baseFood = await adapter.library.getCustomFood(id);
      }
      if (!baseFood) return null;
      const withPersonal = await adapter.personalUnits(baseFood);
      const extras = fallbackUnits.filter((unit) => !withPersonal.units.some((item) => item.label === unit.label));
      const food = extras.length > 0 ? { ...withPersonal, units: [...withPersonal.units, ...extras] } : withPersonal;
      if (!ingredients) {
        return { food, aggregate: sumNutrients([calculateNutrition(food, quantity)]) };
      }
      const total = calculateRecipeTotal(ingredients);
      const factor = resolveQuantityToBasis(food, quantity).factor;
      return {
        food,
        aggregate: { ...total, nutrients: total.nutrients === null ? null : scaleNutrients(total.nutrients, factor) },
      };
    });
  }
  /** Copy unknownCount into the diary's unknown_nutrient_counts for composite items. */
  async getNutritionForQuantity(id: string, quantity: Quantity, fallbackUnits: FoodUnit[] = []): Promise<NutrientAggregate | null> {
    const resolved = await this.resolveForQuantity(id, quantity, fallbackUnits);
    return resolved?.aggregate ?? null;
  }
}
