import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { NutrientKey, NutrientProfile } from '../../../domain/types';
import { colors, spacing } from '../../tokens';
import { Heading, Muted, number, ui } from '../primitives';

export interface MicronutrientsCardProps {
  averages: NutrientProfile | null;
  unknownCount: Record<NutrientKey, number>;
  style?: StyleProp<ViewStyle> | undefined;
}

const MICRONUTRIENTS = [
  { key: 'sodium_mg', label: 'Sodium (mg)' },
  { key: 'sugar_g', label: 'Sugars (g)' },
  { key: 'sat_fat_g', label: 'Sat fat (g)' },
  { key: 'calcium_mg', label: 'Calcium (mg)' },
  { key: 'iron_mg', label: 'Iron (mg)' },
  { key: 'potassium_mg', label: 'Potassium (mg)' },
] as const;

/** Unknown values and partial coverage remain visible beside daily averages. */
export function MicronutrientsCard({ averages, unknownCount, style }: MicronutrientsCardProps) {
  return (
    <View style={[ui.card, style]}>
      <Heading>Micronutrients</Heading>
      <Muted>Daily averages from logged food. Missing values stay unknown.</Muted>
      {MICRONUTRIENTS.map(({ key, label }) => (
        <View key={key} style={styles.row}>
          <Text style={[ui.text, styles.label]}>{label}</Text>
          <View style={styles.value}>
            <Text style={ui.number}>{number(averages?.[key], 2)}</Text>
            {unknownCount[key] > 0 ? <Text style={ui.muted}>{`· ${unknownCount[key]} unknown`}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    justifyContent: 'space-between', gap: spacing.s8,
    paddingTop: spacing.s8, borderTopWidth: 1, borderTopColor: colors.hairline,
  },
  label: { flexShrink: 1 },
  value: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.s6 },
});
