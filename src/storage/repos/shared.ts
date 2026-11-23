import type { FoodRecord } from '../../domain';

export const nowIso = () => new Date().toISOString();
export function foodKey(food: FoodRecord): string {
  return food.source_pack_id === null ? food.id : `${food.source_pack_id}:${food.source_id ?? food.id}`;
}
export function parseJson<T>(value: string, schema: { parse(value: unknown): T }): T {
  return schema.parse(JSON.parse(value));
}
