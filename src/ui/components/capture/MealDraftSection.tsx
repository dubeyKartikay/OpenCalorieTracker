import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAction, useActiveDraft, useAIStatus, useAppRuntime } from '../../../app/AppRuntimeContext';
import { sumNutrients, type DiaryEntrySnapshot, type OfflinePhotoDraft } from '../../../domain';
import { colors, fontFace, macroColors, radius, tabularNums } from '../../tokens';
import { Button, energyValue, ErrorMessage, number, ui } from '../primitives';
import { AIFailedCard, DraftAskChips, DraftItemCard, MealDraftPanel } from './DraftCards';
import type { MealInlineComposerController } from './MealInlineComposer';

export function isDraftForMeal(
  draft: ReturnType<typeof useActiveDraft>['draft'],
  meal: string,
  date: string,
): boolean {
  return Boolean(draft && draft.meal === meal && draft.date === date);
}

export interface MealActiveDraftBlockProps {
  meal: string;
  date: string;
  entries: DiaryEntrySnapshot[];
  energyUnit: 'kcal' | 'kJ';
  blocked: boolean;
  onConfirmed?: ((meal: string) => void) | undefined;
  onSavedAsMeal: (name: string) => void;
}

/** Shared MealDraftPanel renderer for both Today and History tabs. */
export function MealActiveDraftBlock({
  meal,
  date,
  entries,
  energyUnit,
  blocked,
  onConfirmed,
  onSavedAsMeal,
}: MealActiveDraftBlockProps) {
  const activeDraft = useActiveDraft();
  const action = useAction();
  const draft = activeDraft.draft;
  if (!draft || !isDraftForMeal(draft, meal, date)) return null;

  const draftError = activeDraft.actionError
    && activeDraft.actionError.operation === 'draft'
    && activeDraft.actionError.meal === meal
    && activeDraft.actionError.date === date
    ? activeDraft.actionError.message
    : null;

  const photoUri = activeDraft.photoUri
    ?? (activeDraft.lastCapture?.meal === meal && activeDraft.lastCapture?.date === date ? activeDraft.lastCapture.imageDataUrl : null);

  return (
    <MealDraftPanel
      mealLabel={meal}
      loggedEnergyText={entries.length ? number(energyValue(sumNutrients(entries).nutrients?.kcal, energyUnit)) : '—'}
      draftEnergyText={number(energyValue(draft.proposal.totals.nutrients?.kcal, energyUnit))}
      photoUri={photoUri}
      itemCount={draft.proposal.items.length}
      confirming={blocked || action.busy}
      onConfirmAll={() => {
        void activeDraft.confirmAll().then(confirmed => {
          if (confirmed) onConfirmed?.(meal);
        });
      }}
      onDismissAll={() => activeDraft.discard()}
      onSaveAsMeal={name => void action.run(async () => {
        const saved = await activeDraft.saveAsMeal(name);
        onSavedAsMeal(saved.name);
      })}
    >
      {draft.proposal.items.map((item, itemIndex) => (
        <DraftItemCard
          key={`${itemIndex}:${item.food.id}`}
          name={item.food.name}
          sourceLabel={item.sourceLabel}
          isEstimatedSource={item.provenance_kind === 'ai_estimate'}
          portionText={`${number(item.quantity.amount, 2)} ${item.quantity.unit} · ${item.portion_certainty === 'stated' ? 'you said' : 'estimate'}`}
          portionCertainty={item.portion_certainty}
          estimateRangeText={item.estimate_range ? `${number(item.quantity.amount, 2)} ${item.quantity.unit} · est. ${number(item.estimate_range.min_g, 1)}–${number(item.estimate_range.max_g, 1)} g` : null}
          energyText={number(energyValue(item.nutrients.kcal, energyUnit))}
          macrosText={`P ${number(item.nutrients.protein_g, 1)} · C ${number(item.nutrients.carbs_g, 1)} · F ${number(item.nutrients.fat_g, 1)} g`}
          fiberUnknown={item.unknownCount.fiber_g > 0}
          currentAmount={item.quantity.amount}
          currentUnit={item.quantity.unit}
          {...(!blocked ? {
            onRemove: () => activeDraft.removeItem(String(itemIndex)),
            onChangeAmount: (amount: number) => activeDraft.updateItemQuantity(itemIndex, { ...item.quantity, amount }),
          } : {})}
        />
      ))}
      <View style={styles.macroSummary}>
        {([
          ['P', draft.proposal.totals.nutrients?.protein_g, macroColors.protein],
          ['C', draft.proposal.totals.nutrients?.carbs_g, macroColors.carbs],
          ['F', draft.proposal.totals.nutrients?.fat_g, macroColors.fat],
          ['Fiber', draft.proposal.totals.nutrients?.fiber_g, colors.muted],
        ] as const).map(([label, value, color]) => (
          <View key={label} style={styles.macroPill}>
            <View style={[styles.macroDot, { backgroundColor: color }]} />
            <Text style={styles.resultMeta}>{label}</Text>
            <Text style={styles.macroValue}>
              {value != null ? `+${number(value)} g` : '—'}
            </Text>
          </View>
        ))}
        {draft.proposal.totals.unknownCount.fiber_g > 0 && (
          <Text style={styles.resultMeta}>· {draft.proposal.totals.unknownCount.fiber_g} fiber unknown</Text>
        )}
      </View>
      {draft.proposal.clarifying_questions.slice(0, 2).map(question => (
        <DraftAskChips
          key={question.id}
          questionId={question.id}
          label={question.label}
          options={question.options.map(option => ({
            id: option.id,
            label: option.label,
            selected: draft.proposal.answers[question.id] === option.id,
          }))}
          onSelect={(questionId, optionId) => {
            if (!blocked) void activeDraft.answerQuestion(questionId, optionId);
          }}
        />
      ))}
      <ErrorMessage message={action.error ?? draftError} />
    </MealDraftPanel>
  );
}

export interface MealDraftAuxBlockProps {
  meal: string;
  date: string;
  blocked: boolean;
  composer: MealInlineComposerController;
  offlinePhotos: OfflinePhotoDraft[] | undefined;
}

/** Shared AI failure retry card + offline saved photo drafts for a meal/date slot. */
export function MealDraftAuxBlock({ meal, date, blocked, composer, offlinePhotos }: MealDraftAuxBlockProps) {
  const { controller } = useAppRuntime();
  const ai = useAIStatus();
  const activeDraft = useActiveDraft();
  const action = useAction();

  const captureError = activeDraft.actionError
    && activeDraft.actionError.operation === 'capture'
    && activeDraft.actionError.meal === meal
    && activeDraft.actionError.date === date
    ? activeDraft.actionError.message
    : null;
  const retryInput = activeDraft.lastCapture?.meal === meal && activeDraft.lastCapture?.date === date
    ? activeDraft.lastCapture
    : null;
  const photos = (offlinePhotos ?? []).filter(saved => saved.meal === meal && saved.date === date);
  const busy = blocked || action.busy;

  return (
    <>
      {captureError ? (
        <AIFailedCard
          mealLabel={meal}
          reasonText={captureError}
          {...(retryInput ? { onRetry: () => composer.capture(retryInput) } : {})}
          onSearchInstead={() => composer.openField(meal)}
          onQuickAdd={() => composer.openField(meal, true)}
          onDismiss={activeDraft.clearError}
        />
      ) : null}
      {photos.map(saved => (
        <View key={saved.id} style={styles.offlineDraft}>
          <View style={styles.attachment}>
            <Image source={{ uri: saved.image_data_url }} accessibilityLabel={`Saved photo for ${saved.meal}`} style={styles.photo} />
            <View style={styles.resultCopy}>
              <Text style={styles.resultName}>{meal} · photo draft</Text>
              <Text style={styles.resultMeta}>{saved.note || 'Saved on this device'}</Text>
            </View>
          </View>
          <View style={ui.wrap}>
            <Button
              label="Analyze now"
              quiet
              disabled={busy || ai.loading || !ai.value}
              onPress={() => {
                if (ai.value?.mode === 'disconnected' || !ai.value?.consentAccepted) {
                  router.push('/chatgpt');
                  return;
                }
                void action.run(async () => {
                  const analyzed = await activeDraft.capture({
                    text: saved.note,
                    imageDataUrl: saved.image_data_url,
                    meal: saved.meal,
                    date: saved.date,
                  });
                  if (analyzed) await controller.deleteOfflinePhotoDraft(saved.id);
                });
              }}
            />
            <Button
              label="Discard"
              quiet
              disabled={busy}
              onPress={() => void action.run(() => controller.deleteOfflinePhotoDraft(saved.id))}
            />
          </View>
        </View>
      ))}
      <ErrorMessage message={action.error} />
    </>
  );
}

const styles = StyleSheet.create({
  resultCopy: { flex: 1, minWidth: 0, gap: 2, paddingVertical: 6 },
  resultName: { ...fontFace('semibold'), color: colors.ink, fontSize: 14 },
  resultMeta: { ...fontFace('medium'), color: colors.muted, fontSize: 11 },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  photo: { width: 48, height: 48, borderRadius: radius.r12, borderWidth: 1, borderColor: colors.border },
  offlineDraft: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.r12, marginVertical: 8, paddingHorizontal: 10 },
  macroSummary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, borderStyle: 'dashed' },
  macroPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  macroDot: { width: 6, height: 6, borderRadius: 3 },
  macroValue: { ...fontFace('semibold'), fontVariant: [...tabularNums.fontVariant], color: colors.lavender, fontSize: 11 },
});
