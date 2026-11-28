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

/** Web credentials live only in this session's memory, never in browser/database storage. */
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
export const createCredentialStore = createMemoryCredentialStore;

export function maskSecretKey(key: string): string {
  const prefix = key.startsWith('sk-proj-') ? 'sk-proj-' : key.startsWith('sk-') ? 'sk-' : '';
  return `${prefix}••••${key.length > prefix.length + 4 ? key.slice(-4) : ''}`;
}
