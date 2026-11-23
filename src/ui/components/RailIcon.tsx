import { View } from 'react-native';
import type { ColorValue } from 'react-native';
/** Line icons constructed from native strokes, without emoji or font dependencies. */
export function RailIcon({ name, color: inputColor }: { name: 'today' | 'library' | 'history' | 'progress'; color: ColorValue | null }) {
  const color = inputColor ?? undefined;
  return <View accessible={false} style={{ width: 24, height: 24, justifyContent: 'center', gap: 3 }}>
    {name === 'today' ? <View style={{ width: 21, height: 21, borderWidth: 2, borderColor: color, borderRadius: 12, alignSelf: 'center' }} />
      : name === 'progress' ? <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 22 }}>
        {[9, 15, 22].map(height => <View key={height} style={{ width: 4, height, backgroundColor: color }} />)}</View>
        : <View style={{ width: 22, height: 22, borderWidth: 2, borderColor: color, borderRadius: 3, padding: 4, gap: 3 }}>
          {(name === 'library' ? [1, 2] : [1, 2, 3]).map(key => <View key={key} style={{ height: 2, backgroundColor: color }} />)}</View>}
  </View>;
}
