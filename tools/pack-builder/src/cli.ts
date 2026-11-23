#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { buildPack, csvDataset, jsonDataset, readMeta, usdaDataset, validatePack } from './index.ts';

const help = `oct-pack-build (Node.js 24+; offline)

Build:
  oct-pack-build --format json --input foods.json --output custom.octpack.sqlite [--meta meta.json] [--force]
  oct-pack-build --format csv --input foods.csv --meta meta.json --output custom.octpack.sqlite [--force]
  oct-pack-build --format usda-fdc --input ./fdc-csv --output usda.octpack.sqlite [--meta meta.json] [--force]
Validate:
  oct-pack-build --validate custom.octpack.sqlite

Reports are JSON on stdout; warnings and errors go to stderr. Invalid packs exit 1.
Existing output requires --force. USDA metadata always retains CC0 and USDA attribution.
See README.md for the custom JSON/CSV schema.
`;

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    format: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' },
    meta: { type: 'string' }, validate: { type: 'string' }, force: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(help); return; }
  if (values.validate) {
    if (values.format || values.input || values.output || values.meta || values.force) throw new Error('--validate cannot be combined with build arguments');
    const report = validatePack(values.validate);
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
    return;
  }
  if (!values.input || !values.output || !values.format) throw new Error('Build requires --format, --input and --output (use --help)');
  const meta = values.meta ? await readMeta(values.meta) : undefined;
  let dataset;
  switch (values.format) {
    case 'json': dataset = await jsonDataset(values.input, meta); break;
    case 'csv':
      if (!meta) throw new Error('CSV input requires --meta');
      dataset = csvDataset(values.input, meta); break;
    case 'usda-fdc': dataset = usdaDataset(values.input, meta); break;
    default: throw new Error(`Unsupported input format: ${values.format}`);
  }
  const result = await buildPack(dataset, values.output, { overwrite: values.force });
  for (const warning of result.warnings) console.error(`Warning: ${warning}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((cause: unknown) => {
  console.error(`oct-pack-build: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = 1;
});
