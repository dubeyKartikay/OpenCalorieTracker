import { z } from 'zod';
import { AIError } from './types';

export const OPENAI_AUTHORIZE_ENDPOINT = 'https://auth.openai.com/api/accounts/authorize';
export const OPENAI_TOKEN_ENDPOINT = 'https://auth.openai.com/api/accounts/oauth/token';
export const OPENAI_REVOKE_ENDPOINT = 'https://auth.openai.com/api/accounts/oauth/revoke';
export const OPENAI_ISSUER = 'https://auth.openai.com';
export const OPENAI_JWKS_URI = 'https://auth.openai.com/.well-known/jwks.json';
export const OPENAI_API_RESOURCE = 'https://api.openai.com/v1';
export const OPENAI_REQUIRED_PLAN_SCOPE = 'chatgpt.tokens.use.direct';
export const OPENAI_OAUTH_SCOPE = `openid profile email offline_access resource.invoke ${OPENAI_REQUIRED_PLAN_SCOPE}`;
export const OPENAI_DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
export const DEFAULT_AGENT_NAME_HINT = 'OpenCalorieTracker';

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  nonce: string;
}

/** Platform-agnostic crypto bridge so Hermes (via expo-crypto) and Node/Web (via WebCrypto) share one PKCE path. */
export interface PkceCryptoProvider {
  getRandomBytes(count: number): Promise<Uint8Array> | Uint8Array;
  sha256(data: Uint8Array): Promise<Uint8Array>;
}

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

function isPkceCryptoProvider(value: unknown): value is PkceCryptoProvider {
  return typeof value === 'object' && value !== null && 'getRandomBytes' in value && 'sha256' in value;
}

function resolveCryptoProvider(input?: Crypto | PkceCryptoProvider): PkceCryptoProvider {
  if (isPkceCryptoProvider(input)) return input;
  const webCrypto = input ?? globalThis.crypto;
  if (!webCrypto?.subtle || !webCrypto.getRandomValues) {
    throw new Error('Secure WebCrypto or native crypto provider is required for sign-in');
  }
  return {
    getRandomBytes: count => webCrypto.getRandomValues(new Uint8Array(count)),
    sha256: async data => new Uint8Array(await webCrypto.subtle.digest('SHA-256', data as BufferSource)),
  };
}

/** Never fall back to Math.random for credentials: requires WebCrypto or an injected native crypto provider. */
export async function generatePkcePair(cryptoOrProvider?: Crypto | PkceCryptoProvider): Promise<PkcePair> {
  const provider = resolveCryptoProvider(cryptoOrProvider);
  const [verifierBytes, stateBytes, nonceBytes] = await Promise.all([
    provider.getRandomBytes(32),
    provider.getRandomBytes(32),
    provider.getRandomBytes(24),
  ]);
  const codeVerifier = base64Url(verifierBytes);
  const state = base64Url(stateBytes);
  const nonce = base64Url(nonceBytes);
  const digest = await provider.sha256(new TextEncoder().encode(codeVerifier));
  return { codeVerifier, codeChallenge: base64Url(digest), state, nonce };
}

export function loopbackRedirectUri(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('Invalid loopback port');
  return `http://127.0.0.1:${port}/callback`;
}

export interface AuthorizationUrlOptions {
  clientId: string;
  port: number;
  codeChallenge: string;
  state: string;
  nonce?: string | undefined;
  /** Persistent host identifier (e.g. urn:uuid:...) required for OpenAI dynamic registration. */
  extAgentHostId?: string | undefined;
  /** Consistent app display name sent only on initial dynamic_agent_client registration. */
  agentNameHint?: string | undefined;
}

export function buildAuthorizationUrl(options: AuthorizationUrlOptions): string {
  const clientId = options.clientId.trim();
  if (!clientId || !/^[A-Za-z0-9_-]{43}$/.test(options.codeChallenge) || !options.state.trim()) {
    throw new Error('Invalid sign-in parameters');
  }
  const url = new URL(OPENAI_AUTHORIZE_ENDPOINT);
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: loopbackRedirectUri(options.port),
    scope: OPENAI_OAUTH_SCOPE,
    resource: OPENAI_API_RESOURCE,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    state: options.state,
  };
  if (options.nonce?.trim()) params.nonce = options.nonce.trim();
  if (options.extAgentHostId?.trim()) params.ext_agent_host_id = options.extAgentHostId.trim();
  if (clientId === OPENAI_DYNAMIC_CLIENT_ID && options.agentNameHint?.trim()) {
    params.agent_name_hint = options.agentNameHint.trim();
  }
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().finite().positive().optional(),
  id_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});
export type OAuthTokens = z.infer<typeof tokenSchema>;

const TERMINAL_OAUTH_ERRORS = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
  'access_denied',
  'invalid_scope',
  'expired_token',
]);

async function readOAuthErrorCode(response: Response): Promise<string | null> {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body?.error === 'string' ? body.error.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

async function postTokenForm(
  form: Record<string, string>,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<OAuthTokens> {
  try {
    const response = await fetchImpl(OPENAI_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      ...(signal ? { signal } : {}),
    });
    if (response.status === 429) throw new AIError('quota_exhausted');
    if (response.status === 401 || response.status === 403) throw new AIError('auth_expired');
    if (response.status === 400) {
      const errorCode = await readOAuthErrorCode(response);
      if (errorCode && TERMINAL_OAUTH_ERRORS.has(errorCode)) {
        throw new AIError('auth_expired');
      }
      throw new AIError('network');
    }
    if (!response.ok) throw new AIError('network');
    let value: unknown;
    try { value = await response.json(); } catch { throw new AIError('malformed_output'); }
    const parsed = tokenSchema.safeParse(value);
    if (!parsed.success) throw new AIError('malformed_output');
    return parsed.data;
  } catch (error) {
    if (error instanceof AIError) throw error;
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw new AIError('timeout');
    throw new AIError('network');
  }
}

export interface ExchangeAuthorizationCodeOptions {
  clientId: string;
  port: number;
  code: string;
  codeVerifier: string;
  state: string;
  expectedState: string;
  fetch?: typeof globalThis.fetch | undefined;
  signal?: AbortSignal | undefined;
}

/** The caller stores returned tokens in secure device storage; never user.db or exports. */
export async function exchangeAuthorizationCode(options: ExchangeAuthorizationCodeOptions): Promise<OAuthTokens> {
  if (!options.state || options.state !== options.expectedState || !options.clientId.trim() || !options.code.trim()
    || !/^[A-Za-z0-9._~-]{43,128}$/.test(options.codeVerifier)) throw new AIError('auth_expired');
  const redirectUri = loopbackRedirectUri(options.port);
  return postTokenForm(
    {
      grant_type: 'authorization_code',
      client_id: options.clientId.trim(),
      code: options.code,
      code_verifier: options.codeVerifier,
      redirect_uri: redirectUri,
      resource: OPENAI_API_RESOURCE,
    },
    options.fetch,
    options.signal,
  );
}

export interface RefreshAccessTokenOptions {
  clientId: string;
  refreshToken: string;
  fetch?: typeof globalThis.fetch | undefined;
  signal?: AbortSignal | undefined;
}

export async function refreshAccessToken(options: RefreshAccessTokenOptions): Promise<OAuthTokens> {
  if (!options.clientId.trim() || !options.refreshToken.trim()) throw new AIError('auth_expired');
  return postTokenForm(
    {
      grant_type: 'refresh_token',
      client_id: options.clientId.trim(),
      refresh_token: options.refreshToken,
      resource: OPENAI_API_RESOURCE,
    },
    options.fetch,
    options.signal,
  );
}

export interface RevokeOAuthTokenOptions {
  clientId: string;
  token: string;
  fetch?: typeof globalThis.fetch | undefined;
  signal?: AbortSignal | undefined;
}

/** Best-effort server-side token revocation on sign-out; never throws so local sign-out always completes. */
export async function revokeOAuthToken(options: RevokeOAuthTokenOptions): Promise<boolean> {
  if (!options.clientId.trim() || !options.token.trim()) return false;
  try {
    const response = await (options.fetch ?? globalThis.fetch)(OPENAI_REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: options.clientId.trim(),
        token: options.token,
      }).toString(),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface LoopbackAuthSession {
  port: number;
  /** Native listener accepts only /callback on 127.0.0.1 and validates the expected state. */
  callback: Promise<{ code: string; state: string; clientId?: string | undefined }>;
  close(): Promise<void>;
}

export interface LoopbackAuthPort {
  /** Bind an ephemeral port. Close on success, error, cancellation, and timeout. */
  listen(options: { host: '127.0.0.1'; path: '/callback'; expectedState: string; signal?: AbortSignal }): Promise<LoopbackAuthSession>;
}

export const unavailableLoopbackAuthPort: LoopbackAuthPort = {
  async listen() { throw new Error('Loopback listener requires mobile dev build'); },
};

/** Checks that the OAuth token response includes OpenAI's direct ChatGPT plan scope. */
export function hasRequiredOAuthScope(scope: string | undefined): boolean {
  if (!scope) return false;
  const granted = new Set(scope.trim().split(/\s+/).filter(Boolean));
  return granted.has(OPENAI_REQUIRED_PLAN_SCOPE);
}

function decodeBase64Url(input: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) throw new AIError('auth_expired');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    const val = code < 128 ? lookup[code]! : -1;
    if (val < 0) throw new AIError('auth_expired');
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bigIntToFixedBytes(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let remaining = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus <= 1n) return 0n;
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

// ASN.1 DER DigestInfo prefix for SHA-256 in RSASSA-PKCS1-v1_5 (RFC 8017 §9.2).
const RS256_DER_PREFIX = new Uint8Array([
  0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01,
  0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20,
]);

const jwkSchema = z.object({
  kty: z.string(),
  kid: z.string().optional(),
  alg: z.string().optional(),
  use: z.string().optional(),
  n: z.string().optional(),
  e: z.string().optional(),
  crv: z.string().optional(),
  x: z.string().optional(),
  y: z.string().optional(),
});
type JsonWebKeyRecord = z.infer<typeof jwkSchema>;

const jwksResponseSchema = z.object({
  keys: z.array(jwkSchema).min(1),
});

const jwtHeaderSchema = z.object({
  alg: z.string().min(1),
  kid: z.string().optional(),
  typ: z.string().optional(),
});

const idTokenPayloadSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1),
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  exp: z.number().finite(),
  iat: z.number().finite().optional(),
  nbf: z.number().finite().optional(),
  nonce: z.string().min(1),
});

export interface VerifiedIdToken {
  sub: string;
  iss: string;
  aud: string | string[];
  nonce: string;
  exp: number;
}

const jwksCache = new Map<string, { keys: JsonWebKeyRecord[]; fetchedAtMs: number }>();
const JWKS_CACHE_TTL_MS = 5 * 60_000;

export function clearOAuthJwksCache(): void {
  jwksCache.clear();
}

async function fetchJwksKeys(
  jwksUri: string,
  fetchImpl: typeof globalThis.fetch,
  signal?: AbortSignal,
  forceRefresh = false,
): Promise<JsonWebKeyRecord[]> {
  const cached = jwksCache.get(jwksUri);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAtMs < JWKS_CACHE_TTL_MS) {
    return cached.keys;
  }
  let response: Response;
  try {
    response = await fetchImpl(jwksUri, { method: 'GET', ...(signal ? { signal } : {}) });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw new AIError('timeout');
    throw new AIError('network');
  }
  if (!response.ok) throw new AIError('network');
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new AIError('auth_expired'); }
  const parsed = jwksResponseSchema.safeParse(raw);
  if (!parsed.success) throw new AIError('auth_expired');
  jwksCache.set(jwksUri, { keys: parsed.data.keys, fetchedAtMs: Date.now() });
  return parsed.data.keys;
}

async function verifyRs256WithJwk(
  jwk: JsonWebKeyRecord,
  signingInput: Uint8Array,
  signature: Uint8Array,
  cryptoProvider: PkceCryptoProvider,
): Promise<boolean> {
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return false;
  const nBytes = decodeBase64Url(jwk.n);
  const eBytes = decodeBase64Url(jwk.e);
  if (nBytes.length < 128 || signature.length !== nBytes.length) return false;
  const n = bytesToBigInt(nBytes);
  const e = bytesToBigInt(eBytes);
  const s = bytesToBigInt(signature);
  if (e < 3n || (e & 1n) === 0n || s >= n) return false;

  const digest = await cryptoProvider.sha256(signingInput);
  const tLen = RS256_DER_PREFIX.length + digest.length;
  const k = nBytes.length;
  if (k < tLen + 11) return false;
  const expected = new Uint8Array(k);
  expected[0] = 0x00;
  expected[1] = 0x01;
  const psLen = k - tLen - 3;
  expected.fill(0xff, 2, 2 + psLen);
  expected[2 + psLen] = 0x00;
  expected.set(RS256_DER_PREFIX, 3 + psLen);
  expected.set(digest, 3 + psLen + RS256_DER_PREFIX.length);

  const decrypted = bigIntToFixedBytes(modPow(s, e, n), k);
  return constantTimeEqual(decrypted, expected);
}

async function verifyJwtSignature(
  alg: string,
  jwk: JsonWebKeyRecord,
  signingInput: Uint8Array,
  signature: Uint8Array,
  cryptoProvider: PkceCryptoProvider,
): Promise<boolean> {
  if (alg === 'RS256') {
    return verifyRs256WithJwk(jwk, signingInput, signature, cryptoProvider);
  }
  if (alg === 'ES256' && jwk.kty === 'EC' && jwk.crv === 'P-256' && globalThis.crypto?.subtle) {
    try {
      const key = await globalThis.crypto.subtle.importKey(
        'jwk',
        jwk as JsonWebKey,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      return await globalThis.crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        signature as BufferSource,
        signingInput as BufferSource,
      );
    } catch {
      return false;
    }
  }
  return false;
}

export interface VerifyOAuthIdTokenOptions {
  idToken: string;
  expectedNonce: string;
  expectedAudience: string;
  expectedIssuer?: string | undefined;
  jwksUri?: string | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  pkceCrypto?: Crypto | PkceCryptoProvider | undefined;
  signal?: AbortSignal | undefined;
  nowMs?: number | undefined;
}

/**
 * Verifies an OpenAI OIDC ID token's signature against JWKS plus its issuer,
 * audience, nonce, and expiry claims before accepting an OAuth session.
 */
export async function verifyOAuthIdToken(options: VerifyOAuthIdTokenOptions): Promise<VerifiedIdToken> {
  const parts = options.idToken.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new AIError('auth_expired');

  let headerJson: unknown;
  let payloadJson: unknown;
  try {
    const decoder = new TextDecoder();
    headerJson = JSON.parse(decoder.decode(decodeBase64Url(parts[0])));
    payloadJson = JSON.parse(decoder.decode(decodeBase64Url(parts[1])));
  } catch {
    throw new AIError('auth_expired');
  }

  const headerParsed = jwtHeaderSchema.safeParse(headerJson);
  const payloadParsed = idTokenPayloadSchema.safeParse(payloadJson);
  if (!headerParsed.success || !payloadParsed.success) throw new AIError('auth_expired');
  const header = headerParsed.data;
  const payload = payloadParsed.data;

  const normalizeIssuer = (iss: string) => iss.replace(/\/+$/, '');
  const expectedIssuer = normalizeIssuer(options.expectedIssuer ?? OPENAI_ISSUER);
  if (normalizeIssuer(payload.iss) !== expectedIssuer) throw new AIError('auth_expired');

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(options.expectedAudience.trim())) throw new AIError('auth_expired');
  if (payload.nonce !== options.expectedNonce) throw new AIError('auth_expired');

  const nowSec = (options.nowMs ?? Date.now()) / 1000;
  const clockSkewSec = 60;
  if (payload.exp + clockSkewSec <= nowSec) throw new AIError('auth_expired');
  if (payload.nbf !== undefined && payload.nbf - clockSkewSec > nowSec) throw new AIError('auth_expired');

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const jwksUri = options.jwksUri ?? OPENAI_JWKS_URI;
  const cryptoProvider = resolveCryptoProvider(options.pkceCrypto);
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = decodeBase64Url(parts[2]);

  const filterKeys = (keys: JsonWebKeyRecord[]) =>
    keys.filter(key => {
      if (key.use && key.use !== 'sig') return false;
      if (header.kid && key.kid && key.kid !== header.kid) return false;
      if (header.kid && !key.kid) return false;
      if (key.alg && key.alg !== header.alg) return false;
      return true;
    });

  let keys = await fetchJwksKeys(jwksUri, fetchImpl, options.signal, false);
  let candidates = filterKeys(keys);
  if (candidates.length === 0) {
    keys = await fetchJwksKeys(jwksUri, fetchImpl, options.signal, true);
    candidates = filterKeys(keys);
  }
  for (const key of candidates) {
    if (await verifyJwtSignature(header.alg, key, signingInput, signature, cryptoProvider)) {
      return {
        sub: payload.sub,
        iss: payload.iss,
        aud: payload.aud,
        nonce: payload.nonce,
        exp: payload.exp,
      };
    }
  }
  throw new AIError('auth_expired');
}
