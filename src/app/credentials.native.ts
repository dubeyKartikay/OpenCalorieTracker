import * as SecureStore from 'expo-secure-store';

// Keep these exports identical to credentials.ts: Metro selects this module on devices.
export interface OAuthSession {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAtMs?: number | undefined;
  clientId?: string | undefined;
  accountSubject?: string | undefined;
}

export interface OAuthRegistration {
  clientId: string;
  accountSubject?: string | undefined;
}

export interface CredentialStore {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;
  getOAuthToken(): Promise<string | null>;
  setOAuthToken(token: string): Promise<void>;
  clearOAuthToken(): Promise<void>;
  getOAuthSession?(): Promise<OAuthSession | null>;
  setOAuthSession?(session: OAuthSession): Promise<void>;
  getOAuthRegistration?(): Promise<OAuthRegistration | null>;
  setOAuthRegistration?(registration: OAuthRegistration): Promise<void>;
  getOAuthHostId?(): Promise<string | null>;
  setOAuthHostId?(hostId: string): Promise<void>;
}

export function createMemoryCredentialStore(): CredentialStore {
  let apiKey: string | null = null;
  let oauthSession: OAuthSession | null = null;
  let oauthRegistration: OAuthRegistration | null = null;
  let oauthHostId: string | null = null;
  return {
    async getApiKey() { return apiKey; },
    async setApiKey(key) { apiKey = key; },
    async clearApiKey() { apiKey = null; },
    async getOAuthToken() { return oauthSession?.accessToken ?? null; },
    async setOAuthToken(token) { oauthSession = { accessToken: token }; },
    async clearOAuthToken() { oauthSession = null; },
    async getOAuthSession() { return oauthSession; },
    async setOAuthSession(session) { oauthSession = { ...session }; },
    async getOAuthRegistration() { return oauthRegistration; },
    async setOAuthRegistration(registration) { oauthRegistration = { ...registration }; },
    async getOAuthHostId() { return oauthHostId; },
    async setOAuthHostId(hostId) { oauthHostId = hostId; },
  };
}

function parseStoredRegistration(raw: string | null): OAuthRegistration | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OAuthRegistration>;
    if (typeof parsed.clientId !== 'string' || !parsed.clientId.trim()) return null;
    return {
      clientId: parsed.clientId.trim(),
      ...(typeof parsed.accountSubject === 'string' && parsed.accountSubject ? { accountSubject: parsed.accountSubject } : {}),
    };
  } catch {
    return null;
  }
}

function parseStoredSession(raw: string | null): OAuthSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OAuthSession>;
    if (typeof parsed.accessToken !== 'string' || !parsed.accessToken) return null;
    return {
      accessToken: parsed.accessToken,
      ...(typeof parsed.refreshToken === 'string' && parsed.refreshToken ? { refreshToken: parsed.refreshToken } : {}),
      ...(typeof parsed.expiresAtMs === 'number' && Number.isFinite(parsed.expiresAtMs) ? { expiresAtMs: parsed.expiresAtMs } : {}),
      ...(typeof parsed.clientId === 'string' && parsed.clientId ? { clientId: parsed.clientId } : {}),
      ...(typeof parsed.accountSubject === 'string' && parsed.accountSubject ? { accountSubject: parsed.accountSubject } : {}),
    };
  } catch {
    return null;
  }
}

export function createCredentialStore(): CredentialStore {
  const apiKey = 'oct.openai.api-key';
  const oauthToken = 'oct.openai.oauth-token';
  const oauthSessionKey = 'oct.openai.oauth-session';
  const oauthRegistrationKey = 'oct.openai.oauth-registration';
  const oauthHostIdKey = 'oct.openai.oauth-host-id';
  const readSession = async (): Promise<OAuthSession | null> => {
    const stored = parseStoredSession(await SecureStore.getItemAsync(oauthSessionKey));
    if (stored) return stored;
    const legacy = await SecureStore.getItemAsync(oauthToken);
    return legacy ? { accessToken: legacy } : null;
  };
  return {
    getApiKey: () => SecureStore.getItemAsync(apiKey),
    setApiKey: key => SecureStore.setItemAsync(apiKey, key),
    clearApiKey: () => SecureStore.deleteItemAsync(apiKey),
    getOAuthToken: async () => (await readSession())?.accessToken ?? null,
    setOAuthToken: async token => {
      await SecureStore.setItemAsync(oauthSessionKey, JSON.stringify({ accessToken: token }));
      await SecureStore.deleteItemAsync(oauthToken).catch(() => undefined);
    },
    clearOAuthToken: async () => {
      const results = await Promise.allSettled([
        SecureStore.deleteItemAsync(oauthSessionKey),
        SecureStore.deleteItemAsync(oauthToken),
      ]);
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) throw failed.reason;
    },
    getOAuthSession: readSession,
    setOAuthSession: async session => {
      await SecureStore.setItemAsync(oauthSessionKey, JSON.stringify(session));
      await SecureStore.deleteItemAsync(oauthToken).catch(() => undefined);
    },
    getOAuthRegistration: async () => parseStoredRegistration(await SecureStore.getItemAsync(oauthRegistrationKey)),
    setOAuthRegistration: registration => SecureStore.setItemAsync(oauthRegistrationKey, JSON.stringify(registration)),
    getOAuthHostId: () => SecureStore.getItemAsync(oauthHostIdKey),
    setOAuthHostId: hostId => SecureStore.setItemAsync(oauthHostIdKey, hostId),
  };
}

export function maskSecretKey(key: string): string {
  const prefix = key.startsWith('sk-proj-') ? 'sk-proj-' : key.startsWith('sk-') ? 'sk-' : '';
  return `${prefix}••••${key.length > prefix.length + 4 ? key.slice(-4) : ''}`;
}
