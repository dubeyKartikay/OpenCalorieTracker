import React from 'react';
import { View } from 'react-native';
import type { ColorValue } from 'react-native';
import { colors } from '../tokens/colors';
import { DoopIcon } from './DoopIcons';

/** Exact Doop IconRailAppNav vector tab icon with active pill capsule. */
export function RailIcon({
  name,
  color: inputColor,
  focused = false,
}: {
  name: 'today' | 'library' | 'history' | 'progress';
  color: ColorValue | null;
  focused?: boolean;
}) {
  const stroke = typeof inputColor === 'string' ? inputColor : focused ? colors.accent : colors.muted;
  return (
    <View
      accessible={false}
      style={{
        width: 40,
        height: 28,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? colors.surface : 'transparent',
      }}
    >
      <DoopIcon name={name} size={20} color={stroke} strokeWidth={1.7} />
    </View>
  );
}
