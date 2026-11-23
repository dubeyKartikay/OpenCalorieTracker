import { router } from 'expo-router';
import { View, Text } from 'react-native';
import { useTodayDiary } from '../../src/app/AppRuntimeContext';
import { localDate, MEALS, sourceLabel } from '../../src/app/controller';
import { sumNutrients } from '../../src/domain';
import { Budget, UndoToast } from '../../src/ui/components/Diary';
import { Badge, Button, Card, ErrorMessage, Heading, Label, Muted, number, Page, ui } from '../../src/ui/components/primitives';
import { colors, spacing } from '../../src/ui/tokens';
export default function Today() {
  const { value, error, loading } = useTodayDiary();
  return <Page title="Today" action={<Button label="Settings" onPress={() => router.push('/settings')} />}>
    <ErrorMessage message={error} />{loading && <Muted>Loading diary…</Muted>}
    {value && <Budget totals={value.totals} goal={value.goal} />}
    <Heading>Today · {new Date(`${localDate()}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</Heading>
    <Card style={{ padding: 0, gap: 0 }}>{MEALS.map((meal, index) => {
      const entries = value?.day?.entries.filter(entry => entry.meal === meal && entry.draft_state === 'confirmed') ?? [];
      const latest = entries[entries.length - 1];
      return <View key={meal} style={[ui.row, { padding: spacing.s16, borderBottomWidth: index === 3 ? 0 : 1, borderBottomColor: colors.hairline }]}>
        <View style={{ width: 30, height: 30, borderWidth: 1, borderColor: colors.border, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.muted, fontSize: 11 }}>{meal.slice(0, 1)}</Text></View>
        <View style={{ flex: 1, gap: spacing.s4 }}><Heading>{meal}</Heading><Muted>{latest ? `${latest.food.name}${entries.length > 1 ? ` + ${entries.length - 1} more` : ''}` : 'No entries'}</Muted>
          {latest && <View style={ui.wrap}><Badge label={sourceLabel(latest.food)} /></View>}</View>
        <Label style={ui.number}>{number(sumNutrients(entries).nutrients?.kcal)}{entries.length ? ' kcal' : ''}</Label>
        <Button label="+" accessibilityLabel={`Add food to ${meal}`} onPress={() => router.navigate({ pathname: '/(tabs)/library', params: { meal } })} />
      </View>;
    })}</Card><UndoToast />
  </Page>;
}
