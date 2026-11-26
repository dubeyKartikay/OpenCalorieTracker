import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../../tokens';

export type CompletenessStatus = 'complete' | 'partial' | 'none';
export interface CompletenessMarkProps {
  status: CompletenessStatus;
  size?: number | undefined;
}

/** Solid dot, left half-disc, or quiet dashed ring: status never relies on hue alone. */
export function CompletenessMark({ status, size = 10 }: CompletenessMarkProps) {
  return <Svg width={size} height={size} viewBox="0 0 12 12" accessible={false}>
    {status === 'complete' ? <Circle cx={6} cy={6} r={5} fill={colors.success} /> : null}
    {status === 'partial' ? <>
      <Circle cx={6} cy={6} r={4.9} stroke={colors.ink} strokeWidth={1.3} fill="none" />
      <Path d="M6 1.1a4.9 4.9 0 0 0 0 9.8Z" fill={colors.ink} />
    </> : null}
    {status === 'none' ? <Circle cx={6} cy={6} r={4.9} fill="none" stroke={colors.border} strokeWidth={1.2} strokeDasharray="2 2" opacity={0.5} /> : null}
  </Svg>;
}

export const RailTrendDayMark = CompletenessMark;
export type RailTrendDayMarkProps = CompletenessMarkProps;
