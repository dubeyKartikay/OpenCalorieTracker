import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { colors } from '../tokens/colors';

export type DaypartGlyph = 'sunrise' | 'sun' | 'snack' | 'moon';
export type FoodGlyph =
  | 'yogurt'
  | 'dal'
  | 'toast'
  | 'egg'
  | 'fruit'
  | 'recipe'
  | 'meal'
  | 'paneer'
  | 'tikka'
  | 'oats'
  | 'chana'
  | 'banana'
  | 'dosa'
  | 'rice'
  | 'roti'
  | 'cookie';

export type DoopIconName =
  | 'today'
  | 'history'
  | 'progress'
  | 'library'
  | DaypartGlyph
  | FoodGlyph
  | 'pin'
  | 'search'
  | 'camera'
  | 'photo'
  | 'mic'
  | 'barcode'
  | 'plus'
  | 'minus'
  | 'check'
  | 'edit'
  | 'undo'
  | 'close'
  | 'back'
  | 'chevronDown'
  | 'chevronRight'
  | 'chevronLeft'
  | 'settings'
  | 'torch'
  | 'info'
  | 'sparkle'
  | 'key'
  | 'external'
  | 'link'
  | 'lock'
  | 'grip'
  | 'trash'
  | 'plate'
  | 'katori'
  | 'cup'
  | 'spoon'
  | 'scale'
  | 'backspace'
  | 'water'
  | 'more'
  | 'user'
  | 'database'
  | 'ringMark';

export interface DoopIconProps {
  name: DoopIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/** Exact Doop Icon Rail SVG line icons rendered with react-native-svg. */
export function DoopIcon({
  name,
  size = 20,
  color = colors.ink,
  strokeWidth,
}: DoopIconProps) {
  const sw = strokeWidth ?? (name === 'check' ? 2.6 : name === 'plus' || name === 'minus' ? 2 : 1.65);
  const common = {
    stroke: color,
    strokeWidth: sw,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {name === 'today' && (
        <>
          <Rect x={4} y={5} width={16} height={15} rx={3} {...common} strokeWidth={strokeWidth ?? 1.7} />
          <Path d="M8 3v4m8-4v4M4 10h16m-11 5h2m3 0h2" {...common} strokeWidth={strokeWidth ?? 1.7} />
        </>
      )}
      {name === 'history' && (
        <Path d="M3 11a9 9 0 1 1 2.3 6.9M3 5v6h6m3-5v6l4 2" {...common} strokeWidth={strokeWidth ?? 1.7} />
      )}
      {name === 'progress' && (
        <>
          <Path d="M4 4v16h16M7.5 15l4-4 3 2 4-5" {...common} strokeWidth={strokeWidth ?? 1.7} />
          <Circle cx={19} cy={8} r={1} {...common} strokeWidth={strokeWidth ?? 1.7} />
        </>
      )}
      {name === 'library' && (
        <>
          <Rect x={4} y={4} width={7} height={7} rx={2} {...common} strokeWidth={strokeWidth ?? 1.7} />
          <Rect x={13} y={4} width={7} height={7} rx={2} {...common} strokeWidth={strokeWidth ?? 1.7} />
          <Rect x={4} y={13} width={7} height={7} rx={2} {...common} strokeWidth={strokeWidth ?? 1.7} />
          <Rect x={13} y={13} width={7} height={7} rx={2} {...common} strokeWidth={strokeWidth ?? 1.7} />
        </>
      )}

      {/* Daypart pictograms (exact TodayMealRailRow paths) */}
      {name === 'sunrise' && (
        <>
          <Path d="M3 15.6h18" {...common} strokeWidth={strokeWidth ?? 1.5} />
          <Path d="M7.4 15.6a4.6 4.6 0 0 1 9.2 0" {...common} strokeWidth={strokeWidth ?? 1.5} />
          <Path d="M12 4.6v2.1" {...common} strokeWidth={strokeWidth ?? 1.5} />
          <Path d="M5.5 7.6l1.5 1.5" {...common} strokeWidth={strokeWidth ?? 1.5} />
          <Path d="M18.5 7.6L17 9.1" {...common} strokeWidth={strokeWidth ?? 1.5} />
          <Path d="M7.6 19.4h8.8" {...common} strokeWidth={strokeWidth ?? 1.5} />
        </>
      )}
      {name === 'sun' && (
        <>
          <Circle cx={12} cy={12} r={4.2} {...common} strokeWidth={strokeWidth ?? 1.5} />
          <Path
            d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.9 5.9l1.6 1.6M16.5 16.5l1.6 1.6M18.1 5.9l-1.6 1.6M7.5 16.5l-1.6 1.6"
            {...common}
            strokeWidth={strokeWidth ?? 1.5}
          />
        </>
      )}
      {name === 'snack' && (
        <>
          <Path
            d="M12 8.3c1.7-1.9 4.4-.8 4.4 1.9 0 3.3-2.4 5.4-4.4 5.4S7.6 13.5 7.6 10.2c0-2.7 2.7-3.8 4.4-1.9Z"
            {...common}
            strokeWidth={strokeWidth ?? 1.5}
          />
          <Path d="M12 8.3V5.8" {...common} strokeWidth={strokeWidth ?? 1.5} />
          <Path d="M12.4 6.5c.6-1.3 1.9-1.9 3.1-1.5-.2 1.3-1.5 2-3.1 1.5Z" {...common} strokeWidth={strokeWidth ?? 1.5} />
        </>
      )}
      {name === 'moon' && (
        <>
          <Path d="M15.6 15.4a6.6 6.6 0 0 1-4.7-11.1 7.1 7.1 0 1 0 5.3 11.1Z" {...common} strokeWidth={strokeWidth ?? 1.5} />
          <Path d="M18.4 4.9v2M17.4 5.9h2" {...common} strokeWidth={strokeWidth ?? 1.5} />
        </>
      )}

      {/* Food glyphs (exact RailLibraryShelfRow + LibV2Row paths) */}
      {name === 'yogurt' && <Path d="M3 11h18a9 9 0 0 1-18 0Zm5-3c1.5-2 6.5-2 8 0M9 20h6" {...common} />}
      {name === 'dal' && <Path d="M3 13h18a9 9 0 0 1-18 0ZM7 10c-2-3 2-3 1-6m4 6c-2-3 2-3 1-6m4 6c-2-3 2-3 1-6" {...common} />}
      {name === 'toast' && (
        <>
          <Path d="M6 21h12v-9c2-1 3-3 2-5-2-4-14-4-16 0-1 2 0 4 2 5Z" {...common} />
          <Circle cx={12} cy={13} r={2.5} {...common} />
        </>
      )}
      {name === 'egg' && <Path d="M19 14c0 4-3 7-7 7s-7-3-7-7c0-4 4-11 7-11s7 7 7 11Z" {...common} />}
      {name === 'fruit' && (
        <>
          <Path d="M12 8.4c-2.6-1.9-6.5-.6-6.5 4.1 0 4.4 3 7.5 6.5 7.5s6.5-3.1 6.5-7.5c0-4.7-3.9-6-6.5-4.1Z" {...common} />
          <Path d="M12 8.4c0-2.4 1.3-4 3.2-4.8" {...common} />
        </>
      )}
      {name === 'recipe' && (
        <>
          <Path d="M6 3h12a2 2 0 0 1 2 2v15H7a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Z" {...common} />
          <Path d="M4 16h16M8 8h8m-8 4h5" {...common} />
        </>
      )}
      {name === 'meal' && <Path d="M3 12h18a9 9 0 0 1-18 0Zm5 8h8M7 8h10" {...common} />}
      {name === 'paneer' && (
        <>
          <Path d="M3 12.2h12.4a6.2 6.2 0 0 1-12.4 0Z" {...common} />
          <Path d="M15.2 13.8h5.2" {...common} />
        </>
      )}
      {name === 'tikka' && (
        <Path
          d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
          {...common}
        />
      )}
      {name === 'oats' && (
        <>
          <Path d="M4 12.5h16a8 8 0 0 1-16 0Z" {...common} />
          <Path d="M9.3 20.5h5.4" {...common} />
          <Path d="M10.8 13.6 17.4 7" {...common} />
          <Circle cx={18.4} cy={6} r={2.1} {...common} />
        </>
      )}
      {name === 'chana' && (
        <>
          <Circle cx={8.5} cy={9.1} r={3.2} {...common} />
          <Circle cx={15.5} cy={9.1} r={3.2} {...common} />
          <Circle cx={12} cy={15.3} r={3.2} {...common} />
        </>
      )}
      {name === 'banana' && <Path d="M7 5.5c-1 8 4 12.5 12 12.5-4.5-1.5-7.5-4.5-8.5-8.5-.4-1.6-.6-3-.5-4Z" {...common} />}
      {name === 'dosa' && (
        <>
          <Path d="M20.6 12 5.6 6.6a5.6 5.6 0 0 0 .1 10.9Z" {...common} />
          <Path d="M9.2 7.8a4.4 4.4 0 0 0 0 8.4" {...common} />
        </>
      )}
      {name === 'rice' && (
        <>
          <Path d="M3 13.2h18a9 9 0 0 1-18 0Z" {...common} />
          <Path d="M5.6 13.2a6.4 6.4 0 0 1 12.8 0" {...common} />
        </>
      )}
      {name === 'roti' && (
        <>
          <Circle cx={12} cy={12} r={8} {...common} />
          <Circle cx={9.5} cy={10} r={1} fill={color} />
          <Circle cx={14.5} cy={11} r={1} fill={color} />
          <Circle cx={11.5} cy={14.8} r={1} fill={color} />
        </>
      )}
      {name === 'cookie' && (
        <>
          <Path d="M12 4a8 8 0 1 0 8 8 3 3 0 0 1-3-3 3 3 0 0 1-3-3 3 3 0 0 1-2-2Z" {...common} />
          <Circle cx={9} cy={13} r={1} fill={color} />
          <Circle cx={13} cy={15.5} r={1} fill={color} />
          <Circle cx={10.5} cy={9.5} r={0.9} fill={color} />
        </>
      )}

      {/* Action & Utility icons */}
      {name === 'pin' && (
        <>
          <Path d="M12 15.6V21" {...common} strokeWidth={strokeWidth ?? 2} />
          <Path d="M9.2 3h5.6l-.7 5.3 2.9 2.3v1.5H7v-1.5l2.9-2.3L9.2 3Z" {...common} strokeWidth={strokeWidth ?? 2} />
        </>
      )}
      {name === 'search' && (
        <>
          <Circle cx={10.8} cy={10.8} r={6.4} {...common} />
          <Path d="m15.6 15.6 4.4 4.4" {...common} />
        </>
      )}
      {name === 'camera' && (
        <>
          <Rect x={3} y={6.5} width={18} height={13} rx={3.2} {...common} strokeWidth={strokeWidth ?? 1.6} />
          <Path d="M8.6 6.5l1.3-2.2h4.6l1.3 2.2" {...common} strokeWidth={strokeWidth ?? 1.6} />
          <Circle cx={12} cy={13} r={3.4} {...common} strokeWidth={strokeWidth ?? 1.6} />
        </>
      )}
      {name === 'photo' && (
        <>
          <Rect x={3.5} y={4.5} width={17} height={15} rx={3} {...common} strokeWidth={strokeWidth ?? 1.6} />
          <Circle cx={9} cy={9.5} r={1.5} {...common} strokeWidth={strokeWidth ?? 1.5} />
          <Path d="M4.5 17.5l4.8-4.8a1.2 1.2 0 0 1 1.7 0l2.2 2.2 2.1-2.1a1.2 1.2 0 0 1 1.7 0l3 3" {...common} strokeWidth={strokeWidth ?? 1.6} />
        </>
      )}
      {name === 'mic' && (
        <>
          <Rect x={9} y={3} width={6} height={10.5} rx={3} {...common} strokeWidth={strokeWidth ?? 1.6} />
          <Path d="M5.5 11.2a6.5 6.5 0 0 0 13 0" {...common} strokeWidth={strokeWidth ?? 1.6} />
          <Path d="M12 17.7V21" {...common} strokeWidth={strokeWidth ?? 1.6} />
        </>
      )}
      {name === 'barcode' && (
        <Path d="M4 6v12M7.5 6v12M11 6v12M13.5 6v12M16.5 6v12M20 6v12" {...common} strokeWidth={strokeWidth ?? 1.6} />
      )}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...common} />}
      {name === 'minus' && <Path d="M5 12h14" {...common} />}
      {name === 'check' && <Path d="m5 12.5 4.5 4.5L19 7.5" {...common} />}
      {name === 'edit' && (
        <>
          <Path d="M4.5 19.5h3.8L18.8 9a2.1 2.1 0 0 0-3-3L5.3 16.5l-.8 3Z" {...common} strokeWidth={strokeWidth ?? 1.65} />
          <Path d="m13.8 8 2.2 2.2" {...common} strokeWidth={strokeWidth ?? 1.65} />
        </>
      )}
      {name === 'undo' && (
        <>
          <Path d="M4.4 10.2h9.2a5.6 5.6 0 1 1 0 11.2H8" {...common} strokeWidth={strokeWidth ?? 1.9} />
          <Path d="m8.2 5.6-4 4.6 4 4.6" {...common} strokeWidth={strokeWidth ?? 1.9} />
        </>
      )}
      {name === 'close' && <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...common} />}
      {name === 'back' && <Path d="m14.5 6-6 6 6 6" {...common} strokeWidth={strokeWidth ?? 1.8} />}
      {name === 'chevronLeft' && <Path d="m14.5 6.5-5.5 5.5 5.5 5.5" {...common} />}
      {name === 'chevronRight' && <Path d="m9.5 6.5 5.5 5.5-5.5 5.5" {...common} />}
      {name === 'chevronDown' && <Path d="m7 10 5 5 5-5" {...common} />}
      {name === 'settings' && (
        <>
          <Circle cx={12} cy={12} r={3.2} {...common} strokeWidth={strokeWidth ?? 1.55} />
          <Path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 .92-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51.92H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
            {...common}
            strokeWidth={strokeWidth ?? 1.55}
          />
        </>
      )}
      {name === 'torch' && (
        <>
          <Path d="M9 3h6v4l-1.5 2.5V20a1.5 1.5 0 0 1-3 0V9.5L9 7V3Z" {...common} strokeWidth={strokeWidth ?? 1.6} />
          <Path d="M12 12v2M5.5 6.5l1.4.8M18.5 6.5l-1.4.8" {...common} strokeWidth={strokeWidth ?? 1.6} />
        </>
      )}
      {name === 'info' && (
        <>
          <Circle cx={12} cy={12} r={8.5} {...common} strokeWidth={strokeWidth ?? 1.6} />
          <Path d="M12 11v5" {...common} strokeWidth={strokeWidth ?? 1.7} />
          <Circle cx={12} cy={8} r={0.9} fill={color} />
        </>
      )}
      {name === 'sparkle' && (
        <>
          <Path d="M12 3.2l1.7 4.9 4.9 1.7-4.9 1.7L12 16.4l-1.7-4.9-4.9-1.7 4.9-1.7z" {...common} strokeWidth={strokeWidth ?? 1.6} />
          <Path d="M18.4 15.6l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" {...common} strokeWidth={strokeWidth ?? 1.6} />
        </>
      )}
      {name === 'key' && (
        <>
          <Circle cx={8} cy={12} r={3.4} {...common} strokeWidth={strokeWidth ?? 1.6} />
          <Path d="M11.4 12H20m-3 0v3m-3-3v2.2" {...common} strokeWidth={strokeWidth ?? 1.6} />
        </>
      )}
      {name === 'external' && (
        <>
          <Path d="M7 17L17 7M9 7h8v8" {...common} strokeWidth={strokeWidth ?? 1.65} />
        </>
      )}
      {name === 'link' && (
        <>
          <Path d="M10 13a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66L11.3 6" {...common} strokeWidth={strokeWidth ?? 1.7} />
          <Path d="M14 11a4 4 0 0 0-5.66 0L5.5 13.83a4 4 0 1 0 5.66 5.66L12.7 18" {...common} strokeWidth={strokeWidth ?? 1.7} />
        </>
      )}
      {name === 'lock' && (
        <>
          <Rect x={5.5} y={11} width={13} height={9} rx={2.5} {...common} strokeWidth={strokeWidth ?? 1.65} />
          <Path d="M8.5 11V8.2a3.5 3.5 0 0 1 7 0V11" {...common} strokeWidth={strokeWidth ?? 1.65} />
        </>
      )}
      {name === 'grip' && (
        <>
          <Circle cx={9} cy={6.5} r={1.6} fill={color} />
          <Circle cx={15} cy={6.5} r={1.6} fill={color} />
          <Circle cx={9} cy={12} r={1.6} fill={color} />
          <Circle cx={15} cy={12} r={1.6} fill={color} />
          <Circle cx={9} cy={17.5} r={1.6} fill={color} />
          <Circle cx={15} cy={17.5} r={1.6} fill={color} />
        </>
      )}
      {name === 'trash' && (
        <>
          <Path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" {...common} />
        </>
      )}
      {name === 'plate' && (
        <>
          <Circle cx={12} cy={12} r={7.6} {...common} />
          <Circle cx={12} cy={12} r={3.6} {...common} strokeWidth={strokeWidth ?? 1.3} />
        </>
      )}
      {name === 'katori' && <Path d="M5.6 11.4h12.8a6.4 6.4 0 0 1-12.8 0Z" {...common} />}
      {name === 'cup' && (
        <>
          <Path d="M5.4 7.2h10.2v7.4a4.4 4.4 0 0 1-4.4 4.4h-1.4a4.4 4.4 0 0 1-4.4-4.4Z" {...common} />
          <Path d="M15.6 9.2h1.5a2.4 2.4 0 0 1 0 4.8h-1.5" {...common} />
        </>
      )}
      {name === 'spoon' && (
        <>
          <Circle cx={15.5} cy={8.5} r={3.2} {...common} />
          <Path d="M13 11 5.5 18.5" {...common} />
        </>
      )}
      {name === 'scale' && (
        <>
          <Path d="M12 5v14M7 19h10M6 8h12M6 8l-2 5h4l-2-5ZM18 8l-2 5h4l-2-5Z" {...common} strokeWidth={strokeWidth ?? 1.5} />
        </>
      )}
      {name === 'backspace' && (
        <>
          <Path d="M9 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5.5-6L9 6Z" {...common} strokeWidth={strokeWidth ?? 1.6} />
          <Path d="m12.5 9.5 4 5M16.5 9.5l-4 5" {...common} strokeWidth={strokeWidth ?? 1.6} />
        </>
      )}
      {name === 'water' && (
        <Path d="M12 3.5C12 3.5 6 10.2 6 14.3a6 6 0 0 0 12 0C18 10.2 12 3.5 12 3.5Z" {...common} />
      )}
      {name === 'more' && (
        <>
          <Circle cx={6} cy={12} r={1.6} fill={color} />
          <Circle cx={12} cy={12} r={1.6} fill={color} />
          <Circle cx={18} cy={12} r={1.6} fill={color} />
        </>
      )}
      {name === 'user' && (
        <>
          <Circle cx={12} cy={8.5} r={3.5} {...common} />
          <Path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" {...common} />
        </>
      )}
      {name === 'database' && (
        <>
          <Path d="M5 7c0 1.66 3.13 3 7 3s7-1.34 7-3-3.13-3-7-3-7 1.34-7 3Z" {...common} />
          <Path d="M5 7v10c0 1.66 3.13 3 7 3s7-1.34 7-3V7" {...common} />
          <Path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" {...common} />
        </>
      )}
      {name === 'ringMark' && (
        <>
          <Circle cx={12} cy={12} r={9} {...common} strokeWidth={strokeWidth ?? 1.8} />
          <Circle cx={12} cy={12} r={5} {...common} strokeWidth={strokeWidth ?? 1.8} />
        </>
      )}
      {name === 'today' && null}
      {/* Keep Line imported cleanly if unused in paths */}
      {false && <Line x1={0} y1={0} x2={0} y2={0} />}
    </Svg>
  );
}

/** Map meal section name/id to its Doop Icon Rail daypart icon. */
export function mealDaypartGlyph(mealIdOrName: string): DaypartGlyph {
  const s = mealIdOrName.toLowerCase();
  if (s.includes('break') || s.includes('morn')) return 'sunrise';
  if (s.includes('lunch') || s.includes('noon') || s.includes('mid')) return 'sun';
  if (s.includes('snack') || s.includes('tea') || s.includes('fruit')) return 'snack';
  return 'moon';
}

/** Pick a distinct Doop line silhouette for a food/meal/recipe name. */
export function inferFoodGlyph(name: string, kind?: 'meal' | 'food' | 'recipe'): FoodGlyph {
  const s = name.toLowerCase();
  if (s.includes('yogurt') || s.includes('curd') || s.includes('dahi')) return 'yogurt';
  if (s.includes('dal') || s.includes('lentil') || s.includes('soup') || s.includes('sambar')) return 'dal';
  if (s.includes('toast') || s.includes('bread') || s.includes('sandwich')) return 'toast';
  if (s.includes('egg') || s.includes('omelette')) return 'egg';
  if (s.includes('banana')) return 'banana';
  if (s.includes('roti') || s.includes('chapati') || s.includes('paratha') || s.includes('naan')) return 'roti';
  if (s.includes('cookie') || s.includes('biscuit')) return 'cookie';
  if (s.includes('oats') || s.includes('porridge') || s.includes('cereal')) return 'oats';
  if (s.includes('dosa') || s.includes('idli') || s.includes('crepe')) return 'dosa';
  if (s.includes('paneer') || s.includes('bhurji') || s.includes('tofu')) return 'paneer';
  if (s.includes('tikka') || s.includes('chicken') || s.includes('grill')) return 'tikka';
  if (s.includes('chana') || s.includes('chickpea') || s.includes('beans') || s.includes('almond')) return 'chana';
  if (s.includes('rice') || s.includes('biryani') || s.includes('pulao')) return 'rice';
  if (s.includes('apple') || s.includes('berry') || s.includes('mango') || s.includes('fruit')) return 'fruit';
  if (kind === 'recipe') return 'recipe';
  return 'meal';
}
