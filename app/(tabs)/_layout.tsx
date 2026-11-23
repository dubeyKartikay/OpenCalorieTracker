import { Tabs } from 'expo-router';
import { RailIcon } from '../../src/ui/components/RailIcon';
import { colors, MIN_TOUCH_TARGET } from '../../src/ui/tokens';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.accent, tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.hairline, minHeight: 68 },
      tabBarItemStyle: { minHeight: MIN_TOUCH_TARGET, paddingVertical: 5 },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }, sceneStyle: { backgroundColor: colors.ground },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarAccessibilityLabel: 'Today diary', tabBarIcon: ({ color }) => <RailIcon name="today" color={color} /> }} />
      <Tabs.Screen name="library" options={{ title: 'Library', tabBarAccessibilityLabel: 'Library food search', tabBarIcon: ({ color }) => <RailIcon name="library" color={color} /> }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarAccessibilityLabel: 'Diary history', tabBarIcon: ({ color }) => <RailIcon name="history" color={color} /> }} />
      <Tabs.Screen name="progress" options={{ title: 'Progress', tabBarAccessibilityLabel: 'Nutrition and weight progress', tabBarIcon: ({ color }) => <RailIcon name="progress" color={color} /> }} />
    </Tabs>
  );
}
