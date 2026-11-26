import { kcalToKj, kjToKcal } from '../domain';

const DIGITS = '0123456789';
const BACKSPACE = '⌫';
const DECIMAL = '.';

export const number = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });

/** Group integer digits of an in-progress numeric draft without disturbing a trailing decimal point. */
export function formatDraftNumber(raw: string): string {
  if (raw === '' || raw === '.') return '0';
  const dot = raw.indexOf('.');
  const whole = dot < 0 ? raw : raw.slice(0, dot);
  const fraction = dot < 0 ? '' : raw.slice(dot + 1);
  const grouped = whole === '' ? '0' : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dot < 0 ? grouped : `${grouped}.${fraction}`;
}

export const energyValue = (kcal: number | null | undefined, unit: 'kcal' | 'kJ' = 'kcal') =>
  kcal == null || !Number.isFinite(kcal) ? null : unit === 'kJ' ? kcalToKj(kcal) : kcal;

export const toCanonicalKcal = (value: number, unit: 'kcal' | 'kJ' = 'kcal') =>
  unit === 'kJ' ? kjToKcal(value) : value;

export const energy = (kcal: number | null | undefined, unit: 'kcal' | 'kJ' = 'kcal') =>
  `${number(energyValue(kcal, unit))} ${unit}`;

const parseCalendarDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);

export const formatShortDate = (value: string) =>
  parseCalendarDate(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export const formatWeekdayDate = (value: string) =>
  parseCalendarDate(value).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Pure numeric-entry state machine shared by every keypad surface.
 * Leading zeros collapse (unless `digitString` is true, e.g. barcodes),
 * a second decimal point is ignored, and backspace bottoms out at `0` (or `''` when `allowEmpty`).
 */
export function applyKeypadKey(
  current: string,
  key: string,
  allowDecimal = true,
  allowEmpty = false,
  digitString = false,
): string {
  if (digitString) {
    if (key === BACKSPACE) return current.slice(0, -1);
    if (key.length !== 1 || !DIGITS.includes(key)) return current;
    return `${current}${key}`;
  }

  const base = current.replace(/^0+(?=\d)/, '');

  if (key === BACKSPACE) {
    const trimmed = base.slice(0, -1);
    return trimmed === '' ? (allowEmpty ? '' : '0') : trimmed;
  }

  if (key === DECIMAL) {
    if (!allowDecimal || base.includes(DECIMAL)) return base;
    return base === '' ? '0.' : `${base}.`;
  }

  if (key.length !== 1 || !DIGITS.includes(key)) return base;

  if (base === '' || base === '0') return key;
  return `${base}${key}`;
}

/** Split an ordered list into fixed-size pages for swipe pagination. */
export function paginateList<T>(items: readonly T[], pageSize: number): T[][] {
  if (pageSize <= 0 || items.length === 0) return [];
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += pageSize) {
    pages.push(items.slice(index, index + pageSize));
  }
  return pages;
}
