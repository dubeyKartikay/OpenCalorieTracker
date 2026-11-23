import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  buildPack, jsonDataset, csvDataset, usdaDataset, validatePack, readMeta,
  checkDigit, expandUpce, normalizeGtin14, parseCsv, readCsv, detectPrepState,
} from '../src/index.ts';
import type { Dataset, FoodInput } from '../src/index.ts';

const data = fileURLToPath(new URL('./testdata/', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const connections = new WeakMap<TestContext, DatabaseSync[]>();
function directory(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), 'oct-pack-builder-test-'));
  t.after(() => {
    for (const db of connections.get(t) ?? []) db.close();
    connections.delete(t);
    rmSync(path, { recursive: true, force: true });
  });
  return path;
}
async function customPack(t: TestContext) {
  const path = join(directory(t), 'custom.octpack.sqlite');
  const result = await buildPack(await jsonDataset(join(data, 'custom.json')), path);
  return { path, result };
}
function readonly(path: string, t: TestContext): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true });
  connections.set(t, [...connections.get(t) ?? [], db]);
  return db;
}

test('JSON pack supports FTS transliteration/diacritics, NULLs, source energy and distinct GTINs', async t => {
  const { path, result } = await customPack(t);
  const db = readonly(path, t);
  assert.equal(result.report.valid, true);
  assert.equal(result.report.counts.foods, 2);
  for (const query of ['cafe', 'creme', 'kaafi', 'कॉफ़ी']) {
    assert.equal(db.prepare('SELECT food_id FROM foods_fts WHERE foods_fts MATCH ?').get(query)?.food_id, 'coffee');
  }
  const coffee = db.prepare("SELECT * FROM foods WHERE id='coffee'").get()!;
  assert.equal(coffee.kcal, 37); // 4P + 4C + 9F would be 39.
  assert.equal(coffee.fiber_g, null);
  assert.equal(coffee.sodium_mg, null);
  assert.equal(db.prepare("SELECT fiber_g FROM foods WHERE id='water'").get()?.fiber_g, 0);
  assert.equal(db.prepare("SELECT food_id FROM food_barcodes WHERE gtin14='00012345000065'").get()?.food_id, 'coffee');
  assert.equal(db.prepare("SELECT food_id FROM food_barcodes WHERE gtin14='00000001234565'").get()?.food_id, 'water');
  assert.equal(db.prepare("SELECT count(*) n FROM food_barcodes WHERE raw_code='01234565'").get()?.n, 2);
  assert.deepEqual(result.report.coverage.fiber_g, { known: 1, missing: 1, zero: 1, percent: 50 });
  assert.equal(db.prepare('SELECT ml,grams FROM food_units').get()?.ml, 150);
  assert.equal(db.prepare('SELECT ml,grams FROM food_units').get()?.grams, null);
  assert.equal(db.prepare('PRAGMA journal_mode').get()?.journal_mode, 'delete');
  assert.ok(db.prepare("SELECT name FROM sqlite_schema WHERE name='sqlite_stat1'").get());
  assert.deepEqual(readdirSync(join(path, '..')), ['custom.octpack.sqlite']);
});

test('CSV custom adapter preserves blank versus explicit zero and nested units/aliases', async t => {
  const path = join(directory(t), 'csv.octpack.sqlite');
  await buildPack(csvDataset(join(data, 'custom.csv'), await readMeta(join(data, 'meta.json'))), path);
  const db = readonly(path, t);
  assert.equal(db.prepare("SELECT fiber_g FROM foods WHERE id='tea'").get()?.fiber_g, null);
  assert.equal(db.prepare("SELECT fiber_g FROM foods WHERE id='water'").get()?.fiber_g, 0);
  assert.equal(db.prepare("SELECT food_id FROM foods_fts WHERE foods_fts MATCH 'chai'").get()?.food_id, 'tea');
  assert.equal(db.prepare('SELECT ml FROM food_units').get()?.ml, 150);
});

test('validator FTS probe respects decomposed accents, non-Latin names and quoted punctuation', async t => {
  const dataset = await jsonDataset(join(data, 'custom.json'));
  const source = (dataset.foods as FoodInput[])[0]!;
  const path = join(directory(t), 'unicode.octpack.sqlite');
  await buildPack({ ...dataset, foods: [
    { ...source, id: 'decomposed', name: 'Cafe\u0301 au lait' },
    { ...source, id: 'devanagari', name: 'दाल' },
    { ...source, id: 'quoted', name: 'A "special" food' },
  ] }, path);
  assert.equal(validatePack(path).valid, true);
  assert.equal(readonly(path, t).prepare("SELECT food_id FROM foods_fts WHERE foods_fts MATCH 'cafe'").get()?.food_id, 'decomposed');
});

test('USDA adapter joins official IDs, source energy precedence, portions and CC0 metadata', async t => {
  const path = join(directory(t), 'usda.octpack.sqlite');
  const result = await buildPack(usdaDataset(join(data, 'usda')), path);
  const db = readonly(path, t);
  assert.equal(result.report.counts.foods, 4);
  assert.equal(result.report.counts.food_units, 3);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0]!, /1 USDA foods/);
  const raw = db.prepare("SELECT * FROM foods WHERE id='fdc:100'").get()!;
  assert.equal(raw.kcal, 352);
  assert.equal(raw.protein_g, 24.63);
  assert.equal(raw.carbs_g, 63.35);
  assert.equal(raw.fat_g, 1.06);
  assert.equal(raw.fiber_g, 10.7);
  assert.equal(raw.sugar_g, 2.03);
  assert.equal(raw.sat_fat_g, 0.154);
  assert.equal(raw.sodium_mg, 6);
  assert.equal(raw.calcium_mg, 35);
  assert.equal(raw.iron_mg, 6.51);
  assert.equal(raw.potassium_mg, 677);
  assert.equal(raw.prep_state, 'raw');
  assert.equal(raw.basis, 'per_100g');
  const cooked = db.prepare("SELECT * FROM foods WHERE id='fdc:101'").get()!;
  assert.equal(cooked.kcal, 130);
  assert.equal(cooked.fiber_g, null);
  assert.equal(cooked.sodium_mg, 0);
  assert.equal(cooked.prep_state, 'cooked');
  assert.equal(db.prepare("SELECT kcal FROM foods WHERE id='fdc:102'").get()?.kcal, 111);
  assert.equal(db.prepare("SELECT kcal FROM foods WHERE id='fdc:105'").get()?.kcal, 0);
  assert.equal(db.prepare("SELECT fiber_g FROM foods WHERE id='fdc:105'").get()?.fiber_g, 0);
  assert.equal(db.prepare("SELECT iron_mg FROM foods WHERE id='fdc:105'").get()?.iron_mg, null);
  assert.equal(db.prepare("SELECT label FROM food_units WHERE food_id='fdc:100'").get()?.label, '1 cup dry');
  const unit = db.prepare("SELECT * FROM food_units WHERE food_id='fdc:101'").get()!;
  assert.equal(unit.label, '2 tablespoons');
  assert.equal(unit.grams, 30); // Weight belongs to the full label; never divide by amount.
  assert.equal(unit.ml, null);
  assert.equal(db.prepare('SELECT license FROM pack_meta').get()?.license, 'CC0-1.0');
  assert.match(String(db.prepare('SELECT attribution_text FROM pack_meta').get()?.attribution_text), /Agriculture/);
});

test('GTIN check digits, UPC-A/EAN/GTIN-14, UPC-E expansion and GS1 AI (01)', () => {
  assert.equal(checkDigit('03600029145'), '2');
  assert.equal(normalizeGtin14('036000291452', 'UPC_A'), '00036000291452');
  assert.equal(normalizeGtin14('4006381333931', 'EAN-13'), '04006381333931');
  assert.equal(normalizeGtin14('96385074', 'EAN8'), '00000096385074');
  assert.equal(normalizeGtin14('04252614', 'UPC-E'), '00042100005264');
  assert.equal(normalizeGtin14('00036000291452', 'GTIN-14'), '00036000291452');
  assert.equal(normalizeGtin14('(01)00036000291452(17)271231', 'GS1-128'), '00036000291452');
  assert.equal(normalizeGtin14(']d2010003600029145217271231', 'GS1 DataMatrix'), '00036000291452');
  assert.equal(normalizeGtin14('local-code', 'CODE-128'), null);
  assert.throws(() => normalizeGtin14('036000291453', 'UPC-A'), /check digit/);
  assert.throws(() => normalizeGtin14('01234566', 'EAN-8'), /check digit/);
  assert.throws(() => normalizeGtin14('425261', 'UPC-E'), /8 digits/);
  assert.throws(() => normalizeGtin14('1234', 'GS1-128'), /identifier/);
  // Exercise all zero suppression forms independently of check digit validation.
  assert.equal(expandUpce('01234500'), '012000003450');
  assert.equal(expandUpce('01234510'), '012100003450');
  assert.equal(expandUpce('01234520'), '012200003450');
  assert.equal(expandUpce('01234530'), '012300000450');
  assert.equal(expandUpce('01234540'), '012340000050');
  assert.equal(expandUpce('11234590'), '112345000090');
});

test('CSV parser handles BOM, escaped quotes, embedded CRLF and chunk boundaries', async () => {
  async function* chunks() { for (const char of '\uFEFFa,b\r\n"hello,""world""","line1\r\nline2"\r\n') yield char; }
  const rows = [];
  for await (const row of parseCsv(chunks())) rows.push(row);
  assert.deepEqual(rows, [['a', 'b'], ['hello,"world"', 'line1\r\nline2']]);
  for (const malformed of ['a,"unfinished', 'a,"closed"bad', 'a,un"quoted']) {
    await assert.rejects(async () => { for await (const _ of parseCsv((async function* () { yield malformed; })())) {} }, /Malformed CSV/);
  }
});

test('malformed CSV headers, widths, numeric data and unknown columns fail', async t => {
  const folder = directory(t);
  const path = join(folder, 'bad.csv');
  for (const content of ['', 'id,id\n1,2', 'id,name\n1', 'name\nthing']) {
    writeFileSync(path, content);
    await assert.rejects(async () => { for await (const _ of readCsv(path, ['id'])) {} });
  }
  const meta = await readMeta(join(data, 'meta.json'));
  for (const content of [
    'id,name,prep_state,basis,kcal,protein_g,carbs_g,fat_g\na,A,raw,per_100g,,0,0,0',
    'id,name,prep_state,basis,kcal,protein_g,carbs_g,fat_g\na,A,raw,per_100g,0x10,0,0,0',
    'id,name,prep_state,basis,kcal,protein_g,carbs_g,fat_g,typo\na,A,raw,per_100g,1,0,0,0,x',
  ]) {
    writeFileSync(path, content);
    await assert.rejects(buildPack(csvDataset(path, meta), join(folder, 'bad.octpack.sqlite')));
  }
});

test('malformed custom data fails atomically, including invalid optional values and barcodes', async t => {
  const folder = directory(t);
  const original = await jsonDataset(join(data, 'custom.json'));
  const food = (original.foods as FoodInput[])[0]!;
  const cases: unknown[] = [
    { ...food, kcal: -1 }, { ...food, protein_g: undefined }, { ...food, fiber_g: -1 },
    { ...food, fiber_g: NaN }, { ...food, fiber_g: '' }, { ...food, iron_mg: Infinity },
    { ...food, units: [{ label: 'cup' }] }, { ...food, units: [{ label: 'cup', grams: 0 }] },
    { ...food, barcodes: [{ raw_code: '01234566', symbology: 'EAN-8' }] },
    { ...food, basis: 'per_g' }, { ...food, typo: 3 },
  ];
  for (const input of cases) {
    await assert.rejects(buildPack({ ...original, foods: [input as FoodInput] }, join(folder, 'bad.octpack.sqlite')));
    assert.deepEqual(readdirSync(folder), []);
  }
  await assert.rejects(buildPack({ ...original, foods: [food, food] }, join(folder, 'duplicate.octpack.sqlite')), /UNIQUE/);
  await assert.rejects(buildPack({ ...original, foods: [] }, join(folder, 'empty.octpack.sqlite')), /empty/);
  await assert.rejects(buildPack({ ...original, meta: { ...original.meta, license: '' } }, join(folder, 'meta.octpack.sqlite')));
});

test('failed overwrite preserves existing pack and explicit force replaces it', async t => {
  const { path } = await customPack(t);
  const original = readFileSync(path);
  const dataset = await jsonDataset(join(data, 'custom.json'));
  await assert.rejects(buildPack(dataset, path), /already exists/);
  await assert.rejects(buildPack({ ...dataset, foods: [] }, path, { overwrite: true }), /empty/);
  assert.deepEqual(readFileSync(path), original);
  await buildPack({ ...dataset, meta: { ...dataset.meta, version: '2' } }, path, { overwrite: true });
  assert.equal(readonly(path, t).prepare('SELECT version FROM pack_meta').get()?.version, '2');
});

test('validator catches corrupted data, missing indexes, stale FTS, references and versions', async t => {
  const { path } = await customPack(t);
  const folder = directory(t);
  const mutations: Array<[string, RegExp]> = [
    ["UPDATE foods SET kcal=-1 WHERE id='coffee'", /Invalid food/],
    ["UPDATE foods SET fiber_g='unknown' WHERE id='coffee'", /Invalid food/],
    ['UPDATE pack_meta SET schema_version=2', /schema_version/],
    ['UPDATE pack_meta SET food_count=100', /food_count/],
    ["UPDATE pack_meta SET license=''", /pack_meta/],
    ['DROP INDEX food_barcodes_gtin14', /Missing complete index/],
    ['DROP INDEX food_aliases_lower_alias', /Missing complete index/],
    ["UPDATE food_barcodes SET gtin14='00000000000000'", /Invalid barcode/],
    ["UPDATE food_units SET grams=-1", /Invalid unit/],
    ["UPDATE food_aliases SET food_id='missing'", /foreign key/],
    ["UPDATE foods_fts SET name='different' WHERE food_id='coffee'", /FTS content/],
    ["DELETE FROM foods_fts WHERE food_id='coffee'", /FTS row count/],
    ["INSERT INTO foods_fts SELECT * FROM foods_fts LIMIT 1", /Duplicate food_id/],
    ['DROP TABLE foods', /Schema mismatch/],
  ];
  for (const [sql, expected] of mutations) {
    const modified = join(folder, 'modified.octpack.sqlite');
    copyFileSync(path, modified);
    const db = new DatabaseSync(modified);
    try { db.exec('PRAGMA foreign_keys=OFF'); db.exec(sql); } finally { db.close(); }
    const report = validatePack(modified);
    assert.equal(report.valid, false, sql);
    assert.match(report.errors.join(';'), expected, sql);
  }
});

test('validator opens read-only, reports size and gracefully rejects non-SQLite or missing files', async t => {
  const { path } = await customPack(t);
  const before = readFileSync(path);
  assert.equal(validatePack(path).file_size_bytes, before.length);
  assert.deepEqual(readFileSync(path), before);
  const bad = join(directory(t), 'bad.octpack.sqlite');
  writeFileSync(bad, 'not a database');
  assert.equal(validatePack(bad).valid, false);
  assert.equal(validatePack(bad + '.missing').valid, false);
});

test('USDA rejects missing input files, conflicting source nutrients, and preserves required zero', async t => {
  const folder = directory(t);
  for (const file of ['food.csv', 'food_nutrient.csv', 'food_portion.csv', 'measure_unit.csv']) copyFileSync(join(data, 'usda', file), join(folder, file));
  writeFileSync(join(folder, 'food_nutrient.csv'), readFileSync(join(folder, 'food_nutrient.csv'), 'utf8') + '\n1000,100,1008,999\n');
  await assert.rejects(buildPack(usdaDataset(folder), join(folder, 'conflict.octpack.sqlite')), /Conflicting USDA nutrient/);
  await assert.rejects(buildPack(usdaDataset(join(folder, 'missing')), join(folder, 'missing.octpack.sqlite')), /ENOENT/);
  assert.equal(detectPrepState('Uncooked rice'), 'raw');
  assert.equal(detectPrepState('roasted beans'), 'cooked');
  assert.equal(detectPrepState('ready-to-eat soup'), 'prepared');
  assert.equal(detectPrepState('dried spice'), 'unknown');
});

test('CLI builds, validates and uses meaningful failure exit codes', t => {
  const folder = directory(t);
  const output = join(folder, 'cli.octpack.sqlite');
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const built = run('--format', 'json', '--input', join(data, 'custom.json'), '--output', output);
  assert.equal(built.status, 0, built.stderr);
  assert.equal(JSON.parse(built.stdout).report.valid, true);
  const validated = run('--validate', output);
  assert.equal(validated.status, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).counts.foods, 2);
  assert.equal(run('--format', 'json', '--input', join(data, 'custom.json'), '--output', output).status, 1);
  assert.equal(run('--format', 'json', '--input', join(data, 'custom.json'), '--output', output, '--force').status, 0);
  assert.equal(run('--validate', join(folder, 'missing.octpack.sqlite')).status, 1);
  assert.equal(run('--validate', output, '--force').status, 1);
  assert.equal(run('--format', 'bad', '--input', 'x', '--output', output).status, 1);
  assert.equal(run('--format', 'csv', '--input', join(data, 'custom.csv'), '--output', output).status, 1);
  assert.match(run('--help').stdout, /oct-pack-build/);
});

test('JSON array requires metadata, and duplicate/unknown document fields fail', async t => {
  const folder = directory(t);
  const path = join(folder, 'foods.json');
  const dataset = await jsonDataset(join(data, 'custom.json'));
  writeFileSync(path, JSON.stringify(dataset.foods));
  await assert.rejects(jsonDataset(path), /requires --meta/);
  const arrayDataset: Dataset = await jsonDataset(path, dataset.meta);
  await buildPack(arrayDataset, join(folder, 'array.octpack.sqlite'));
  writeFileSync(path, JSON.stringify({ pack_meta: dataset.meta, foods: [], typo: true }));
  await assert.rejects(jsonDataset(path));
});
