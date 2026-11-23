import { describe, expect, it } from 'vitest';
import { BarcodeError, calculateGtinCheckDigit, normalizeBarcode } from '../barcode';

describe('barcodes', () => {
  it.each([
    ['036000291452', 'UPC-A', '00036000291452'],
    ['4006381333931', 'EAN-13', '04006381333931'],
    ['96385074', 'EAN-8', '00000096385074'],
    ['10012345000017', 'GTIN-14', '10012345000017'],
    ['04252614', 'UPC-E', '00042100005264'],
    ['01234558', 'UPC-E', '00012345000058'],
  ])('normalizes %s (%s)', (raw, symbology, gtin14) => {
    expect(normalizeBarcode(raw, symbology)).toMatchObject({ rawCode: raw, gtin14 });
  });
  it('distinguishes the same eight digits as UPC-E and EAN-8', () => {
    // Both check digits happen to be valid. Length alone cannot decide the identifier.
    expect(normalizeBarcode('01234558', 'upc_e').gtin14).toBe('00012345000058');
    expect(normalizeBarcode('01234558', 'ean_8').gtin14).toBe('00000001234558');
    expect(() => normalizeBarcode('01234558')).toThrow('ambiguous');
  });
  it.each(['0', '1', '2', '3', '4', '5', '9'])('expands UPC-E suppression branch %s', (last) => {
    const payload = `012345${last}`;
    const full = last === '0' || last === '1' || last === '2' ? `012${last}0000345`
      : last === '3' ? '01230000045' : last === '4' ? '01234000005' : `0123450000${last}`;
    const code = payload + calculateGtinCheckDigit(full);
    expect(normalizeBarcode(code, 'UPC-E').gtin14).toBe((full + calculateGtinCheckDigit(full)).padStart(14, '0'));
  });
  it.each(['(01)10012345000017', '(01)10012345000017(17)271231(10)LOT', '(17)271231(01)10012345000017', ']C1011001234500001710LOT', ']d20110012345000017'])('extracts GS1 AI 01 from %s', (code) => {
    expect(normalizeBarcode(code)).toEqual({ rawCode: code, symbology: 'gs1', gtin14: '10012345000017' });
  });
  it('extracts bare GS1 element strings when symbology is explicit', () => {
    expect(normalizeBarcode('011001234500001710LOT', 'gs1-128').gtin14).toBe('10012345000017');
  });
  it.each(['036000291453', '4006381333932', '(01)10012345000018'])('rejects invalid check digit in %s', (code) => {
    expect(() => normalizeBarcode(code)).toThrow(BarcodeError);
  });
  it.each(['', '123456', '12345x6789012', 'https://example.com/036000291452'])('rejects unsupported data %s', (code) => {
    expect(() => normalizeBarcode(code)).toThrow(BarcodeError);
  });
  it('rejects a length/symbology mismatch and unsupported symbology', () => {
    expect(() => normalizeBarcode('96385074', 'ean13')).toThrow(BarcodeError);
    expect(() => normalizeBarcode('036000291452', 'code39')).toThrow(BarcodeError);
    expect(() => normalizeBarcode('23600024', 'upce')).toThrow(BarcodeError);
    expect(() => normalizeBarcode('(01)10012345000017', 'upca')).toThrow(BarcodeError);
  });
  it('preserves the exact raw input while trimming for validation', () => {
    expect(normalizeBarcode(' 036000291452 ')).toMatchObject({ rawCode: ' 036000291452 ', gtin14: '00036000291452' });
  });
});
