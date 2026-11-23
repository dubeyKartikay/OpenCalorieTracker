import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FoodSourceRegistry } from '../../catalog';
import { calculateNutrition, generateId } from '../../domain';
import { exportBundleV1, LibraryRepo } from '../../storage';
import { food, resources } from '../../storage/__tests__/fixtures';
import { AIError, AI_MODEL_OPTIONS, applyClarifyingAnswer, buildAuthorizationUrl, captureMealDraft, DEFAULT_AI_MODEL,
  exchangeAuthorizationCode, extractNutritionLabel, generatePkcePair, looksLikeMultiFoodCapture, loopbackRedirectUri,
  mealExtractionSchema, OpenAIResponsesProvider, parseResponsesSseStream, unavailableLoopbackAuthPort } from '..';
import type { AIAuthMode, AIProvider, ExtractedMealItem, MealExtraction } from '..';

const scope = resources();
const image = 'data:image/png;base64,aGVsbG8=';
const fallback = { kcal: 200, protein_g: 5, carbs_g: 20, fat_g: 9, fiber_g: null };
const item = (overrides: Partial<ExtractedMealItem> = {}): ExtractedMealItem => ({
  query: 'roti', display_name: 'Roti', prep_state: 'cooked', amount: 2, unit: 'roti', portion_certainty: 'stated',
  estimated_fallback_per_100g: fallback, ...overrides,
});
const extraction = (items = [item()], clarifying_questions: MealExtraction['clarifying_questions'] = []): MealExtraction => ({ items, clarifying_questions });
const fatQuestion: MealExtraction['clarifying_questions'][number] = {
  id: 'fat', topic: 'cooking_fat', label: 'Fat', options: [
    { id: 'ghee', label: 'Ghee', effect: { kind: 'add_food', query: 'ghee', amount: 1, unit: 'tsp' } },
    { id: 'none', label: 'None', effect: { kind: 'none' } },
  ],
};
function provider(...values: unknown[]) {
  const completeJson = vi.fn<AIProvider['completeJson']>();
  for (const value of values) completeJson.mockResolvedValueOnce(value);
  return { completeJson };
}
function event(type: string, value: Record<string, unknown>): string { return `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`; }
function final(text: string): string {
  return event('response.completed', { response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] } });
}
function responseJson(value: unknown): Response { return new Response(final(JSON.stringify(value)), { headers: { 'Content-Type': 'text/event-stream' } }); }
async function* fragment(text: string, width = 1) {
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += width) yield bytes.slice(i, i + width);
}
async function setup() {
  const user = await scope.user();
  const catalog = new FoodSourceRegistry(user);
  await catalog.mountPack('usda-fdc-starter', scope.open(resolve('assets/packs/usda-fdc-starter.octpack.sqlite'), true));
  await catalog.mountPack('custom-home-pack', scope.open(resolve('assets/packs/custom-home-pack.octpack.sqlite'), true), 50);
  return { user, catalog };
}
async function changes(db: Awaited<ReturnType<typeof setup>>['user']) {
  return (await db.getFirstAsync<{ count: number }>('SELECT total_changes() AS count'))!.count;
}

describe('Responses SSE framing', () => {
  it('accumulates deltas through arbitrary byte, UTF-8, CRLF and frame splits', async () => {
    const text = `: heartbeat\r\n\r\n${event('response.output_text.delta', { delta: '{"name":' })}${event('response.output_text.delta', { delta: '"café"}' })}data: [DONE]\n\n`;
    for (const width of [1, 2, 3, 7, 31]) expect(await parseResponsesSseStream(fragment(text.replace(/(?<!\r)\n/g, '\r\n'), width))).toBe('{"name":"café"}');
  });
  it('accepts data-only event types and a final frame without a newline', async () => {
    expect(await parseResponsesSseStream('data: {"type":"response.output_text.delta","delta":"{}"}')).toBe('{}');
  });
  it('joins multiline data and ignores unrelated event fields', async () => {
    expect(await parseResponsesSseStream('id: 1\nretry: 10\nevent: response.output_text.delta\ndata: {"delta":\ndata: "{}"}\n\n')).toBe('{}');
  });
  it('extracts final content and avoids duplicating earlier deltas', async () => {
    const text = event('response.output_text.delta', { delta: '{"x":' }) + final('{"x":1}') + 'data: [DONE]\n\n';
    expect(await parseResponsesSseStream(text)).toBe('{"x":1}');
    expect(await parseResponsesSseStream(final('{"x":1}'))).toBe('{"x":1}');
    expect(await parseResponsesSseStream(event('response.completed', { response: { output_text: '{}' } }))).toBe('{}');
  });
  it('stops at DONE and cancels an unfinished stream', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(event('response.output_text.delta', { delta: '{}' }) + 'data: [DONE]\n\n' + event('error', { code: 'bad' })));
    }, cancel });
    expect(await parseResponsesSseStream(stream)).toBe('{}');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(['response.refusal.delta', 'response.refusal.done'])('throws a typed refusal for %s', async type => {
    await expect(parseResponsesSseStream(event(type, { delta: 'private refusal content' }))).rejects.toMatchObject({ name: 'AIError', code: 'refusal' });
  });
  it('detects refusal in final output', async () => {
    await expect(parseResponsesSseStream(event('response.completed', { response: { output: [{ content: [{ type: 'refusal', refusal: 'private' }] }] } }))).rejects.toMatchObject({ code: 'refusal' });
  });
  it.each([
    ['response.failed', { response: { error: { code: 'insufficient_quota' } } }, 'quota_exhausted'],
    ['error', { code: 'invalid_api_key' }, 'auth_expired'],
    ['error', { error: { code: 'request_timeout' } }, 'timeout'],
    ['error', { code: 'server_error', message: 'secret provider diagnostics' }, 'network'],
    ['response.incomplete', {}, 'malformed_output'],
  ])('maps %s errors without raw provider text', async (type, payload, code) => {
    await expect(parseResponsesSseStream(event(type, payload))).rejects.toMatchObject({ name: 'AIError', code });
  });
  it.each(['data: nonsense\n\n', 'data: [DONE]\n\n', ': heartbeat\n\n'])('rejects unusable output', async text => {
    await expect(parseResponsesSseStream(text)).rejects.toMatchObject({ code: 'malformed_output' });
  });
});

describe('direct OpenAI Responses provider', () => {
  it.each(['chatgpt_oauth', 'api_key'] as const)('obeys the stateless constrained payload for %s', async authMode => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(responseJson({ ok: true }));
    const ai = new OpenAIResponsesProvider({ authMode, getAccessToken: () => 'test-secret', fetch });
    expect(await ai.completeJson({ instructions: 'Extract a meal.', userText: 'Current meal only', imageDataUrl: image })).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, request] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(request?.method).toBe('POST');
    const body = JSON.parse(request!.body as string);
    expect(body).toMatchObject({ model: DEFAULT_AI_MODEL, store: false, stream: true, instructions: expect.stringContaining('Extract a meal.'), input: [{ role: 'user', content: [{ type: 'input_text', text: 'Current meal only' }, { type: 'input_image', image_url: image }] }] });
    for (const key of ['temperature', 'top_p', 'max_output_tokens', 'max_tool_calls', 'metadata', 'user', 'truncation', 'previous_response_id', 'text']) expect(body).not.toHaveProperty(key);
    expect(body.input.some((entry: { role: string }) => entry.role === 'system')).toBe(false);
    expect(JSON.stringify(body)).not.toContain('test-secret');
  });
  it('adds text.format only after explicit capability opt-in', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(responseJson({}));
    await new OpenAIResponsesProvider({ authMode: 'chatgpt_oauth', getAccessToken: () => 'token', fetch, enableJsonFormat: true }).completeJson({ instructions: 'JSON', userText: 'roti' });
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).text).toEqual({ format: { type: 'json_object' } });
  });
  it.each([[401, 'auth_expired'], [403, 'auth_expired'], [429, 'quota_exhausted'], [500, 'network']])('maps HTTP %s cleanly', async (status, code) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response('secret raw body', { status: status as number }));
    const ai = new OpenAIResponsesProvider({ authMode: 'api_key', getAccessToken: () => 'token', fetch });
    await expect(ai.completeJson({ instructions: 'JSON', userText: 'roti' })).rejects.toMatchObject({ name: 'AIError', code });
  });
  it.each([['disconnected', 'token'], ['api_key', null]] as [AIAuthMode, string | null][])('fails before fetch when not connected', async (authMode, token) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(new OpenAIResponsesProvider({ authMode, getAccessToken: () => token, fetch }).completeJson({ instructions: '', userText: '' })).rejects.toMatchObject({ code: 'not_connected' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([new Error('secret network stack'), new DOMException('secret abort', 'AbortError')])('sanitizes fetch exceptions', async error => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValueOnce(error);
    await expect(new OpenAIResponsesProvider({ authMode: 'api_key', getAccessToken: () => 'token', fetch }).completeJson({ instructions: '', userText: '' })).rejects.toMatchObject({ code: error.name === 'AbortError' ? 'timeout' : 'network' });
  });
  it('times out a request and streaming body, and honors pre-aborted callers', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => new Response(new ReadableStream({ start(controller) {
      init!.signal!.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
    } })));
    const ai = new OpenAIResponsesProvider({ authMode: 'api_key', getAccessToken: () => 'token', fetch, timeoutMs: 5 });
    await expect(ai.completeJson({ instructions: '', userText: '' })).rejects.toMatchObject({ code: 'timeout' });
    const abort = new AbortController(); abort.abort();
    await expect(ai.completeJson({ instructions: '', userText: '', signal: abort.signal })).rejects.toMatchObject({ code: 'timeout' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(['not JSON', '[]', 'null'])('rejects malformed or non-object JSON', async text => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(final(text)));
    await expect(new OpenAIResponsesProvider({ authMode: 'api_key', getAccessToken: () => 'token', fetch }).completeJson({ instructions: '', userText: '' })).rejects.toMatchObject({ code: 'malformed_output' });
  });
  it('rejects unsupported media or vision models without making a request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const ai = new OpenAIResponsesProvider({ authMode: 'api_key', getAccessToken: () => 'token', fetch });
    for (const request of [{ imageDataUrl: 'https://example.com/image.jpg' }, { imageDataUrl: image, model: 'text-only-model' }]) {
      await expect(ai.completeJson({ instructions: '', userText: '', ...request })).rejects.toMatchObject({ code: 'unsupported_media' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('local-grounded drafts against node:sqlite and both compiled packs', () => {
  it('resolves two rotis and one katori dal in one pass, preserves NULL, and writes nothing', async () => {
    const { user, catalog } = await setup();
    const before = await exportBundleV1(user, '2026-11-23T00:00:00Z');
    const writes = await changes(user);
    const ai = provider(extraction([item(), item({ query: 'dal tadka', display_name: 'Dal tadka', amount: 1, unit: 'katori' })], [fatQuestion]));
    const draft = await captureMealDraft({ provider: ai, catalog, text: '2 rotis and 1 katori dal tadka', meal: 'Lunch' });
    expect(ai.completeJson).toHaveBeenCalledOnce();
    expect(ai.completeJson.mock.calls[0]![0].userText).toBe('2 rotis and 1 katori dal tadka');
    expect(draft.items.map(item => item.food.id)).toEqual(['custom-whole-wheat-roti', 'custom-dal-tadka']);
    expect(draft.totals.nutrients?.kcal).toBeCloseTo(397.2);
    expect(draft.totals.nutrients?.protein_g).toBeCloseTo(16.27);
    expect(draft.totals.nutrients?.carbs_g).toBeCloseTo(63.98);
    expect(draft.totals.nutrients?.fat_g).toBeCloseTo(9.42);
    expect(draft.items[1]?.nutrients.fiber_g).toBeNull();
    expect(draft.items[1]?.unknownCount.fiber_g).toBe(1);
    expect(draft.totals.unknownCount.fiber_g).toBe(1);
    expect(draft.items.every(item => item.provenance_kind === 'database' && item.candidates.length > 0 && item.sourceLabel.length > 0)).toBe(true);
    expect(await changes(user)).toBe(writes);
    expect(await exportBundleV1(user, '2026-11-23T00:00:00Z')).toEqual(before);
  });
  it('batches all ambiguous items into exactly one second pass and keeps swap candidates', async () => {
    const { catalog } = await setup();
    const ai = provider(extraction([item({ query: 'rice', amount: 100, unit: 'g' }), item({ query: 'rice', amount: 50, unit: 'g' })]), { selections: [{ item_index: 0, chosen_candidate_index: 1 }, { item_index: 1, chosen_candidate_index: 0 }] });
    const draft = await captureMealDraft({ provider: ai, catalog, text: 'rice with rice', meal: 'Lunch' });
    expect(ai.completeJson).toHaveBeenCalledTimes(2);
    const sent = JSON.parse(ai.completeJson.mock.calls[1]![0].userText);
    expect(sent).toHaveLength(2);
    expect(sent[0].candidates.length).toBeGreaterThan(1);
    expect(sent[0].candidates.length).toBeLessThanOrEqual(6);
    expect(draft.items[0]?.food.id).toBe(draft.items[0]?.candidates[1]?.food.id);
    expect(draft.items[0]?.nutrients).toEqual(calculateNutrition(draft.items[0]!.food, draft.items[0]!.quantity));
  });
  it('uses exact Yours matches with merged personal units directly', async () => {
    const { user, catalog } = await setup();
    await new LibraryRepo(user).upsertCustomFood(food({ id: 'my-roti', name: 'Roti', provenance_kind: 'user', source_pack_id: null }));
    await new LibraryRepo(user).upsertUserFoodUnit('my-roti', { label: 'my roti', grams: 55, ml: null });
    const ai = provider(extraction([item({ unit: 'my roti' })]));
    const draft = await captureMealDraft({ provider: ai, catalog, text: 'two of my rotis', meal: 'Lunch' });
    expect(ai.completeJson).toHaveBeenCalledOnce();
    expect(draft.items[0]).toMatchObject({ sourceLabel: 'Yours', provenance_kind: 'user', quantity: { amount: 2, unit: 'my roti' }, nutrients: { kcal: 143 } });
  });
  it('merges personal units on a database match before deterministic calculation', async () => {
    const { user, catalog } = await setup();
    await new LibraryRepo(user).upsertUserFoodUnit('custom-home-pack:custom-dal-tadka', { label: '1 katori', grams: 180, ml: null });
    const ai = provider(extraction([item({ query: 'dal tadka', amount: 1, unit: 'katori' })]));
    const draft = await captureMealDraft({ provider: ai, catalog, text: 'one katori dal', meal: 'Lunch' });
    expect(draft.items[0]?.nutrients.kcal).toBeCloseTo(223.2);
    expect(draft.items[0]?.portion_certainty).toBe('stated');
  });
  it('preserves missing-ingredient counts for a personal recipe with a known fiber subtotal', async () => {
    const { user, catalog } = await setup();
    const roti = (await catalog.search('roti')).database[0]!.food;
    const dal = (await catalog.search('dal tadka')).database[0]!.food;
    await new LibraryRepo(user).upsertRecipe({ id: generateId(), name: 'My lunch', version: 1,
      ingredients: [{ food: roti, quantity: { amount: 100, unit: 'g' } }, { food: dal, quantity: { amount: 100, unit: 'g' } }],
      cooked_weight_g: 200, servings_count: 1, notes: null });
    const writes = await changes(user);
    const ai = provider(extraction([item({ query: 'My lunch', amount: 1, unit: 'serving' })]));
    const draft = await captureMealDraft({ provider: ai, catalog, text: 'my lunch', meal: 'Lunch' });
    expect(draft.items[0]?.nutrients.fiber_g).toBe(roti.nutrients.fiber_g);
    expect(draft.items[0]?.unknownCount.fiber_g).toBe(1);
    expect(draft.totals.unknownCount.fiber_g).toBe(1);
    expect(ai.completeJson).toHaveBeenCalledOnce();
    expect(await changes(user)).toBe(writes);
  });
  it.each([false, true])('marks an unmatched or explicitly rejected item as AI estimate (%s)', async rejectLocal => {
    const { catalog } = await setup();
    const input = item({ query: rejectLocal ? 'rice' : 'xenofruit', amount: 125, unit: 'g' });
    const ai = rejectLocal ? provider(extraction([input]), { selections: [{ item_index: 0, chosen_candidate_index: null }] }) : provider(extraction([input]));
    const draft = await captureMealDraft({ provider: ai, catalog, text: 'an exotic meal', meal: 'Dinner' });
    expect(draft.items[0]).toMatchObject({ provenance_kind: 'ai_estimate', sourceLabel: 'AI estimate', food: { source_pack_id: null, source_id: null, source_version: null }, nutrients: { kcal: 250, fiber_g: null } });
    expect(draft.items[0]?.food.provenance_kind).toBe('ai_estimate');
  });
  it('calculates calorie ranges from local nutrients and states unsupported-unit assumptions', async () => {
    const { catalog } = await setup();
    const ai = provider(extraction([item({ query: 'dal tadka', unit: 'mysterious bucket', estimate_range: { min_g: 100, max_g: 200 } })]));
    const draft = await captureMealDraft({ provider: ai, catalog, text: 'some dal', meal: 'Lunch' });
    expect(draft.items[0]).toMatchObject({ quantity: { amount: 1, unit: 'serving' }, portion_certainty: 'estimated', nutrients: { kcal: 186 }, estimate_range: { min_g: 100, max_g: 200, min_kcal: 124, max_kcal: 248 } });
    expect(draft.items[0]?.assumption_note).toContain('no food-specific conversion');
  });
  it('adds local Ghee with zero AI calls, and repeating or switching the chip does not compound', async () => {
    const { user, catalog } = await setup();
    const ai = provider(extraction([item()], [fatQuestion]));
    const original = await captureMealDraft({ provider: ai, catalog, text: 'two rotis', meal: 'Lunch' });
    const writes = await changes(user);
    const amended = await applyClarifyingAnswer(original, 'fat', 'ghee', catalog);
    expect(amended.items).toHaveLength(2);
    expect(amended.items[1]).toMatchObject({ food: { id: 'usda-ghee' }, quantity: { amount: 1, unit: '1 tsp' }, nutrients: { kcal: 37.668 } });
    expect(amended.totals.nutrients?.kcal).toBeCloseTo(248.868);
    expect(await applyClarifyingAnswer(amended, 'fat', 'ghee', catalog)).toEqual(amended);
    const removed = await applyClarifyingAnswer(amended, 'fat', 'none', catalog);
    expect(removed.items).toEqual(original.items);
    expect(original.items).toHaveLength(1);
    expect(ai.completeJson).toHaveBeenCalledOnce();
    expect(await changes(user)).toBe(writes);
  });
  it('scales quantities and ranges locally, without mutating the original draft', async () => {
    const { catalog } = await setup();
    const ai = provider(extraction([item({ amount: 100, unit: 'g', estimate_range: { min_g: 80, max_g: 120 } })], [{
      id: 'portion', topic: 'portion', label: 'Portion', options: [{ id: 'half', label: 'Half', effect: { kind: 'scale_item', targetItemIndex: 0, multiplier: 0.5 } }],
    }]));
    const original = await captureMealDraft({ provider: ai, catalog, text: 'roti', meal: 'Lunch' });
    const draft = await applyClarifyingAnswer(original, 'portion', 'half', catalog);
    expect(draft.items[0]).toMatchObject({ quantity: { amount: 50 }, nutrients: { kcal: 132 }, estimate_range: { min_g: 40, max_g: 60, min_kcal: 105.60000000000001, max_kcal: 158.4 } });
    expect(original.items[0]?.quantity.amount).toBe(100);
    expect(ai.completeJson).toHaveBeenCalledOnce();
  });
  it('changes preparation by selecting real source nutrition rather than relabelling it', async () => {
    const { catalog } = await setup();
    const ai = provider(extraction([item({ query: 'cooked basmati rice', amount: 100, unit: 'g' })], [{
      id: 'prep', topic: 'prep_state', label: 'Preparation', options: [{ id: 'raw', label: 'Raw weight', effect: { kind: 'set_prep_state', targetItemIndex: 0, prep_state: 'raw' } }],
    }]));
    const original = await captureMealDraft({ provider: ai, catalog, text: 'rice', meal: 'Lunch' });
    const draft = await applyClarifyingAnswer(original, 'prep', 'raw', catalog);
    expect(original.items[0]?.nutrients.kcal).toBe(130);
    expect(draft.items[0]).toMatchObject({ food: { id: 'usda-basmati-rice-raw', prep_state: 'raw' }, nutrients: { kcal: 349 } });
    expect(ai.completeJson).toHaveBeenCalledOnce();
  });
  it.each(['timeout', 'quota_exhausted', 'refusal', 'malformed_output'] as const)('keeps storage unchanged on %s', async code => {
    const { user, catalog } = await setup();
    const writes = await changes(user);
    const ai = provider();
    if (code === 'malformed_output') ai.completeJson.mockResolvedValueOnce({ items: 'bad shape' });
    else ai.completeJson.mockRejectedValueOnce(new AIError(code));
    await expect(captureMealDraft({ provider: ai, catalog, text: 'some meal', meal: 'Lunch' })).rejects.toMatchObject({ name: 'AIError', code });
    expect(await changes(user)).toBe(writes);
  });
  it.each([
    { selections: [] }, { selections: [{ item_index: 0, chosen_candidate_index: 99 }] },
    { selections: [{ item_index: 9, chosen_candidate_index: 0 }] },
    { selections: [{ item_index: 0, chosen_candidate_index: 0 }, { item_index: 0, chosen_candidate_index: 1 }] },
  ])('rejects invalid pass-two selections without writes', async selections => {
    const { user, catalog } = await setup(); const writes = await changes(user);
    await expect(captureMealDraft({ provider: provider(extraction([item({ query: 'rice' })]), selections), catalog, text: 'rice', meal: 'Lunch' })).rejects.toMatchObject({ code: 'malformed_output' });
    expect(await changes(user)).toBe(writes);
  });
  it('does not invent zero nutrition when an unmatched item lacks fallback values', async () => {
    const { catalog } = await setup();
    await expect(captureMealDraft({ provider: provider(extraction([item({ query: 'xenofruit', estimated_fallback_per_100g: null })])), catalog, text: 'xenofruit', meal: 'Lunch' })).rejects.toMatchObject({ code: 'malformed_output' });
  });
  it('maps model quantities that overflow deterministic calculations to a clean error', async () => {
    const { user, catalog } = await setup(); const writes = await changes(user);
    const ai = provider(extraction([item({ amount: Number.MAX_VALUE, unit: 'g' })]));
    await expect(captureMealDraft({ provider: ai, catalog, text: 'roti', meal: 'Lunch' })).rejects.toMatchObject({ name: 'AIError', code: 'malformed_output' });
    expect(await changes(user)).toBe(writes);
  });
});

describe('label extraction, validation, search heuristic and PKCE', () => {
  it('transcribes one label in one call and preserves null versus zero', async () => {
    const label = { name: 'Example', brand: null, basis: 'per_100ml', serving_g: null, serving_ml: 250,
      kcal: 60, protein_g: 3, carbs_g: 5, fat_g: 3, fiber_g: null, sugar_g: 0, sat_fat_g: null, sodium_mg: 0 };
    const ai = provider(label);
    expect(await extractNutritionLabel({ provider: ai, imageDataUrl: image })).toEqual(label);
    expect(ai.completeJson).toHaveBeenCalledOnce();
    expect(ai.completeJson.mock.calls[0]![0].imageDataUrl).toBe(image);
  });
  it('rejects label omissions instead of coercing missing values to zero', async () => {
    await expect(extractNutritionLabel({ provider: provider({ kcal: 60 }), imageDataUrl: image })).rejects.toMatchObject({ code: 'malformed_output' });
  });
  it('limits clarifications to two and rejects incomplete effects or invalid indices', () => {
    expect(mealExtractionSchema.safeParse(extraction([item()], [fatQuestion, { ...fatQuestion, id: 'fat2' }, { ...fatQuestion, id: 'fat3' }])).success).toBe(false);
    expect(mealExtractionSchema.safeParse(extraction([item()], [{ ...fatQuestion, options: [{ id: 'x', label: 'x', effect: { kind: 'scale_item', targetItemIndex: 10, multiplier: 2 } }] }])).success).toBe(false);
    expect(mealExtractionSchema.safeParse(extraction([item()], [{ ...fatQuestion, options: [{ id: 'x', label: 'x', effect: { kind: 'add_food' } }] }])).success).toBe(false);
  });
  it.each([['dal', false], ['dal tadka', false], ['2 rotis and 1 katori dal', true], ['rice, dal', true], ['rice with ghee', true], ['2 rotis 1 dal', true]])('classifies %s deterministically', (text, expected) => {
    expect(looksLikeMultiFoodCapture(text as string)).toBe(expected);
  });
  it('exposes vision model metadata and the requested default', () => {
    expect(DEFAULT_AI_MODEL).toBe('gpt-5-mini');
    expect(AI_MODEL_OPTIONS.map(model => model.id)).toEqual(['gpt-5-mini', 'gpt-5']);
    expect(AI_MODEL_OPTIONS.every(model => model.supportsVision)).toBe(true);
  });
  it('generates cryptographically random PKCE S256 and a 127.0.0.1 authorization URL', async () => {
    const pair = await generatePkcePair(); const other = await generatePkcePair();
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.codeChallenge).toBe(createHash('sha256').update(pair.codeVerifier).digest('base64url'));
    expect(pair.state).not.toBe(other.state); expect(pair.codeVerifier).not.toBe(other.codeVerifier);
    const url = new URL(buildAuthorizationUrl({ clientId: 'registered-client', port: 49152, ...pair }));
    expect(url.origin).toBe('https://auth.openai.com');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:49152/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(pair.state);
    expect(url.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
    expect(url.toString()).not.toContain(pair.codeVerifier);
  });
  it('exchanges a code with PKCE and validates state before contacting the token endpoint', async () => {
    const pair = await generatePkcePair();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ access_token: 'test-token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh' }));
    const options = { clientId: 'registered-client', port: 49152, code: 'test-code', codeVerifier: pair.codeVerifier, state: pair.state, expectedState: pair.state, fetch };
    expect(await exchangeAuthorizationCode(options)).toMatchObject({ access_token: 'test-token' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://auth.openai.com/oauth/token');
    const body = new URLSearchParams(init!.body as string);
    expect(body.get('code_verifier')).toBe(pair.codeVerifier);
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:49152/callback');
    expect(body.has('client_secret')).toBe(false);
    await expect(exchangeAuthorizationCode({ ...options, state: 'forged-state' })).rejects.toMatchObject({ code: 'auth_expired' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([0, -1, 65536, 1.5])('rejects invalid loopback port %s', port => { expect(() => loopbackRedirectUri(port)).toThrow('Invalid loopback port'); });
  it('clearly surfaces the native listener requirement', async () => {
    await expect(unavailableLoopbackAuthPort.listen({ host: '127.0.0.1', path: '/callback', expectedState: 'state' })).rejects.toThrow('Loopback listener requires mobile dev build');
  });
});
