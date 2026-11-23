/** GS1 modulo-10 check digit, applied to the unpadded data digits. */
export function checkDigit(data: string): string {
  if (!/^\d+$/.test(data)) throw new Error('GTIN data must contain only digits');
  let sum = 0;
  for (let i = data.length - 1, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(data[i]) * weight;
  }
  return String((10 - sum % 10) % 10);
}

export function expandUpce(code: string): string {
  if (!/^[01]\d{7}$/.test(code)) {
    throw new Error('UPC-E requires 8 digits: number system 0/1, six data digits, check digit');
  }
  const [ns, a, b, c, d, e, last, check] = code.split('') as string[];
  let body: string;
  if ('012'.includes(last!)) body = `${ns}${a}${b}${last}0000${c}${d}${e}`;
  else if (last === '3') body = `${ns}${a}${b}${c}00000${d}${e}`;
  else if (last === '4') body = `${ns}${a}${b}${c}${d}00000${e}`;
  else body = `${ns}${a}${b}${c}${d}${e}0000${last}`;
  return body + check;
}

/** Unknown non-GTIN symbologies retain raw lookup, with NULL gtin14. */
export function normalizeGtin14(rawCode: string, symbology: string): string | null {
  const kind = symbology.toUpperCase().replace(/[-_\s]/g, '');
  const lengths: Record<string, number> = {
    UPCE: 8, UPCA: 12, EAN8: 8, EAN13: 13, GTIN8: 8, GTIN12: 12,
    GTIN13: 13, GTIN14: 14, ITF14: 14,
  };
  let code = rawCode;
  if (kind === 'GS1128' || kind === 'GS1DATAMATRIX' || kind === 'GS1QR') {
    // Explicit AI (01), or scanner symbology identifier + AI 01. Do not
    // guess a GTIN from an arbitrary Code 128 / QR payload.
    const match = /^(?:\(01\)(\d{14})(?=\(|$)|(?:\]C1|\]d2|\]Q3)?01(\d{14}))/.exec(code);
    if (!match) throw new Error(`Missing GS1 application identifier (01): ${rawCode}`);
    code = match[1] ?? match[2]!;
  } else {
    const length = lengths[kind];
    if (length === undefined) return null;
    if (!new RegExp(`^\\d{${length}}$`).test(code)) {
      throw new Error(`${symbology} requires ${length} digits (keep leading zeros)`);
    }
    if (kind === 'UPCE') code = expandUpce(code);
  }
  if (checkDigit(code.slice(0, -1)) !== code.at(-1)) {
    throw new Error(`Invalid ${symbology} check digit: ${rawCode}`);
  }
  return code.padStart(14, '0');
}
