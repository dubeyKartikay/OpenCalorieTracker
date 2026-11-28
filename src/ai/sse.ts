import { AIError } from './types';

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject { return value !== null && typeof value === 'object' ? value as JsonObject : {}; }
export function mapProviderError(value: unknown): AIError {
  const root = object(value);
  const error = object(root.error ?? object(root.response).error ?? root);
  const code = String(error.code ?? error.type ?? '').toLowerCase();
  if (/quota|rate_limit|usage_limit/.test(code)) return new AIError('quota_exhausted');
  if (/auth|token|api_key|permission|access_denied/.test(code)) return new AIError('auth_expired');
  if (/timeout|timed_out/.test(code)) return new AIError('timeout');
  if (/refus|content_filter/.test(code)) return new AIError('refusal');
  return new AIError('network');
}
export type ResponsesSseInput = string | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>;
async function* chunks(input: Exclude<ResponsesSseInput, string>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  if ('getReader' in input) {
    const reader = input.getReader();
    let exhausted = false;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) { exhausted = true; break; }
        yield decoder.decode(next.value, { stream: true });
      }
      yield decoder.decode();
    } finally {
      if (!exhausted) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } else {
    for await (const chunk of input) yield typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    yield decoder.decode();
  }
}
/** Pure framing/parser: no fetch, storage, credentials, or platform dependencies. */
export async function parseResponsesSseStream(input: ResponsesSseInput): Promise<string> {
  let output = '';
  let completedText: string | undefined;
  let completed = false;
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let done = false;
  function frame() {
    if (data.length === 0) { event = ''; return; }
    const payload = data.join('\n');
    data = [];
    if (payload.trim() === '[DONE]') { done = true; return; }
    let value: JsonObject;
    try { value = object(JSON.parse(payload)); } catch { throw new AIError('malformed_output'); }
    const type = event || value.type;
    event = '';
    if (type === 'response.refusal.delta' || type === 'response.refusal.done') throw new AIError('refusal');
    if (type === 'response.failed' || type === 'error') throw mapProviderError(value);
    if (type === 'response.incomplete') throw new AIError('malformed_output');
    if (type === 'response.output_text.delta' && typeof value.delta === 'string') output += value.delta;
    if (type === 'response.completed') {
      const response = object(value.response);
      if (response.status === 'failed' || response.error) throw mapProviderError(response);
      if (response.status === 'incomplete') throw new AIError('malformed_output');
      completed = true;
      const text: string[] = [];
      if (Array.isArray(response.output)) for (const rawItem of response.output) {
        const item = object(rawItem);
        if (Array.isArray(item.content)) for (const rawContent of item.content) {
          const content = object(rawContent);
          if (content.type === 'refusal') throw new AIError('refusal');
          if (content.type === 'output_text' && typeof content.text === 'string') text.push(content.text);
        }
      }
      if (text.length) completedText = text.join('');
      else if (typeof response.output_text === 'string') completedText = response.output_text;
    }
  }
  function line(value: string) {
    if (!value) { frame(); return; }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    const content = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = content;
    if (field === 'data') data.push(content);
  }
  const source = typeof input === 'string' ? (async function* () { yield input; })() : chunks(input);
  for await (const chunk of source) {
    buffer += chunk;
    while (!done) {
      const newline = buffer.search(/[\r\n]/);
      if (newline < 0 || (buffer[newline] === '\r' && newline === buffer.length - 1)) break;
      const width = buffer[newline] === '\r' && buffer[newline + 1] === '\n' ? 2 : 1;
      line(buffer.slice(0, newline));
      buffer = buffer.slice(newline + width);
    }
    if (done) break;
  }
  if (!done) { if (buffer) line(buffer.replace(/\r$/, '')); frame(); }
  if (!completed && !done) {
    if (output.trim()) throw new AIError('network');
    throw new AIError('malformed_output');
  }
  const result = completedText ?? output;
  if (!result.trim()) throw new AIError('malformed_output');
  return result;
}
