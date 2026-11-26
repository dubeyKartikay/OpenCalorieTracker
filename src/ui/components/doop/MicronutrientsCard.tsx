import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { NutrientKey, NutrientProfile } from '../../../domain/types';
import { colors, fontFace, tabularNums } from '../../tokens';
import { number, SectionRule } from '../primitives';

export interface MicronutrientsCardProps {
  averages: NutrientProfile | null;
  unknownCount: Record<NutrientKey, number>;
  style?: StyleProp<ViewStyle> | undefined;
}

const MICRONUTRIENTS: { key: NutrientKey | null; label: string; unit: string }[] = [
  { key: 'fiber_g', label: 'Fiber', unit: 'g' },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
  { key: 'potassium_mg', label: 'Potassium', unit: 'mg' },
  { key: 'calcium_mg', label: 'Calcium', unit: 'mg' },
  { key: 'iron_mg', label: 'Iron', unit: 'mg' },
  // Vitamins are not persisted by the current nutrient schema; leave them explicitly unknown.
  { key: null, label: 'Vitamin C', unit: 'mg' },
  { key: null, label: 'Vitamin D', unit: 'µg' },
];

/** Quiet daily averages. Thin strips indicate full/partial/unknown data coverage, not dietary goals. */
export function MicronutrientsCard({ averages, unknownCount, style }: MicronutrientsCardProps) {
  return <View style={style}>
    <SectionRule label="Micronutrients" />
    <Text style={styles.note}>Daily average · data coverage</Text>
    {MICRONUTRIENTS.map(({ key, label, unit }, index) => {
      const value = key ? averages?.[key] : null;
      const partial = key != null && unknownCount[key] > 0;
      return <View key={label} style={[styles.row, index > 0 && styles.hairline]}>
        <View style={styles.head}><Text style={styles.label}>{label}</Text><View style={styles.values}>
          {partial && value != null ? <Text style={styles.coverage}>partial</Text> : null}
          <Text style={styles.value}>{value == null ? '—' : number(value, 1)}{value == null ? '' : <Text style={styles.coverage}>{` ${unit}`}</Text>}</Text>
        </View></View>
        <View accessible accessibilityLabel={`${label}: ${value == null ? 'unknown' : partial ? 'partial data coverage' : 'complete data coverage'}`} style={styles.track}><View style={[styles.fill, { width: value == null ? '0%' : '100%', opacity: partial ? 0.35 : 0.6 }]} /></View>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  note: { ...fontFace('medium'), color: colors.muted, fontSize: 10, marginTop: 8, marginBottom: 2 },
  row: { paddingVertical: 10, gap: 7 },
  hairline: { borderTopWidth: 1, borderTopColor: colors.hairline },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  label: { ...fontFace('medium'), color: colors.muted, fontSize: 12 },
  values: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  value: { ...fontFace('semibold'), ...tabularNums, color: colors.ink, fontSize: 12 },
  coverage: { ...fontFace('medium'), color: colors.muted, fontSize: 10 },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.track },
  fill: { height: 3, borderRadius: 2, backgroundColor: colors.muted },
});
