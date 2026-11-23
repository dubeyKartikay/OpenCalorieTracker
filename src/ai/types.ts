import type { z } from 'zod';
import type { SearchOptions, SearchCandidate } from '../catalog/types';
import type { NutrientAggregate, Quantity } from '../domain';
import type * as schemas from './schemas';

export type AIAuthMode = 'disconnected' | 'chatgpt_oauth' | 'api_key';
export interface AIModelOption { id: 'gpt-5-mini' | 'gpt-5'; label: string; supportsVision: boolean }
/** UI defaults; the connection layer must filter these against the account's model catalogue. */
export const AI_MODEL_OPTIONS: readonly AIModelOption[] = [
  { id: 'gpt-5-mini', label: 'GPT-5 mini', supportsVision: true },
  { id: 'gpt-5', label: 'GPT-5', supportsVision: true },
];
export const DEFAULT_AI_MODEL = 'gpt-5-mini';
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
