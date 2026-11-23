import { z } from 'zod';
import { parseResponsesSseStream } from './sse';
import { AIError, AI_MODEL_OPTIONS, DEFAULT_AI_MODEL } from './types';
import type { AIAuthMode, AICompletionRequest, AIProvider } from './types';

export interface OpenAIResponsesProviderOptions {
  authMode: AIAuthMode;
  /** Read from platform secure storage at request time. No persistence or logging here. */
  getAccessToken: () => string | null | Promise<string | null>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Off until the Phase 0 route capability check has passed, including OAuth. */
  enableJsonFormat?: boolean;
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
  async completeJson(request: AICompletionRequest): Promise<unknown> {
    if (this.options.authMode === 'disconnected') throw new AIError('not_connected');
    const model = request.model ?? DEFAULT_AI_MODEL;
    if (request.imageDataUrl !== undefined) {
      validateImageDataUrl(request.imageDataUrl);
      if (!AI_MODEL_OPTIONS.some(option => option.id === model && option.supportsVision)) throw new AIError('unsupported_media');
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) abort();
    const timer = setTimeout(abort, this.options.timeoutMs ?? 30_000);
    try {
      if (controller.signal.aborted) throw new AIError('timeout');
      const token = await this.options.getAccessToken();
      if (!token) throw new AIError('not_connected');
      const content: Record<string, string>[] = [{ type: 'input_text', text: request.userText }];
      if (request.imageDataUrl !== undefined) content.push({ type: 'input_image', image_url: request.imageDataUrl });
      const body = {
        model,
        instructions: `${request.instructions}\nReturn one JSON object only. No Markdown, prose, or code fences.`,
        input: [{ role: 'user', content }],
        store: false, stream: true,
        ...(this.options.enableJsonFormat ? { text: { format: { type: 'json_object' } } } : {}),
      };
      const response = await (this.options.fetch ?? globalThis.fetch)('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body), signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) throw new AIError('auth_expired');
      if (response.status === 429) throw new AIError('quota_exhausted');
      if (!response.ok) throw new AIError('network');
      if (!response.body) throw new AIError('malformed_output');
      const text = await parseResponsesSseStream(response.body);
      try { return z.record(z.string(), z.unknown()).parse(JSON.parse(text)); }
      catch { throw new AIError('malformed_output'); }
    } catch (error) {
      if (error instanceof AIError) throw error;
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new AIError('timeout');
      throw new AIError('network');
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);
    }
  }
}
