import { describe, expect, it } from 'vitest';
import { formatDiaryCsv, formatWeightTrendsCsv } from '../csvExport';
import type { DiaryDay } from '../types';
import { entry, food, nutrients, weighIn } from './fixtures';

const header = 'date,meal,occurred_at,time_zone,food_name,brand,provenance_kind,source_pack_id,portion_certainty,quantity_amount,quantity_unit,kcal,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sat_fat_g,sodium_mg,calcium_mg,iron_mg,potassium_mg';
const day = (entries: DiaryDay['entries'], date = '2026-11-23'): DiaryDay => ({ date, completeness: 'partial', entries });

describe('diary CSV export', () => {
  it('uses RFC-4180 quotes, doubled quotes, embedded newlines and CRLF record endings', () => {
    const snapshot = entry({
      meal: 'Lunch, late', food: food({ name: 'Rice "special"\r\nwith dal', brand: 'Line\nbreak' }),
      nutrients: nutrients({ fiber_g: 0 }),
    });
    expect(formatDiaryCsv([day([snapshot])])).toBe(header + '\r\n' +
      '2026-11-23,"Lunch, late",2026-11-23T12:30:00+05:30,Asia/Kolkata,"Rice ""special""\r\nwith dal","Line\nbreak",database,usda,stated,100,g,200,10,20,8,0,,,,,,\r\n');
  });

  it('leaves null and undefined nutrients empty while preserving explicit zero', () => {
    const snapshot = entry({ nutrients: nutrients({ fiber_g: null, sugar_g: 0 }) });
    // Defensive handling of an older/incomplete runtime snapshot, without normalizing it to zero.
    Reflect.deleteProperty(snapshot.nutrients, 'potassium_mg');
    const cells = formatDiaryCsv([day([snapshot])]).split('\r\n')[1]!.split(',');
    expect(cells).toHaveLength(22);
    expect(cells.slice(11)).toEqual(['200', '10', '20', '8', '', '0', '', '', '', '', '']);
    expect(cells[5]).toBe('');
  });

  it.each(['=', '+', '-', '@', '\t', '\r'])('neutralizes the %j text prefix before quoting', (prefix) => {
    const snapshot = entry({ meal: `${prefix}SUM(1,2)` });
    expect(formatDiaryCsv([day([snapshot])])).toContain(`,"'${prefix}SUM(1,2)",`);
  });

  it('sanitizes all free text columns while leaving numeric cells plain', () => {
    const snapshot = entry({
      meal: '=meal', time_zone: '+zone', food: food(), quantity: { amount: 0, unit: '-unit' },
    });
    // Assigned after schema construction because food schema intentionally trims names/brands.
    snapshot.food = { ...snapshot.food, name: '@name', brand: '\tbrand', source_pack_id: '\rpack' };
    expect(formatDiaryCsv([day([snapshot])])).toContain(
      '2026-11-23,\'=meal,2026-11-23T12:30:00+05:30,\'+zone,\'@name,\'\tbrand,database,"\'\rpack",stated,0,\'-unit,200,10,20,8,');
  });

  it('excludes drafts and sorts by local date then instant, without mutating input', () => {
    const laterDay = entry({ date: '2026-11-24', occurred_at: '2026-11-24T01:00:00Z', meal: 'Next day' });
    const later = entry({ occurred_at: '2026-11-23T09:00:00Z', meal: 'Later' });
    const earlier = entry({ occurred_at: '2026-11-23T12:30:00+05:30', meal: 'Earlier' });
    const days = [day([laterDay], laterDay.date), day([later, entry({ draft_state: 'draft', meal: 'Draft' }), earlier])];
    const original = structuredClone(days);
    const rows = formatDiaryCsv(days).split('\r\n');
    expect(rows.slice(1, -1).map((row) => row.split(',')[1])).toEqual(['Earlier', 'Later', 'Next day']);
    expect(days).toEqual(original);
  });

  it('emits only the header when no confirmed entries exist', () => {
    expect(formatDiaryCsv([])).toBe(header + '\r\n');
    expect(formatDiaryCsv([day([entry({ draft_state: 'draft' })])])).toBe(header + '\r\n');
  });
});

describe('weight trend CSV export', () => {
  it('exports observation values and existing trends in supplied order with CRLF', () => {
    const points = [
      { weighIn: weighIn('2026-11-23', 70.5), trendKg: 71.25 },
      { weighIn: weighIn('2026-11-24', 70, { source: 'health', external_source_id: 'health:1' }), trendKg: 71.125 },
    ];
    const original = structuredClone(points);
    expect(formatWeightTrendsCsv(points)).toBe(
      'date,measured_at,weight_kg,trend_kg,source\r\n' +
      '2026-11-23,2026-11-23T00:00:00Z,70.5,71.25,manual\r\n' +
      '2026-11-24,2026-11-24T00:00:00Z,70,71.125,health\r\n');
    expect(points).toEqual(original);
  });

  it('emits a header for an empty trend', () => {
    expect(formatWeightTrendsCsv([])).toBe('date,measured_at,weight_kg,trend_kg,source\r\n');
  });
});
