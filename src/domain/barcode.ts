export type BarcodeSymbology = 'upc_a' | 'upc_e' | 'ean_8' | 'ean_13' | 'gtin_14' | 'gs1';
export interface NormalizedBarcode { rawCode: string; symbology: BarcodeSymbology; gtin14: string }
export class BarcodeError extends Error {
  constructor(message: string) { super(message); this.name = 'BarcodeError'; }
}

/** GS1 modulo-10: alternate weights 3 and 1 from the rightmost data digit. */
export function calculateGtinCheckDigit(data: string): string {
  if (!/^\d+$/.test(data)) throw new BarcodeError('GTIN data must contain only digits');
  let sum = 0;
  for (let i = data.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(data[i]) * weight;
  }
  return String((10 - sum % 10) % 10);
}

function validateGtin(code: string): void {
  if (calculateGtinCheckDigit(code.slice(0, -1)) !== code.slice(-1)) throw new BarcodeError('Invalid GTIN check digit');
}

function expandUpce(code: string): string {
  if (!/^[01]\d{7}$/.test(code)) throw new BarcodeError('UPC-E requires a number system (0 or 1), six data digits and check digit');
  const [system, a, b, c, d, e, f, check] = code.split('') as [string, string, string, string, string, string, string, string];
  let data: string;
  if ('012'.includes(f)) data = `${system}${a}${b}${f}0000${c}${d}${e}`;
  else if (f === '3') {
    if ('012'.includes(c)) throw new BarcodeError('Noncanonical UPC-E zero suppression');
    data = `${system}${a}${b}${c}00000${d}${e}`;
  } else if (f === '4') {
    if (d === '0') throw new BarcodeError('Noncanonical UPC-E zero suppression');
    data = `${system}${a}${b}${c}${d}00000${e}`;
  } else {
    if (e === '0') throw new BarcodeError('Noncanonical UPC-E zero suppression');
    data = `${system}${a}${b}${c}${d}${e}0000${f}`;
  }
  const expanded = data + check;
  validateGtin(expanded);
  return expanded;
}

function parseSymbology(symbology: string): BarcodeSymbology {
  const name = symbology.toLowerCase().replace(/[-_\s]/g, '');
  const aliases: Record<string, BarcodeSymbology> = {
    upca: 'upc_a', upce: 'upc_e', ean8: 'ean_8', ean13: 'ean_13', gtin14: 'gtin_14',
    gs1: 'gs1', gs1128: 'gs1', gs1datamatrix: 'gs1', gs1qrcode: 'gs1',
  };
  const result = aliases[name];
  if (!result) throw new BarcodeError(`Unsupported symbology: ${symbology}`);
  return result;
}

/** Eight digits require symbology: UPC-E and EAN-8 are different identifiers. */
export function normalizeBarcode(rawCode: string, symbology?: string): NormalizedBarcode {
  const code = rawCode.trim();
  let kind = symbology === undefined ? undefined : parseSymbology(symbology);
  const parenthesized = /\(01\)(\d{14})(?=\(|$)/.exec(code);
  // AI 01 is fixed-width; accept scanner AIM identifiers and following AI fields.
  const elementString = /^(?:\]C1|\]d2|\]Q3)01(\d{14})/.exec(code)
    ?? (kind === 'gs1' ? /^01(\d{14})(?=\d|\u001d|$)/.exec(code) : null);
  const gs1Gtin = parenthesized?.[1] ?? elementString?.[1];
  if (gs1Gtin !== undefined) {
    if (kind !== undefined && kind !== 'gs1') throw new BarcodeError('Symbology does not match GS1 element string');
    validateGtin(gs1Gtin);
    return { rawCode, symbology: 'gs1', gtin14: gs1Gtin };
  }
  if (!/^\d+$/.test(code)) throw new BarcodeError('Expected GTIN digits or a GS1 AI (01) element');
  if (kind === 'gs1') throw new BarcodeError('GS1 data is missing AI (01)');
  if (kind === undefined) {
    if (code.length === 8) throw new BarcodeError('Eight-digit code is ambiguous; specify UPC-E or EAN-8');
    kind = ({ 12: 'upc_a', 13: 'ean_13', 14: 'gtin_14' } as const)[code.length as 12 | 13 | 14];
  }
  if (kind === undefined) throw new BarcodeError('Unsupported GTIN length');
  const lengths = { upc_a: 12, upc_e: 8, ean_8: 8, ean_13: 13, gtin_14: 14 };
  if (code.length !== lengths[kind]) throw new BarcodeError('GTIN length does not match symbology');
  const gtin = kind === 'upc_e' ? expandUpce(code) : code;
  validateGtin(gtin);
  return { rawCode, symbology: kind, gtin14: gtin.padStart(14, '0') };
}
