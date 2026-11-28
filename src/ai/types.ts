import type { z } from 'zod';
import type { SearchOptions, SearchCandidate } from '../catalog/types';
import type { NutrientAggregate, Quantity } from '../domain';
import type * as schemas from './schemas';

export type AIAuthMode = 'disconnected' | 'chatgpt_oauth' | 'api_key';
export type AIModelsCatalogState = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';
export interface AIModelOption { id: string; label: string; supportsVision: boolean }
/** Fallback defaults when offline or disconnected before the account's live /v1/models catalog loads. */
export const AI_MODEL_OPTIONS: readonly AIModelOption[] = [
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', supportsVision: true },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', supportsVision: true },
  { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol', supportsVision: true },
  { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra', supportsVision: true },
];
export const DEFAULT_AI_MODEL = 'gpt-6.2-sol';
export const LEGACY_RETIRED_AI_MODELS = new Set<string>(['gpt-5', 'gpt-5-mini']);

const NON_VISION_MODEL_PATTERN = /^(?:gpt-3\.5|o1-mini|text-|whisper|tts|dall-e|babbage|davinci|omni-moderation)|(?:^|-)(?:audio|realtime|transcribe|tts|embedding|moderation|instruct|search)(?:-|$)/i;
const DOCUMENTED_VISION_MODEL_PATTERN = /^(?:gpt-(?:6(?:\.\d+)?|5(?:\.\d+)?|4\.1|4o)|o[34])(?:-(?:astra|sol|terra|luna|pro|mini|nano|codex|instant|thinking))?$/i;

export function modelSupportsVision(modelId: string, knownModels?: readonly AIModelOption[]): boolean {
  const known = knownModels?.find(option => option.id === modelId)
    ?? AI_MODEL_OPTIONS.find(option => option.id === modelId);
  if (known) return known.supportsVision;
  const trimmed = modelId.trim();
  if (!trimmed || NON_VISION_MODEL_PATTERN.test(trimmed)) return false;
  return DOCUMENTED_VISION_MODEL_PATTERN.test(trimmed);
}

const PREFERRED_MODEL_ORDER = ['gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-6.2-astra'] as const;

export function pickPreferredAIModel(models: readonly AIModelOption[], currentModel?: string): string {
  if (currentModel && !LEGACY_RETIRED_AI_MODELS.has(currentModel) && models.some(option => option.id === currentModel)) {
    return currentModel;
  }
  for (const preferred of PREFERRED_MODEL_ORDER) {
    if (models.some(option => option.id === preferred)) return preferred;
  }
  return models.find(option => option.supportsVision)?.id ?? models[0]?.id ?? DEFAULT_AI_MODEL;
}
export type AIErrorCode = 'not_connected' | 'timeout' | 'network' | 'quota_exhausted' | 'auth_expired' | 'refusal' | 'malformed_output' | 'unsupported_media';
const messages: Record<AIErrorCode, string> = {
  not_connected: 'Connect AI to analyse this meal, or continue with manual entry.',
  timeout: 'AI took longer than expected. Try again or continue with manual entry.',
  network: 'AI could not connect. Try again or continue with manual entry.',
  quota_exhausted: 'The AI allowance is currently unavailable. Try later or continue with manual entry.',
  auth_expired: 'The AI connection needs to be renewed. Reconnect or continue with manual entry.',
  refusal: 'AI could not analyse this input. Try another description or continue with manual entry.',
  malformed_output: 'AI could not produce a usable draft. Try again or continue with manual entry.',
  unsupported_media: 'This image format or model is not supported. Choose another image or use text entry.',
};
/** Never carry provider response bodies, credentials, or raw exception messages into UI copy. */
export class AIError extends Error {
  constructor(readonly code: AIErrorCode) { super(messages[code]); this.name = 'AIError'; }
}
export interface AICompletionRequest {
  instructions: string;
  userText: string;
  imageDataUrl?: string | undefined;
  model?: string | undefined;
  signal?: AbortSignal | undefined;
}
/** Providers return parsed JSON; each operation validates its own Zod schema. */
export interface AIProvider { completeJson(request: AICompletionRequest): Promise<unknown> }
export interface MealCaptureCatalog {
  search(query: string, options?: SearchOptions): Promise<{ yours: SearchCandidate[]; database: SearchCandidate[] }>;
  /** Composite personal foods carry partial coverage beyond the FoodRecord's known subtotal. */
  userLibrary?: { getNutritionForQuantity(id: string, quantity: Quantity): Promise<NutrientAggregate | null> };
}
export type MealExtraction = z.infer<typeof schemas.mealExtractionSchema>;
export type ExtractedMealItem = MealExtraction['items'][number];
export type ClarifyingQuestion = MealExtraction['clarifying_questions'][number];
export type Disambiguation = z.infer<typeof schemas.disambiguationSchema>;
export type NutritionLabelExtraction = z.infer<typeof schemas.nutritionLabelExtractionSchema>;
export type MealDraftItem = z.infer<typeof schemas.mealDraftItemSchema>;
export type MealDraftProposal = z.infer<typeof schemas.mealDraftProposalSchema>;
