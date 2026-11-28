import { z } from 'zod';
import { parseResponsesSseStream } from './sse';
import { AIError, AI_MODEL_OPTIONS, DEFAULT_AI_MODEL, LEGACY_RETIRED_AI_MODELS, modelSupportsVision } from './types';
import type { AIAuthMode, AICompletionRequest, AIModelOption, AIProvider } from './types';

export const OPENAI_MODELS_ENDPOINT = 'https://api.openai.com/v1/models';

export interface OpenAIResponsesProviderOptions {
  authMode: AIAuthMode;
  /** Read from platform secure storage at request time. No persistence or logging here. */
  getAccessToken: (signal?: AbortSignal) => string | null | Promise<string | null>;
  /** Optional one-shot token refresh invoked when an OAuth access token is rejected with 401. */
  onAuthExpiredRetry?: ((signal?: AbortSignal) => Promise<string | null>) | undefined;
  /** Optional synchronous guard checked immediately before every outbound POST. */
  canSendRequest?: (() => boolean) | undefined;
  /** Optional signal aborted immediately when credentials change or user signs out. */
  authAbortSignal?: AbortSignal | undefined;
  /** Live models fetched from /v1/models so vision capability matches the account catalog. */
  knownModels?: readonly AIModelOption[] | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  timeoutMs?: number | undefined;
  /** Off until the Phase 0 route capability check has passed, including OAuth. */
  enableJsonFormat?: boolean | undefined;
}

const KNOWN_MODEL_LABELS = new Map(AI_MODEL_OPTIONS.map(option => [option.id, option.label]));
const KNOWN_MODEL_ORDER = new Map(AI_MODEL_OPTIONS.map((option, index) => [option.id, index]));
const API_KEY_ALLOWED_MODEL = /^(?:gpt-(?:6(?:\.\d+)?|5\.[1-9]|4\.1|4o)|o[34])(?:-[a-z0-9]+)*$/i;
const API_KEY_EXCLUDED_MODEL = /(?:-20\d{2}-\d{2}-\d{2}$)|(?:^|-)(?:audio|realtime|transcribe|tts|search|image|embedding|moderation|instruct|cyber|codex-spark|chat-latest|deep-research)(?:-|$)/i;

export function formatModelDisplayName(slug: string): string {
  const known = KNOWN_MODEL_LABELS.get(slug);
  if (known) return known;
  return slug
    .split('-')
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index === 0 && lower === 'gpt') return 'GPT';
      if (index === 0 && /^o\d/.test(lower)) return lower;
      if (lower === 'mini' || lower === 'nano') return lower;
      if (/^\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ')
    .replace(/^GPT (\d)/, 'GPT-$1');
}

const oauthModelEntrySchema = z.object({
  slug: z.string().trim().min(1).optional(),
  id: z.string().trim().min(1).optional(),
  display_name: z.string().trim().min(1).optional(),
  visibility: z.string().trim().optional(),
  supported_in_api: z.boolean().optional(),
  input_modalities: z.array(z.string()).optional(),
});

const apiKeyModelEntrySchema = z.object({
  id: z.string().trim().min(1),
});

/** Parses either ChatGPT OAuth (`{ models: [...] }`) or standard OpenAI API (`{ data: [...] }`) /v1/models payloads. */
export function parseOpenAIModelCatalog(payload: unknown): AIModelOption[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const seen = new Set<string>();

  if (Array.isArray(record.models)) {
    const out: AIModelOption[] = [];
    for (const raw of record.models) {
      const parsed = oauthModelEntrySchema.safeParse(raw);
      if (!parsed.success) continue;
      const entry = parsed.data;
      const id = entry.slug ?? entry.id;
      if (!id || seen.has(id) || LEGACY_RETIRED_AI_MODELS.has(id)) continue;
      if (entry.visibility !== 'list') continue;
      if (entry.supported_in_api === false) continue;
      seen.add(id);
      const supportsVision = entry.input_modalities
        ? entry.input_modalities.some(modality => modality.toLowerCase() === 'image')
        : modelSupportsVision(id);
      out.push({
        id,
        label: entry.display_name ?? formatModelDisplayName(id),
        supportsVision,
      });
    }
    return out;
  }

  if (Array.isArray(record.data)) {
    const out: AIModelOption[] = [];
    for (const raw of record.data) {
      const parsed = apiKeyModelEntrySchema.safeParse(raw);
      if (!parsed.success) continue;
      const id = parsed.data.id;
      if (seen.has(id) || LEGACY_RETIRED_AI_MODELS.has(id) || !API_KEY_ALLOWED_MODEL.test(id) || API_KEY_EXCLUDED_MODEL.test(id)) continue;
      seen.add(id);
      out.push({
        id,
        label: formatModelDisplayName(id),
        supportsVision: modelSupportsVision(id),
      });
    }
    out.sort((a, b) => {
      const rankA = KNOWN_MODEL_ORDER.get(a.id);
      const rankB = KNOWN_MODEL_ORDER.get(b.id);
      if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
      if (rankA !== undefined) return -1;
      if (rankB !== undefined) return 1;
      return a.id.localeCompare(b.id);
    });
    return out;
  }

  return [];
}

export interface FetchOpenAIModelCatalogOptions {
  getAccessToken: (signal?: AbortSignal) => string | null | Promise<string | null>;
  onAuthExpiredRetry?: ((signal?: AbortSignal) => Promise<string | null>) | undefined;
  canSendRequest?: (() => boolean) | undefined;
  authAbortSignal?: AbortSignal | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

export async function fetchOpenAIModelCatalog(options: FetchOpenAIModelCatalogOptions): Promise<AIModelOption[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const authSignal = options.authAbortSignal;
  const assertCanSend = () => {
    if (authSignal?.aborted || (options.canSendRequest && !options.canSendRequest())) {
      throw new AIError('not_connected');
    }
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  authSignal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted || authSignal?.aborted) abort();
  const timer = setTimeout(abort, options.timeoutMs ?? 12_000);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const send = (token: string) =>
    fetchImpl(OPENAI_MODELS_ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  try {
    assertCanSend();
    if (controller.signal.aborted) throw new AIError('timeout');
    const token = await options.getAccessToken(controller.signal);
    assertCanSend();
    if (!token) throw new AIError('not_connected');
    let response = await send(token);
    if (response.status === 401 && options.onAuthExpiredRetry) {
      assertCanSend();
      const refreshed = await options.onAuthExpiredRetry(controller.signal);
      assertCanSend();
      if (refreshed) response = await send(refreshed);
    }
    if (response.status === 401 || response.status === 403) throw new AIError('auth_expired');
    if (response.status === 429) throw new AIError('quota_exhausted');
    if (!response.ok) throw new AIError('network');
    assertCanSend();
    if (controller.signal.aborted) throw new AIError('timeout');
    let json: unknown;
    try { json = await response.json(); } catch { throw new AIError('malformed_output'); }
    assertCanSend();
    if (controller.signal.aborted) throw new AIError('timeout');
    return parseOpenAIModelCatalog(json);
  } catch (error) {
    if (authSignal?.aborted || (options.canSendRequest && !options.canSendRequest())) throw new AIError('not_connected');
    if (error instanceof AIError) throw error;
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new AIError('timeout');
    throw new AIError('network');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    authSignal?.removeEventListener('abort', abort);
  }
}

export function validateImageDataUrl(image: string): void {
  if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new AIError('unsupported_media');
}

/** Direct device-to-OpenAI, stateless Responses requests for either explicit billing route. */
export class OpenAIResponsesProvider implements AIProvider {
  constructor(private readonly options: OpenAIResponsesProviderOptions) {
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new RangeError('AI timeout must be positive');
    }
  }

  private async sendRequest(
    token: string,
    bodyJson: string,
    signal: AbortSignal,
  ): Promise<Response> {
    return (this.options.fetch ?? globalThis.fetch)('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: bodyJson,
      signal,
    });
  }

  async completeJson(request: AICompletionRequest): Promise<unknown> {
    if (this.options.authMode === 'disconnected') throw new AIError('not_connected');
    const model = request.model ?? DEFAULT_AI_MODEL;
    if (request.imageDataUrl !== undefined) {
      validateImageDataUrl(request.imageDataUrl);
      if (!modelSupportsVision(model, this.options.knownModels)) throw new AIError('unsupported_media');
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    const authSignal = this.options.authAbortSignal;
    const assertCanSend = () => {
      if (authSignal?.aborted || (this.options.canSendRequest && !this.options.canSendRequest())) {
        throw new AIError('not_connected');
      }
    };
    request.signal?.addEventListener('abort', abort, { once: true });
    authSignal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted || authSignal?.aborted) abort();
    const timer = setTimeout(abort, this.options.timeoutMs ?? 30_000);
    try {
      assertCanSend();
      if (controller.signal.aborted) throw new AIError('timeout');
      const token = await this.options.getAccessToken(controller.signal);
      assertCanSend();
      if (!token) throw new AIError('not_connected');
      const content: Record<string, string>[] = [{ type: 'input_text', text: request.userText }];
      if (request.imageDataUrl !== undefined) content.push({ type: 'input_image', image_url: request.imageDataUrl });
      const bodyJson = JSON.stringify({
        model,
        instructions: `${request.instructions}\nReturn one JSON object only. No Markdown, prose, or code fences.`,
        input: [{ role: 'user', content }],
        store: false,
        stream: true,
        ...(this.options.enableJsonFormat ? { text: { format: { type: 'json_object' } } } : {}),
      });

      assertCanSend();
      let response = await this.sendRequest(token, bodyJson, controller.signal);
      if (response.status === 401 && this.options.onAuthExpiredRetry) {
        assertCanSend();
        const refreshed = await this.options.onAuthExpiredRetry(controller.signal);
        assertCanSend();
        if (refreshed) {
          response = await this.sendRequest(refreshed, bodyJson, controller.signal);
        }
      }
      if (response.status === 401 || response.status === 403) throw new AIError('auth_expired');
      if (response.status === 429) throw new AIError('quota_exhausted');
      if (!response.ok) throw new AIError('network');

      // Prefer streaming ReadableStream (expo/fetch, Node, Web); fall back cleanly to text() on runtimes without response.body.
      const sseSource = response.body ?? await response.text();
      if (!sseSource) throw new AIError('malformed_output');
      const text = await parseResponsesSseStream(sseSource);
      assertCanSend();
      try { return z.record(z.string(), z.unknown()).parse(JSON.parse(text)); }
      catch { throw new AIError('malformed_output'); }
    } catch (error) {
      if (authSignal?.aborted || (this.options.canSendRequest && !this.options.canSendRequest())) throw new AIError('not_connected');
      if (error instanceof AIError) throw error;
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new AIError('timeout');
      throw new AIError('network');
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);
      authSignal?.removeEventListener('abort', abort);
    }
  }
}
