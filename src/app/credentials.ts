export interface CredentialStore {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;
  getOAuthToken(): Promise<string | null>;
  setOAuthToken(token: string): Promise<void>;
  clearOAuthToken(): Promise<void>;
}

/** Web credentials live only in this session's memory, never in browser/database storage. */
export function createMemoryCredentialStore(): CredentialStore {
  let apiKey: string | null = null;
  let oauthToken: string | null = null;
  return {
    async getApiKey() { return apiKey; },
    async setApiKey(key) { apiKey = key; },
    async clearApiKey() { apiKey = null; },
    async getOAuthToken() { return oauthToken; },
    async setOAuthToken(token) { oauthToken = token; },
    async clearOAuthToken() { oauthToken = null; },
  };
}
export const createCredentialStore = createMemoryCredentialStore;

export function maskSecretKey(key: string): string {
  const prefix = key.startsWith('sk-proj-') ? 'sk-proj-' : key.startsWith('sk-') ? 'sk-' : '';
  return `${prefix}••••${key.length > prefix.length + 4 ? key.slice(-4) : ''}`;
}
