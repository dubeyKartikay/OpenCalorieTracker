import { View } from 'react-native';
import { colors } from '../../tokens';

/** How much of a day has been logged. */
export type CompletenessStatus = 'complete' | 'partial' | 'none';

export interface CompletenessMarkProps {
  status: CompletenessStatus;
  size?: number | undefined;
}

/**
 * Geometric completeness marker. Every state is drawn with a different shape
 * (filled disc, half-filled ring, dashed ring) so the meaning never depends on
 * colour alone.
 */
export function CompletenessMark({ status, size = 10 }: CompletenessMarkProps) {
  if (status === 'none') {
    return (
      <View
        accessible={false}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: colors.border,
        }}
      />
    );
  }

  if (status === 'partial') {
    return (
      <View
        accessible={false}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: colors.warning,
          overflow: 'hidden',
          justifyContent: 'flex-end',
        }}
      >
        <View style={{ height: size / 2, backgroundColor: colors.warning }} />
      </View>
    );
  }

  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.success,
      }}
    />
  );
}

/** Doop design-system alias. */
export const RailTrendDayMark = CompletenessMark;
export type RailTrendDayMarkProps = CompletenessMarkProps;
