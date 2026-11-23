import { z } from 'zod';
import { AIError } from './types';

export interface PkcePair { codeVerifier: string; codeChallenge: string; state: string }
function base64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!; const b = bytes[i + 1]; const c = bytes[i + 2];
    result += alphabet[a >> 2]! + alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) result += alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) result += alphabet[c & 63]!;
  }
  return result;
}
/** Inject native WebCrypto in Dev Builds; never fall back to Math.random for credentials. */
export async function generatePkcePair(crypto: Crypto = globalThis.crypto): Promise<PkcePair> {
  if (!crypto?.subtle || !crypto.getRandomValues) throw new Error('Secure WebCrypto is required for sign-in');
  const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return { codeVerifier, codeChallenge: base64Url(new Uint8Array(digest)), state };
}
export function loopbackRedirectUri(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('Invalid loopback port');
  return `http://127.0.0.1:${port}/callback`;
}
export interface AuthorizationUrlOptions {
  clientId: string; port: number; codeChallenge: string; state: string;
}
export function buildAuthorizationUrl(options: AuthorizationUrlOptions): string {
  if (!options.clientId.trim() || !/^[A-Za-z0-9_-]{43}$/.test(options.codeChallenge) || !options.state.trim()) {
    throw new Error('Invalid sign-in parameters');
  }
  const url = new URL('https://auth.openai.com/oauth/authorize');
  url.search = new URLSearchParams({
    response_type: 'code', client_id: options.clientId, redirect_uri: loopbackRedirectUri(options.port),
    scope: 'openid profile email offline_access chatgpt.tokens.use.direct',
    code_challenge: options.codeChallenge, code_challenge_method: 'S256', state: options.state,
  }).toString();
  return url.toString();
}
const tokenSchema = z.object({
  access_token: z.string().min(1), token_type: z.string().min(1),
  refresh_token: z.string().min(1).optional(), expires_in: z.number().finite().positive().optional(),
  id_token: z.string().min(1).optional(), scope: z.string().optional(),
});
export type OAuthTokens = z.infer<typeof tokenSchema>;
export interface ExchangeAuthorizationCodeOptions {
  clientId: string; port: number; code: string; codeVerifier: string;
  state: string; expectedState: string;
  fetch?: typeof globalThis.fetch; signal?: AbortSignal;
}
/** The caller stores returned tokens in secure device storage; never user.db or exports. */
export async function exchangeAuthorizationCode(options: ExchangeAuthorizationCodeOptions): Promise<OAuthTokens> {
  if (!options.state || options.state !== options.expectedState || !options.clientId.trim() || !options.code.trim()
    || !/^[A-Za-z0-9._~-]{43,128}$/.test(options.codeVerifier)) throw new AIError('auth_expired');
  const redirectUri = loopbackRedirectUri(options.port);
  try {
    const response = await (options.fetch ?? globalThis.fetch)('https://auth.openai.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: options.clientId,
        code: options.code, code_verifier: options.codeVerifier, redirect_uri: redirectUri }).toString(),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (response.status === 429) throw new AIError('quota_exhausted');
    if (response.status === 400 || response.status === 401 || response.status === 403) throw new AIError('auth_expired');
    if (!response.ok) throw new AIError('network');
    let value: unknown;
    try { value = await response.json(); } catch { throw new AIError('malformed_output'); }
    const parsed = tokenSchema.safeParse(value);
    if (!parsed.success) throw new AIError('malformed_output');
    return parsed.data;
  } catch (error) {
    if (error instanceof AIError) throw error;
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw new AIError('timeout');
    throw new AIError('network');
  }
}
export interface LoopbackAuthSession {
  port: number;
  /** Native listener accepts only /callback on 127.0.0.1 and validates the expected state. */
  callback: Promise<{ code: string; state: string }>;
  close(): Promise<void>;
}
export interface LoopbackAuthPort {
  /** Bind an ephemeral port. Close on success, error, cancellation, and timeout. */
  listen(options: { host: '127.0.0.1'; path: '/callback'; expectedState: string; signal?: AbortSignal }): Promise<LoopbackAuthSession>;
}
export const unavailableLoopbackAuthPort: LoopbackAuthPort = {
  async listen() { throw new Error('Loopback listener requires mobile dev build'); },
};
