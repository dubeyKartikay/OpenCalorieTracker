import { nutrientKeys } from '../domain';
import type { NutrientKey } from '../domain';
import type { ParsedNutritionLabel } from './types';

const decimal = '(\\d+(?:[.,]\\d+)?)';
const amountPattern = new RegExp(`${decimal}\\s*(kcal|kj|mg|mcg|µg|g)\\b`, 'gi');
const labels: [NutrientKey, RegExp][] = [
  ['sat_fat_g', /^(?:of which\s+)?(?:saturated(?:\s+fat(?:ty acids)?)?|saturates)\b/i],
  ['fiber_g', /^(?:(?:total|dietary)\s+)?fib(?:er|re)\b/i],
  ['sugar_g', /^(?:of which\s+)?(?:total\s+)?sugars?\b/i],
  ['protein_g', /^proteins?\b/i],
  ['carbs_g', /^(?:total\s+)?carbohydrates?\b/i],
  ['fat_g', /^(?:total\s+)?fat\b/i],
  ['sodium_mg', /^sodium\b/i],
  ['calcium_mg', /^calcium\b/i],
  ['iron_mg', /^iron\b/i],
  ['potassium_mg', /^potassium\b/i],
];
function numeric(value: string): number { return Number(value.replace(',', '.')); }
function milligrams(value: number, unit: string): number { return unit === 'g' ? value * 1000 : unit === 'mg' ? value : value / 1000; }

/** Deterministic text parsing only; unknowns and ambiguous OCR require review. */
export function parseNutritionLabelText(text: string): ParsedNutritionLabel {
  const result: ParsedNutritionLabel = {
    basis: null, serving_g: null, serving_ml: null,
    nutrients: Object.fromEntries(nutrientKeys.map((key) => [key, null])) as ParsedNutritionLabel['nutrients'], warnings: [],
  };
  const normalized = text.replace(/\u00a0/g, ' ').replace(/[−–]/g, '-');
  // Choose the first declared table column, never mix the per-100 and serving columns.
  const bases = [...normalized.matchAll(/\bper\s*(?:100\s*(g|ml)\b|(serving|portion)\b)|\bamount per serving\b/gi)];
  const first = bases[0];
  if (first) result.basis = first[1]?.toLowerCase() === 'g' ? 'per_100g' : first[1]?.toLowerCase() === 'ml' ? 'per_100ml' : 'per_serving';
  if (!result.basis) result.warnings.push('Nutrition basis was not found; select per 100 g, per 100 ml or per serving.');
  const multipleColumns = new Set(bases.map((match) => match[1]?.toLowerCase() ?? 'serving')).size > 1;
  if (multipleColumns) {
    result.warnings.push('Multiple nutrition columns were detected; values use the first declared column. Review before saving.');
  }
  const lines = normalized.split(/[\r\n;]+/).map((line) => line.trim()).filter(Boolean);
  let salt: number | null = null;
  let kj: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    let rawLine = lines[i]!;
    let line = rawLine.replace(/\|/g, ' ').trim();
    if (/\bserving(?:\s+size|\s+weight)?\b|\bportion\s+size\b/i.test(line)) {
      const serving = new RegExp(`${decimal}\\s*(kg|g|ml|cl|l)\\b`, 'i').exec(line.replace(/\bper\s*100\s*(?:g|ml)\b/gi, ''));
      if (serving) {
        const amount = numeric(serving[1]!);
        const unit = serving[2]!.toLowerCase();
        if (amount > 0) {
          if (unit === 'g' || unit === 'kg') result.serving_g = amount * (unit === 'kg' ? 1000 : 1);
          else result.serving_ml = amount * (unit === 'l' ? 1000 : unit === 'cl' ? 10 : 1);
        }
      }
    }
    // OCR sometimes places the value on the next line.
    if (!/\d/.test(line) && /^\d/.test(lines[i + 1] ?? '')) {
      rawLine += ` ${lines[++i]}`;
      line = rawLine.replace(/\|/g, ' ').trim();
    }
    const strippedLine = rawLine.replace(/^\|\s*/, '').replace(/\s*\|$/, '').trim();
    const energyLabel = /^(?:energy(?:\s+value)?|calories)\b/i.exec(strippedLine);
    const identified = labels.find(([, pattern]) => pattern.test(strippedLine));
    const saltLabel = /^salt\b/i.exec(strippedLine);
    const label = energyLabel ?? (identified ? identified[1].exec(strippedLine) : null) ?? saltLabel;
    if (!label) continue;
    const rawTail = strippedLine.slice(label[0].length).trim();
    // Strip one optional column divider immediately after the label (e.g. "| Energy | 200 kcal | 50 kcal |"),
    // then select the first value cell without skipping empty cells (e.g. "Protein || 3 g").
    const valueTail = rawTail.replace(/^\|\s*/, '');
    const firstColumnTail = valueTail.includes('|')
      ? valueTail.split('|')[0]!.trim()
      : valueTail;
    const tail = firstColumnTail.replace(/\|/g, ' ').trim();
    if (/^[:\s]*(?:<|>|≤|≥|-)/.test(tail)) {
      result.warnings.push(`An approximate or invalid amount for ${label[0]} was left unknown.`); continue;
    }
    if (energyLabel) {
      const amounts = [...tail.matchAll(amountPattern)];
      const firstAmount = amounts[0];
      const kcal = amounts.find((match) => match[2]!.toLowerCase() === 'kcal');
      const energyKj = amounts.find((match) => match[2]!.toLowerCase() === 'kj');
      // If multiple columns exist without a pipe separator and the first token is kJ while a later kcal
      // value does not match kJ / 4.184, the kcal belongs to another column — keep only the first column's kJ.
      const kcalMatchesFirstColumn = (() => {
        if (!kcal) return false;
        if (!multipleColumns || !firstAmount || firstAmount === kcal) return true;
        if (firstAmount[2]!.toLowerCase() === 'kj') {
          const expectedKcal = numeric(firstAmount[1]!) / 4.184;
          const candidateKcal = numeric(kcal[1]!);
          if ((expectedKcal === 0 && candidateKcal > 0) || (expectedKcal > 0 && Math.abs(candidateKcal - expectedKcal) / expectedKcal > 0.2)) {
            return false;
          }
        }
        return true;
      })();
      if (kcal && kcalMatchesFirstColumn && result.nutrients.kcal === null) result.nutrients.kcal = numeric(kcal[1]!);
      if (energyKj && kj === null) kj = numeric(energyKj[1]!);
      const unitFirst = /^\s*\((kcal|kj)\)\s*:?\s*(\d+(?:[.,]\d+)?)/i.exec(tail);
      if (unitFirst?.[1]?.toLowerCase() === 'kcal' && result.nutrients.kcal === null) result.nutrients.kcal = numeric(unitFirst[2]!);
      if (unitFirst?.[1]?.toLowerCase() === 'kj' && kj === null) kj = numeric(unitFirst[2]!);
      if (!kcal && !energyKj && /^calories$/i.test(label[0])) {
        const calories = /^\s*:?\s*(\d+(?:[.,]\d+)?)(?![\d.,])\s*(?!%)/.exec(tail);
        if (calories && result.nutrients.kcal === null) result.nutrients.kcal = numeric(calories[1]!);
      }
      continue;
    }
    if (/^\s*:?\s*\d+(?:[.,]\d+)?\s*%/.test(tail)) continue; // Daily value is not an amount.
    const amount = new RegExp(`^\\s*(?:\\((mg|mcg|µg|g)\\))?\\s*:?\\s*${decimal}\\s*(mg|mcg|µg|g)?(?![a-z\\d.,])\\s*(?!%)`, 'i').exec(tail);
    if (!amount) continue;
    const value = numeric(amount[2]!);
    const key = identified?.[0];
    const unit = (amount[3] ?? amount[1] ?? (key?.endsWith('_mg') ? 'mg' : 'g')).toLowerCase();
    if (saltLabel) { if (salt === null) salt = milligrams(value, unit) / 1000; }
    else if (key && result.nutrients[key] === null) {
      result.nutrients[key] = key.endsWith('_mg') ? milligrams(value, unit) : milligrams(value, unit) / 1000;
    }
  }
  if (result.nutrients.kcal === null && kj !== null) result.nutrients.kcal = kj / 4.184;
  if (result.nutrients.sodium_mg === null && salt !== null) result.nutrients.sodium_mg = salt * 393.4;
  if (result.basis === 'per_serving' && result.serving_g === null && result.serving_ml === null) {
    result.warnings.push('Serving weight or volume was not found; gram/ml portions need a measured serving.');
  }
  for (const key of ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const) {
    if (result.nutrients[key] === null) result.warnings.push(`Missing ${key}; confirm the label before saving.`);
  }
  return result;
}
