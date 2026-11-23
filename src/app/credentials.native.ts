import * as SecureStore from 'expo-secure-store';

// Keep these exports identical to credentials.ts: Metro selects this module on devices.
export interface CredentialStore {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;
  getOAuthToken(): Promise<string | null>;
  setOAuthToken(token: string): Promise<void>;
  clearOAuthToken(): Promise<void>;
}
export function createMemoryCredentialStore(): CredentialStore {
  let apiKey: string | null = null;
  let oauthToken: string | null = null;
  return {
    async getApiKey() { return apiKey; }, async setApiKey(key) { apiKey = key; }, async clearApiKey() { apiKey = null; },
    async getOAuthToken() { return oauthToken; }, async setOAuthToken(token) { oauthToken = token; }, async clearOAuthToken() { oauthToken = null; },
  };
}
export function createCredentialStore(): CredentialStore {
  const apiKey = 'oct.openai.api-key'; const oauthToken = 'oct.openai.oauth-token';
  return {
    getApiKey: () => SecureStore.getItemAsync(apiKey),
    setApiKey: key => SecureStore.setItemAsync(apiKey, key),
    clearApiKey: () => SecureStore.deleteItemAsync(apiKey),
    getOAuthToken: () => SecureStore.getItemAsync(oauthToken),
    setOAuthToken: token => SecureStore.setItemAsync(oauthToken, token),
    clearOAuthToken: () => SecureStore.deleteItemAsync(oauthToken),
  };
}
export function maskSecretKey(key: string): string {
  const prefix = key.startsWith('sk-proj-') ? 'sk-proj-' : key.startsWith('sk-') ? 'sk-' : '';
  return `${prefix}••••${key.length > prefix.length + 4 ? key.slice(-4) : ''}`;
}
