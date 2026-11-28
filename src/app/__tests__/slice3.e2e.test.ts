import { createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoodSourceRegistry } from '../../catalog';
import { AIError, clearOAuthJwksCache, OPENAI_ISSUER, OPENAI_JWKS_URI, OPENAI_REQUIRED_PLAN_SCOPE, OPENAI_REVOKE_ENDPOINT, OPENAI_TOKEN_ENDPOINT } from '../../ai';
import type { AIProvider, LoopbackAuthPort, MealExtraction } from '../../ai';
import { calculateNutrition, foodRecordSchema, generateId } from '../../domain';
import { DiaryRepo, GoalsRepo, LibraryRepo, migrateDatabase, PacksRepo } from '../../storage';
import { createNodeSqliteDriver } from '../../storage/nodeDriver';
import { AppController } from '../controller';
import type { ControllerDependencies } from '../controller';
import { createMemoryCredentialStore, maskSecretKey } from '../credentials';

let onOpenBrowserUrl: ((url: string) => void) | null = null;
vi.mock('@sqlite.org/sqlite-wasm/sqlite3.wasm', () => ({ default: 1 }));
vi.mock('expo-web-browser', () => ({
  openBrowserAsync: async (url: string) => {
    onOpenBrowserUrl?.(url);
    return { type: 'opened' };
  },
  dismissBrowser: () => {},
}));
vi.mock('expo-asset', () => ({ Asset: { fromModule: () => ({
  uri: resolve('node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm'),
  async downloadAsync() {},
}) } }));

const DATE = '2026-11-23';
const directories: string[] = [];
const controllers: AppController[] = [];
const question: MealExtraction['clarifying_questions'][number] = {
  id: 'fat', topic: 'cooking_fat', label: 'Cooking fat?', options: [
    { id: 'ghee', label: '1 tsp ghee', effect: { kind: 'add_food', query: 'ghee', amount: 1, unit: 'tsp' } },
    { id: 'none', label: 'None', effect: { kind: 'none' } },
  ],
};
const extraction: MealExtraction = { items: [
  { query: 'roti', display_name: 'Roti', prep_state: 'cooked', amount: 2, unit: 'roti', portion_certainty: 'stated' },
  { query: 'arhar dal', display_name: 'Dal', prep_state: 'cooked', amount: 100, unit: 'g', portion_certainty: 'estimated', estimate_range: { min_g: 80, max_g: 120 } },
], clarifying_questions: [question] };
function mockAI() {
  return { completeJson: vi.fn<AIProvider['completeJson']>().mockImplementation(async request => {
    if (request.instructions.startsWith('Choose one')) {
      const ambiguous = JSON.parse(request.userText) as { item_index: number }[];
      return { selections: ambiguous.map(item => ({ item_index: item.item_index, chosen_candidate_index: 0 })) };
    }
    return extraction;
  }) };
}
async function open(extra: Partial<ControllerDependencies> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'oct-slice3-')); directories.push(directory);
  const userDb = createNodeSqliteDriver(join(directory, 'user.db')); await migrateDatabase(userDb);
  const offCacheDb = createNodeSqliteDriver(join(directory, 'off_cache.sqlite'));
  const credentials = createMemoryCredentialStore();
  const ai = mockAI();
  const app = new AppController({ userDb, offCacheDb, credentials, catalog: new FoodSourceRegistry(userDb),
    diary: new DiaryRepo(userDb), library: new LibraryRepo(userDb), goals: new GoalsRepo(userDb), packs: new PacksRepo(userDb),
    aiProviderFactory: () => ai, ...extra });
  controllers.push(app);
  for (const name of ['usda-fdc-starter', 'custom-home-pack']) {
    const path = resolve(`assets/packs/${name}.octpack.sqlite`);
    await app.installPack(createNodeSqliteDriver(path, { readOnly: true }), path, name === 'custom-home-pack' ? 50 : 100);
  }
  return { app, credentials, ai, directory };
}
async function connect(app: AppController) { await app.setAIConsent(true); await app.saveApiKey('  sk-proj-test-secret-9d3f  '); }
async function capture(app: AppController) { return app.captureMealWithAI({ text: '2 roti and 100 g dal', meal: 'Lunch', date: DATE }); }
afterEach(async () => {
  vi.useRealTimers(); vi.unstubAllGlobals();
  for (const controller of controllers.splice(0)) await controller.close();
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

describe('Slice 3 against real SQLite and compiled packs', () => {
  it('opens both compiled packs with real SQLite WASM, searches FTS5 and enforces read-only SQL', async () => {
    const { createWebSqliteDriver } = await import('../webSqliteDriver');
    const userDb = await createWebSqliteDriver();
    await migrateDatabase(userDb);
    const app = new AppController({ userDb, catalog: new FoodSourceRegistry(userDb), diary: new DiaryRepo(userDb),
      library: new LibraryRepo(userDb), goals: new GoalsRepo(userDb), packs: new PacksRepo(userDb) });
    controllers.push(app);
    for (const name of ['usda-fdc-starter', 'custom-home-pack']) {
      const path = resolve(`assets/packs/${name}.octpack.sqlite`);
      const db = await createWebSqliteDriver({ bytes: new Uint8Array(readFileSync(path)), readOnly: true });
      await expect(db.runAsync('DELETE FROM foods')).rejects.toThrow();
      await app.installPack(db, path, name === 'custom-home-pack' ? 50 : 100);
    }
    expect((await app.search('oats')).database.length).toBeGreaterThan(0);
    expect((await app.search('roti')).database[0]!.food.source_pack_id).toBe('custom-home-pack');
    expect(await app.resolveBarcode('8901262010016')).toMatchObject({ status: 'found', tier: 'pack' });
    await app.quickAdd({ kcal: 250, meal: 'Lunch', date: DATE, idempotencyKey: 'wasm-confirm' });
    expect((await app.day(DATE)).totals.nutrients!.kcal).toBe(250);
  });

  it('round-trips real WASM database images through the IndexedDB port and saves rolled-back state', async () => {
    // Only the browser IO port is simulated; the SQL engine, exported images and migrations are real.
    const images = new Map<string, ArrayBuffer>();
    const idb = { open: vi.fn((name: string) => {
      expect(name).toBe('oct-web-storage');
      const database = { createObjectStore() {}, transaction: () => {
        const tx = { oncomplete: null as (() => void) | null, objectStore: () => ({
          get(key: string) {
            const request = { result: images.get(key), onsuccess: null as (() => void) | null };
            queueMicrotask(() => request.onsuccess?.()); return request;
          },
          put(value: ArrayBuffer, key: string) {
            images.set(key, value.slice(0)); queueMicrotask(() => tx.oncomplete?.());
          },
        }) };
        return tx;
      } };
      const request = { result: database, onupgradeneeded: null as (() => void) | null, onsuccess: null as (() => void) | null };
      queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); }); return request;
    }) };
    vi.stubGlobal('indexedDB', idb);
    const { createWebSqliteDriver } = await import('../webSqliteDriver');
    let db = await createWebSqliteDriver({ name: 'user.db' });
    try {
      await migrateDatabase(db);
      await db.runAsync("INSERT INTO preferences VALUES('aiModel','\"gpt-5\"','2026-11-23')");
      await expect(db.withTransactionAsync(async tx => {
        await tx.runAsync("UPDATE preferences SET value_json='\"uncommitted\"' WHERE key='aiModel'");
        throw new Error('Rollback');
      })).rejects.toThrow('Rollback');
    } finally { await db.closeAsync(); }
    expect(new TextDecoder().decode(images.get('user.db')!.slice(0, 15))).toBe('SQLite format 3');
    db = await createWebSqliteDriver({ name: 'user.db' });
    try {
      expect(await db.getFirstAsync('SELECT value_json FROM preferences WHERE key=?', 'aiModel')).toEqual({ value_json: '"gpt-5"' });
      await db.runAsync("UPDATE preferences SET value_json='\"gpt-5-mini\"' WHERE key='aiModel'");
    } finally { await db.closeAsync(); }
    db = await createWebSqliteDriver({ name: 'user.db' });
    try { expect(await db.getFirstAsync('SELECT value_json FROM preferences WHERE key=?', 'aiModel')).toEqual({ value_json: '"gpt-5-mini"' }); }
    finally { await db.closeAsync(); }
    const offCache = await createWebSqliteDriver({ name: 'off_cache.sqlite' });
    try {
      await offCache.execAsync('CREATE TABLE cache_marker (id INTEGER)');
      expect(await offCache.getFirstAsync("SELECT name FROM sqlite_master WHERE name='preferences'")).toBeNull();
    } finally { await offCache.closeAsync(); }
    expect(images.has('off_cache.sqlite')).toBe(true);
    expect(images.get('off_cache.sqlite')!.byteLength).not.toBe(images.get('user.db')!.byteLength);
  });

  it.each([
    ['8901262010016', 'ean_13', 'custom-amul-taaza-toned-milk'],
    ['04252614', 'upc_e', 'custom-lime-sparkling-water-test'],
    ['96385074', 'ean_8', 'custom-marie-biscuits-test'],
  ])('resolves bundled barcode %s with its exact symbology', async (code, symbology, id) => {
    const { app } = await open();
    expect(await app.resolveBarcode(code, symbology)).toMatchObject({ status: 'found', tier: 'pack', food: { id } });
  });

  it('saves an unknown barcode as a personal food for the next lookup', async () => {
    const { app } = await open();
    const code = '4006381333931';
    expect(await app.resolveBarcode(code)).toMatchObject({ status: 'not_found', liveLookupAttempted: false });
    const food = foodRecordSchema.parse({ id: generateId(), name: 'My label food', prep_state: 'prepared', basis: 'per_100g',
      provenance_kind: 'user', nutrients: { kcal: 230, protein_g: 5, carbs_g: 25, fat_g: 12 } });
    await app.saveCustomFoodWithBarcode(food, { rawCode: code });
    expect(await app.resolveBarcode(code)).toMatchObject({ status: 'found', tier: 'personal', food });
    await expect(app.saveCustomFoodWithBarcode({ ...food, name: '' }, { rawCode: code })).rejects.toThrow();
    expect((await app.deps.library.listCustomFoods())).toEqual([food]);
    expect(app.parseLabelText('Per 100 g\nEnergy 230 kcal\nProtein 5 g\nCarbohydrate 25 g\nFat 12 g')).toMatchObject({ basis: 'per_100g', nutrients: { kcal: 230, protein_g: 5 } });
  });

  it('defaults live OFF lookup off, enables it by preference and caches only in off_cache.sqlite', async () => {
    const { app } = await open();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ status: 1, product: {
      code: '4006381333931', product_name: 'Opt-in food', nutriments: {
        'energy-kcal_100g': 123, proteins_100g: 2, carbohydrates_100g: 9, fat_100g: 3,
      },
    } }));
    vi.stubGlobal('fetch', fetch);
    expect(await app.getPreferences()).toMatchObject({ allowLiveOffLookup: false, aiModel: 'gpt-5-mini', aiConsentAccepted: false });
    expect(await app.resolveBarcode('4006381333931')).toMatchObject({ status: 'not_found', liveLookupAttempted: false });
    expect(fetch).not.toHaveBeenCalled();
    await app.updatePreferences({ allowLiveOffLookup: true });
    expect(await app.resolveBarcode('4006381333931')).toMatchObject({ status: 'found', tier: 'off_live' });
    await app.updatePreferences({ allowLiveOffLookup: false });
    expect(await app.resolveBarcode('4006381333931')).toMatchObject({ status: 'found', tier: 'off_cache' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(await app.deps.offCacheDb!.getFirstAsync('SELECT COUNT(*) AS count FROM off_products')).toEqual({ count: 1 });
    expect(await app.deps.userDb.getFirstAsync("SELECT name FROM sqlite_master WHERE name='off_products'")).toBeNull();
    expect(await app.exportJson()).not.toContain('Opt-in food');
  });

  it('keeps credentials in session memory, masks keys, grounds AI locally and confirms/undoes a whole meal', async () => {
    const { app, credentials, ai } = await open();
    await connect(app); await app.setAIModel('gpt-5');
    expect(await credentials.getApiKey()).toBe('sk-proj-test-secret-9d3f');
    expect(await app.getAIStatus()).toMatchObject({ mode: 'api_key', model: 'gpt-5', consentAccepted: true, maskedKey: 'sk-proj-••••9d3f' });
    const proposal = await capture(app);
    expect(proposal.items).toHaveLength(2);
    expect(proposal.items.every(item => item.provenance_kind === 'database' && item.food.source_pack_id === 'custom-home-pack')).toBe(true);
    for (const item of proposal.items) expect(item.nutrients).toEqual(calculateNutrition(item.food, item.quantity));
    expect((await app.day(DATE)).totals.entryCount).toBe(0);
    const calls = ai.completeJson.mock.calls.length;
    vi.useFakeTimers(); const start = Date.now();
    const answered = (await app.answerDraftQuestion('fat', 'ghee'))!;
    expect(Date.now() - start).toBe(0); vi.useRealTimers();
    expect(ai.completeJson).toHaveBeenCalledTimes(calls);
    expect(answered.items).toHaveLength(3);
    expect(answered.items[2]!.food).toMatchObject({ id: 'usda-ghee', source_pack_id: 'usda-fdc-starter' });
    expect((await app.answerDraftQuestion('fat', 'ghee'))!.totals).toEqual(answered.totals);
    const entries = await app.confirmActiveDraft('meal-test');
    expect(entries).toHaveLength(3); expect(app.getActiveDraft()).toBeNull(); expect(app.undoAction?.label).toContain('3 items');
    expect((await app.day(DATE)).totals.nutrients).toEqual(answered.totals.nutrients);
    expect(entries[1]).toMatchObject({ portion_certainty: 'estimated', estimate_range: expect.any(Object) });
    const frozen = JSON.stringify(entries);
    await app.setPackEnabled('custom-home-pack', false);
    expect(JSON.stringify((await app.day(DATE)).day!.entries)).toBe(frozen);
    const backup = await app.exportJson();
    expect(backup).not.toContain('sk-proj-test-secret'); expect(backup).not.toContain('oauth-token');
    await app.undo(); expect((await app.day(DATE)).totals.entryCount).toBe(0); expect(app.undoAction).toBeNull();
  });

  it('rolls all confirmations back on a later failure and preserves the reviewed draft', async () => {
    const { app } = await open(); await connect(app); await capture(app);
    const draft = app.getActiveDraft();
    await app.deps.userDb.execAsync("CREATE TRIGGER reject_second BEFORE INSERT ON diary_entries WHEN NEW.idempotency_key='atomic:1' BEGIN SELECT RAISE(ABORT,'confirmation failure'); END");
    const undo = app.undoAction;
    await expect(app.confirmActiveDraft('atomic')).rejects.toThrow('confirmation failure');
    expect(app.getActiveDraft()).toBe(draft); expect(app.undoAction).toBe(undo);
    expect(await app.deps.userDb.getFirstAsync('SELECT COUNT(*) AS count FROM diary_entries')).toEqual({ count: 0 });
    expect(await app.deps.userDb.getFirstAsync('SELECT COUNT(*) AS count FROM learned_portions')).toEqual({ count: 0 });
    await app.deps.userDb.execAsync('DROP TRIGGER reject_second');
    const first = app.confirmActiveDraft('atomic'); const second = app.confirmActiveDraft('atomic');
    expect(first).toBe(second); expect(await first).toHaveLength(2);
    expect(await app.confirmActiveDraft('atomic')).toEqual([]);
  });

  it('removes exactly one draft item, recalculates unknown counts and discards without diary writes', async () => {
    const { app } = await open(); await connect(app); await capture(app);
    app.removeDraftItem('0');
    expect(app.getActiveDraft()!.proposal.items).toHaveLength(1);
    expect(app.getActiveDraft()!.proposal.totals.entryCount).toBe(1);
    const remaining = app.getActiveDraft()!.proposal.items[0]!;
    expect(app.getActiveDraft()!.proposal.totals.unknownCount).toEqual(remaining.unknownCount);
    expect((await app.answerDraftQuestion('fat', 'ghee'))!.items).toHaveLength(2);
    app.removeDraftItem('1');
    expect(app.getActiveDraft()!.proposal.items).toHaveLength(1);
    expect(app.getActiveDraft()!.proposal.clarifying_questions).toHaveLength(0);
    app.removeDraftItem('100'); expect(app.getActiveDraft()!.proposal.items).toHaveLength(1);
    app.removeDraftItem('0'); expect(app.getActiveDraft()).toBeNull();
    await capture(app); app.discardActiveDraft();
    expect(app.getActiveDraft()).toBeNull(); expect((await app.day(DATE)).totals.entryCount).toBe(0);
  });

  it('disconnects both credential modes without changing immutable diary entries', async () => {
    const { app, credentials } = await open(); await connect(app); await capture(app);
    const entries = await app.confirmActiveDraft();
    await credentials.setOAuthToken('test-oauth-token');
    expect((await app.getAIStatus()).mode).toBe('chatgpt_oauth');
    await app.disconnectAI();
    expect(await credentials.getApiKey()).toBeNull(); expect(await credentials.getOAuthToken()).toBeNull();
    expect(await app.getAIStatus()).toMatchObject({ mode: 'disconnected', maskedKey: null });
    expect((await app.day(DATE)).day!.entries).toEqual(entries);
    await expect(capture(app)).rejects.toMatchObject({ code: 'not_connected' });
    expect((await app.day(DATE)).day!.entries).toEqual(entries);
    expect(await app.connectChatGPTOAuth()).toEqual({ ok: false, message: 'Sign in with ChatGPT requires a native mobile dev build with the 127.0.0.1 loopback listener. You can connect an OpenAI API key right now, or keep tracking manually.' });
  });

  it('throws safe AI errors and preserves diary and existing draft on failure/cancellation', async () => {
    const { app, ai } = await open();
    await expect(app.saveApiKey('  ')).rejects.toThrow('Enter');
    await expect(capture(app)).rejects.toBeInstanceOf(AIError);
    await connect(app); await capture(app); const draft = app.getActiveDraft();
    ai.completeJson.mockRejectedValueOnce(new Error('secret provider diagnostic'));
    await expect(capture(app)).rejects.toMatchObject({ code: 'network' });
    expect(app.getActiveDraft()).toBe(draft); expect((await app.day(DATE)).totals.entryCount).toBe(0);
    const signal = AbortSignal.abort();
    await expect(app.captureMealWithAI({ text: 'meal', meal: 'Lunch', signal })).rejects.toMatchObject({ code: 'timeout' });
    expect(app.getActiveDraft()).toBe(draft);
    expect(await createMemoryCredentialStore().getApiKey()).toBeNull();
    expect(maskSecretKey('tiny')).not.toContain('tiny');
  });

  it('extracts a label into a draft without diary writes', async () => {
    const { app, ai } = await open(); await connect(app);
    const label = { name: 'Label food', brand: null, basis: 'per_100g', serving_g: null, serving_ml: null,
      kcal: 100, protein_g: 3, carbs_g: 4, fat_g: 5, fiber_g: null, sugar_g: 0, sat_fat_g: null, sodium_mg: null };
    ai.completeJson.mockResolvedValueOnce(label);
    expect(await app.extractLabelFromImage('data:image/png;base64,aGVsbG8=')).toEqual(label);
    expect(app.getActiveDraft()).toBeNull(); expect((await app.day(DATE)).totals.entryCount).toBe(0);
  });

  it('prevents an in-flight OAuth refresh from restoring credentials after sign-out or switching to an API key', async () => {
    let resolveRefresh!: (response: Response) => void;
    const aiFetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async url => {
      if (url === OPENAI_TOKEN_ENDPOINT) {
        return new Promise<Response>(resolve => { resolveRefresh = resolve; });
      }
      if (url === OPENAI_REVOKE_ENDPOINT) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${String(url)}`);
    });
    const { app, credentials } = await open({ aiFetch, aiProviderFactory: undefined });
    await app.setAIConsent(true);
    await credentials.setOAuthSession!({
      accessToken: 'expired-oauth-token',
      refreshToken: 'refresh-old',
      clientId: 'oaiapp_test',
      expiresAtMs: Date.now() - 10_000,
    });

    // Start capture while OAuth token needs refresh -> refresh hangs in flight
    const pendingCapture = capture(app);
    await vi.waitFor(() => expect(aiFetch).toHaveBeenCalledWith(OPENAI_TOKEN_ENDPOINT, expect.anything()));

    // User switches to an API key before refresh resolves
    await app.saveApiKey('sk-proj-fresh-api-key-9999');

    // Release delayed refresh response
    resolveRefresh(Response.json({
      access_token: 'stale-refreshed-oauth',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh-stale-2',
    }));

    await expect(pendingCapture).rejects.toMatchObject({ code: 'not_connected' });
    expect(await credentials.getOAuthSession!()).toBeNull();
    expect(await app.getAIStatus()).toMatchObject({ mode: 'api_key', maskedKey: 'sk-proj-••••9999' });
  });

  it('clears local credentials even when remote OAuth revocation fails', async () => {
    const aiFetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('offline'));
    const { app, credentials } = await open({ aiFetch, aiProviderFactory: undefined });
    await credentials.setOAuthSession!({
      accessToken: 'active-oauth',
      refreshToken: 'refresh-1',
      clientId: 'oaiapp_test',
      expiresAtMs: Date.now() + 600_000,
    });
    const result = await app.disconnectAI();
    expect(result).toEqual({ revokedRemote: false });
    expect(await credentials.getOAuthSession!()).toBeNull();
    expect((await app.getAIStatus()).mode).toBe('disconnected');
  });

  it('verifies ID token, required plan scope, client ID, and account subject before replacing credentials', async () => {
    clearOAuthJwksCache();
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k-e2e', alg: 'RS256', use: 'sig' };
    const encodePart = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const signIdToken = (claims: Record<string, unknown>) => {
      const signingInput = `${encodePart({ alg: 'RS256', typ: 'JWT', kid: 'k-e2e' })}.${encodePart(claims)}`;
      const sig = createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url');
      return `${signingInput}.${sig}`;
    };

    let lastNonce = '';
    let callbackClientId = 'oaiapp_registered';
    let tokenScope = `openid profile email ${OPENAI_REQUIRED_PLAN_SCOPE} offline_access`;
    let tokenSubject = 'acct-primary';
    let resolveCallback: ((result: { code: string; state: string; clientId?: string }) => void) | null = null;
    let currentState = '';

    const loopbackAuth: LoopbackAuthPort = {
      listen: async ({ expectedState }) => {
        currentState = expectedState;
        return {
          port: 49152,
          callback: new Promise(resolve => { resolveCallback = resolve; }),
          close: async () => {},
        };
      },
    };
    const aiFetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async url => {
      if (url === OPENAI_JWKS_URI) return Response.json({ keys: [jwk] });
      if (url === OPENAI_TOKEN_ENDPOINT) {
        const nowSec = Math.floor(Date.now() / 1000);
        return Response.json({
          access_token: 'oauth-access-1',
          refresh_token: 'oauth-refresh-1',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: tokenScope,
          id_token: signIdToken({
            iss: OPENAI_ISSUER,
            aud: callbackClientId,
            sub: tokenSubject,
            nonce: lastNonce,
            iat: nowSec - 5,
            exp: nowSec + 600,
          }),
        });
      }
      throw new Error(`Unexpected fetch URL: ${String(url)}`);
    });

    const { app, credentials } = await open({ loopbackAuth, aiFetch });
    await connect(app); // Start with an existing API key
    onOpenBrowserUrl = (url: string) => {
      lastNonce = new URL(url).searchParams.get('nonce') ?? '';
      queueMicrotask(() => {
        resolveCallback?.({ code: 'auth-code-1', state: currentState, clientId: callbackClientId });
      });
    };

    try {
      // 1. Missing required plan-sharing scope must fail without clearing the existing API key
      tokenScope = 'openid profile email';
      const missingScope = await app.connectChatGPTOAuth();
      expect(missingScope.ok).toBe(false);
      expect(await credentials.getApiKey()).toBe('sk-proj-test-secret-9d3f');
      expect(await credentials.getOAuthSession!()).toBeNull();

      // 2. Valid sign-in succeeds, saves accountSubject, and replaces API key
      tokenScope = `openid profile email ${OPENAI_REQUIRED_PLAN_SCOPE} offline_access`;
      const connected = await app.connectChatGPTOAuth();
      expect(connected.ok).toBe(true);
      expect(await credentials.getApiKey()).toBeNull();
      expect(await credentials.getOAuthSession!()).toMatchObject({
        clientId: 'oaiapp_registered',
        accountSubject: 'acct-primary',
      });

      // 3. Re-auth returning a different client_id must be rejected without clobbering the active session
      callbackClientId = 'oaiapp_impostor';
      const wrongClient = await app.connectChatGPTOAuth();
      expect(wrongClient.ok).toBe(false);
      expect(await credentials.getOAuthSession!()).toMatchObject({
        clientId: 'oaiapp_registered',
        accountSubject: 'acct-primary',
      });

      // 4. Re-auth returning a different account subject for the same client must be rejected
      callbackClientId = 'oaiapp_registered';
      tokenSubject = 'acct-different-user';
      const wrongSubject = await app.connectChatGPTOAuth();
      expect(wrongSubject.ok).toBe(false);
      expect(await credentials.getOAuthSession!()).toMatchObject({
        clientId: 'oaiapp_registered',
        accountSubject: 'acct-primary',
      });

      // 5. Sign-out retains the registered clientId so re-signing in reuses it instead of dynamic_agent_client
      let seenAuthClientId = '';
      onOpenBrowserUrl = (url: string) => {
        const parsed = new URL(url);
        lastNonce = parsed.searchParams.get('nonce') ?? '';
        seenAuthClientId = parsed.searchParams.get('client_id') ?? '';
        queueMicrotask(() => {
          resolveCallback?.({ code: 'auth-code-2', state: currentState, clientId: 'oaiapp_registered' });
        });
      };
      await app.disconnectAI();
      tokenSubject = 'acct-primary';
      const reconnected = await app.connectChatGPTOAuth();
      expect(reconnected.ok).toBe(true);
      expect(seenAuthClientId).toBe('oaiapp_registered');
    } finally {
      onOpenBrowserUrl = null;
    }
  });

  it('prevents an in-flight OAuth sign-in from overwriting a newer API key choice', async () => {
    clearOAuthJwksCache();
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k-race', alg: 'RS256', use: 'sig' };
    const encodePart = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const signIdToken = (claims: Record<string, unknown>) => {
      const signingInput = `${encodePart({ alg: 'RS256', typ: 'JWT', kid: 'k-race' })}.${encodePart(claims)}`;
      const sig = createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url');
      return `${signingInput}.${sig}`;
    };

    let lastNonce = '';
    let currentState = '';
    let resolveCallback: ((result: { code: string; state: string; clientId?: string }) => void) | null = null;
    let releaseTokenExchange!: (response: Response) => void;

    const loopbackAuth: LoopbackAuthPort = {
      listen: async ({ expectedState }) => {
        currentState = expectedState;
        return {
          port: 49152,
          callback: new Promise(resolve => { resolveCallback = resolve; }),
          close: async () => {},
        };
      },
    };
    const aiFetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async url => {
      if (url === OPENAI_JWKS_URI) return Response.json({ keys: [jwk] });
      if (url === OPENAI_TOKEN_ENDPOINT) {
        return new Promise<Response>(resolve => { releaseTokenExchange = resolve; });
      }
      throw new Error(`Unexpected fetch URL: ${String(url)}`);
    });

    const { app, credentials } = await open({ loopbackAuth, aiFetch });
    onOpenBrowserUrl = (url: string) => {
      lastNonce = new URL(url).searchParams.get('nonce') ?? '';
      queueMicrotask(() => {
        resolveCallback?.({ code: 'auth-code-race', state: currentState, clientId: 'oaiapp_race' });
      });
    };

    try {
      const pendingSignIn = app.connectChatGPTOAuth();
      await vi.waitFor(() => expect(aiFetch).toHaveBeenCalledWith(OPENAI_TOKEN_ENDPOINT, expect.anything()));

      // User saves an API key while OAuth exchange is still in flight
      await app.saveApiKey('sk-proj-winner-key-4321');

      const nowSec = Math.floor(Date.now() / 1000);
      releaseTokenExchange(Response.json({
        access_token: 'late-oauth-token',
        refresh_token: 'late-oauth-refresh',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: `openid ${OPENAI_REQUIRED_PLAN_SCOPE}`,
        id_token: signIdToken({
          iss: OPENAI_ISSUER,
          aud: 'oaiapp_race',
          sub: 'acct-race',
          nonce: lastNonce,
          iat: nowSec - 5,
          exp: nowSec + 600,
        }),
      }));

      const outcome = await pendingSignIn;
      expect(outcome.ok).toBe(false);
      expect(await credentials.getApiKey()).toBe('sk-proj-winner-key-4321');
      expect(await credentials.getOAuthSession!()).toBeNull();
    } finally {
      onOpenBrowserUrl = null;
    }
  });

  it('prevents a delayed API-key read from sending an OpenAI POST after sign-out', async () => {
    const aiFetch = vi.fn<typeof globalThis.fetch>();
    let releaseKeyRead!: (value: string | null) => void;
    const baseStore = createMemoryCredentialStore();
    let delayReads = false;
    const credentials = {
      ...baseStore,
      getApiKey: async () => {
        if (!delayReads) return baseStore.getApiKey();
        delayReads = false;
        return new Promise<string | null>(resolve => { releaseKeyRead = resolve; });
      },
    };
    const { app } = await open({ credentials, aiFetch, aiProviderFactory: undefined });
    await app.setAIConsent(true);
    await app.saveApiKey('sk-proj-test-key-1111');

    // connectedProvider() reads key once via aiConnection(); next read inside OpenAIResponsesProvider hangs
    const origGetApiKey = credentials.getApiKey;
    let callCount = 0;
    credentials.getApiKey = async () => {
      callCount += 1;
      if (callCount === 2) {
        delayReads = true;
      }
      return origGetApiKey();
    };

    const pendingCapture = capture(app);
    await vi.waitFor(() => expect(callCount).toBe(2));

    await app.disconnectAI();
    releaseKeyRead('sk-proj-test-key-1111');

    await expect(pendingCapture).rejects.toMatchObject({ code: 'not_connected' });
    expect(aiFetch).not.toHaveBeenCalled();
  });

  it('keeps manual AI draft quantity edits intact when subsequent clarifications are replayed', async () => {
    const scaleQuestion: MealExtraction['clarifying_questions'][number] = {
      id: 'size',
      topic: 'portion',
      label: 'Portion size?',
      options: [
        { id: 'double', label: 'Double', effect: { kind: 'scale_item', targetItemIndex: 0, multiplier: 2 } },
        { id: 'normal', label: 'Normal', effect: { kind: 'none' } },
      ],
    };
    const customAi = {
      completeJson: vi.fn<AIProvider['completeJson']>().mockResolvedValue({
        items: [{ query: 'roti', display_name: 'Roti', prep_state: 'cooked', amount: 2, unit: 'roti', portion_certainty: 'stated' }],
        clarifying_questions: [scaleQuestion, question],
      }),
    };
    const { app } = await open({ aiProviderFactory: () => customAi });
    await connect(app);
    await capture(app);

    await app.answerDraftQuestion('size', 'double');
    expect(app.getActiveDraft()?.proposal.items[0]?.quantity.amount).toBe(4);

    // User manually corrects roti to 3
    const rotiUnit = app.getActiveDraft()!.proposal.items[0]!.quantity.unit;
    app.updateDraftItemQuantity(0, { amount: 3, unit: rotiUnit });
    expect(app.getActiveDraft()?.proposal.items[0]?.quantity.amount).toBe(3);

    // Answering another clarification must NOT re-multiply 3 into 6
    await app.answerDraftQuestion('fat', 'ghee');
    expect(app.getActiveDraft()?.proposal.items[0]?.quantity.amount).toBe(3);
  });

  it('blocks new AI captures while disconnectAI credential deletion is still in flight', async () => {
    const aiFetch = vi.fn<typeof globalThis.fetch>();
    let releaseClear!: () => void;
    const baseStore = createMemoryCredentialStore();
    const credentials = {
      ...baseStore,
      clearApiKey: async () => {
        await new Promise<void>(resolve => { releaseClear = resolve; });
        await baseStore.clearApiKey();
      },
    };
    const { app } = await open({ credentials, aiFetch, aiProviderFactory: undefined });
    await app.setAIConsent(true);
    await app.saveApiKey('sk-proj-pending-signout-8888');

    const pendingSignOut = app.disconnectAI();
    // Capture while clearApiKey() is still suspended must be rejected without sending a POST
    await expect(capture(app)).rejects.toMatchObject({ code: 'not_connected' });
    expect(aiFetch).not.toHaveBeenCalled();

    releaseClear();
    await pendingSignOut;
  });
});
