import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RailIcon } from '../../src/ui/components/RailIcon';
import { hapticSelection } from '../../src/ui/haptics';
import { colors, fontFace, fontSize } from '../../src/ui/tokens';

/** Shared IconRailAppNav (exact Doop tab order: Today · History · Progress · Library). */
export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 6);

  return (
    <Tabs
      screenListeners={{
        tabPress: () => {
          hapticSelection();
        },
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.ground,
          borderTopColor: colors.hairline,
          borderTopWidth: 1,
          height: 58 + bottomInset,
          paddingTop: 5,
          paddingBottom: bottomInset,
          paddingHorizontal: 8,
          elevation: 0,
        },
        tabBarItemStyle: {
          minHeight: 44,
          paddingVertical: 0,
        },
        tabBarLabelStyle: {
          ...fontFace('semibold'),
          fontSize: fontSize.t11,
          marginTop: 2,
        },
        sceneStyle: { backgroundColor: colors.ground },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarAccessibilityLabel: 'Today diary',
          tabBarIcon: ({ focused }) => (
            <RailIcon name="today" color={focused ? colors.accent : colors.muted} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarAccessibilityLabel: 'Diary history',
          tabBarIcon: ({ focused }) => (
            <RailIcon name="history" color={focused ? colors.accent : colors.muted} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          tabBarAccessibilityLabel: 'Nutrition and weight progress',
          tabBarIcon: ({ focused }) => (
            <RailIcon name="progress" color={focused ? colors.accent : colors.muted} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarAccessibilityLabel: 'Library food search',
          tabBarIcon: ({ focused }) => (
            <RailIcon name="library" color={focused ? colors.accent : colors.muted} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
