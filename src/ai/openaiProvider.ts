import { z } from 'zod';
import { parseResponsesSseStream } from './sse';
import { AIError, AI_MODEL_OPTIONS, DEFAULT_AI_MODEL } from './types';
import type { AIAuthMode, AICompletionRequest, AIProvider } from './types';

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
  fetch?: typeof globalThis.fetch | undefined;
  timeoutMs?: number | undefined;
  /** Off until the Phase 0 route capability check has passed, including OAuth. */
  enableJsonFormat?: boolean | undefined;
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
      if (!AI_MODEL_OPTIONS.some(option => option.id === model && option.supportsVision)) throw new AIError('unsupported_media');
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
