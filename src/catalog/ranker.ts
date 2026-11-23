import type { PrepState } from '../domain';
import type { SearchCandidate } from './types';

export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ') ?? '';
}
export function queryTokens(query: string): string[] { return normalizeSearchText(query).split(' ').filter(Boolean); }
export function matchTier(name: string, query: string): SearchCandidate['matchTier'] {
  const normalized = normalizeSearchText(name);
  const needle = normalizeSearchText(query);
  if (!needle) return 3;
  if (normalized === needle) return 0;
  if (normalized.startsWith(needle)) return 1;
  const words = queryTokens(normalized);
  if (queryTokens(needle).every((token) => words.some((word) => word.startsWith(token)))) return 2;
  return 3;
}
export function preferredPreparation(query: string, explicit?: PrepState): PrepState | undefined {
  return explicit ?? (queryTokens(query).find((token) => ['raw', 'cooked', 'prepared'].includes(token)) as PrepState | undefined);
}
export function rankCandidates(candidates: readonly SearchCandidate[], query: string, preferredPrepState?: PrepState): SearchCandidate[] {
  const prep = preferredPreparation(query, preferredPrepState);
  return candidates.map((candidate) => ({
    ...candidate,
    matchTier: Math.min(matchTier(candidate.food.name, query), candidate.matchedAlias === null ? 3 : matchTier(candidate.matchedAlias, query)) as SearchCandidate['matchTier'],
    prepStateMatch: prep !== undefined && candidate.food.prep_state === prep,
  })).sort((a, b) =>
    Number(a.bucket === 'database') - Number(b.bucket === 'database') ||
    a.matchTier - b.matchTier || Number(b.prepStateMatch) - Number(a.prepStateMatch) ||
    a.packPriority - b.packPriority || a.withinPackRank - b.withinPackRank ||
    a.food.source_pack_id?.localeCompare(b.food.source_pack_id ?? '') || a.food.id.localeCompare(b.food.id));
}

export function mergeFoodUnits(base: import('../domain').FoodUnit[], personal: import('../domain').FoodUnit[]): import('../domain').FoodUnit[] {
  return [...new Map([...base, ...personal].map((unit) => [unit.label, unit])).values()];
}
