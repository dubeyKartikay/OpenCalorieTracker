import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useAction, useAppRuntime, useAsyncResource } from '../../src/app/AppRuntimeContext';
import { Button, Card, ErrorMessage, Heading, Input, Label, Muted, number, Page, ui } from '../../src/ui/components/primitives';
import { macroColors } from '../../src/ui/tokens';
export default function Progress() {
  const { controller } = useAppRuntime();
  const revision = controller.getRevision();
  const [range, setRange] = useState(7);
  const [weight, setWeight] = useState('');
  const action = useAction();
  const result = useAsyncResource(useCallback(() => { void revision; return controller.progress(range); }, [controller, range, revision]));
  const value = result.value;
  const latest = value?.trend[value.trend.length - 1];
  return <Page title="Progress"><View style={ui.wrap}>{[7, 30].map(days => <Button key={days} label={`${days}d`} selected={range === days} onPress={() => setRange(days)} />)}</View>
    <ErrorMessage message={result.error ?? action.error} /><Card><Heading>Daily averages</Heading>
      <Label style={ui.number}>{number(value?.averages?.kcal)} kcal</Label>
      <View style={ui.wrap}>{([['P', 'protein_g', macroColors.protein], ['C', 'carbs_g', macroColors.carbs], ['F', 'fat_g', macroColors.fat]] as const).map(([label, key, color]) =>
        <Label key={key} style={{ ...ui.number, color }}>{label} {number(value?.averages?.[key], 1)} g</Label>)}</View>
      <Label style={ui.number}>Fiber {number(value?.averages?.fiber_g, 1)} g{value?.unknownCount.fiber_g ? ` · ${value.unknownCount.fiber_g} unknown` : ''}</Label>
      <Muted>{value?.completeDays ?? '—'} complete days · {value?.excludedDays ?? '—'} excluded</Muted>
      <Muted>Partial and unlogged days are excluded from averages, never counted as zero.</Muted>
    </Card><Card><Heading>Weight trend</Heading><Label style={ui.number}>{number(latest?.trendKg, 1)} kg</Label>
      <Muted>EWMA · α = 0.10{latest ? ` · last measured ${latest.weighIn.date}` : ' · no weigh-ins yet'}</Muted>
      <Input label="Manual weigh-in (kg)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
      <Button label="Record weigh-in" primary disabled={action.busy} onPress={() => void action.run(async () => {
        if (!weight.trim()) throw new Error('Enter your weight in kg');
        await controller.weighIn(Number(weight)); setWeight('');
      })} />
    </Card></Page>;
}
