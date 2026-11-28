import Svg, { Circle } from 'react-native-svg';
import { colors } from '../../tokens';

export type CompletenessStatus = 'complete' | 'none';
export interface CompletenessMarkProps {
  status: CompletenessStatus;
  size?: number | undefined;
}

/** Solid dot for logged days, quiet dashed ring for unlogged days. */
export function CompletenessMark({ status, size = 10 }: CompletenessMarkProps) {
  return <Svg width={size} height={size} viewBox="0 0 12 12" accessible={false}>
    {status === 'complete' ? <Circle cx={6} cy={6} r={5} fill={colors.success} /> : null}
    {status === 'none' ? <Circle cx={6} cy={6} r={4.9} fill="none" stroke={colors.border} strokeWidth={1.2} strokeDasharray="2 2" opacity={0.5} /> : null}
  </Svg>;
}

export const RailTrendDayMark = CompletenessMark;
export type RailTrendDayMarkProps = CompletenessMarkProps;
