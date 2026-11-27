import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Dimensions, Image, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useAction, useActiveDraft, useAIStatus, useAppRuntime, useCatalogSearch, usePreferences } from '../../../app/AppRuntimeContext';
import { defaultQuantity } from '../../../app/controller';
import { calculateNutrition, generateId, type FoodRecord } from '../../../domain';
import type { SearchCandidate } from '../../../catalog';
import { paginateList } from '../../format';
import { hapticSelection, hapticSuccess } from '../../haptics';
import { colors, fontFace, macroColors, radius, tabularNums } from '../../tokens';
import { formatQuantityLabel } from '../customUnitMath';
import { computeScrollTargetAboveKeyboard } from '../keyboardScrollMath';
import { InlineKeypad } from '../doop/InlineKeypad';
import { RevealPanel } from '../doop/Motion';
import { DoopIcon, inferFoodGlyph } from '../DoopIcons';
import { Button, energyValue, ErrorMessage, Muted, number, toCanonicalKcal } from '../primitives';
import { SparklePromptRow } from './DraftCards';
import { consumePendingMealPhoto } from './pendingMealPhoto';
import type { PickedMealImage } from './PhotoPicker';
import { useVoiceDictation, VoiceDock, VoiceMicRing } from './VoiceDock';

type QuickField = 'kcal' | 'protein' | 'carbs' | 'fat';
type QuickValues = Record<QuickField, string>;
const emptyQuick = (): QuickValues => ({ kcal: '', protein: '', carbs: '', fat: '' });
const isNumeric = (value: string) => /^\d*\.?\d*$/.test(value.trim()) && /\d/.test(value);
const parsed = (value: string) => value.trim() === '' ? null : Number(value);

export interface UseMealInlineComposerOptions {
  date: string;
  returnTab: 'today' | 'history';
  defaultMeal: string;
  onLogged?: (meal: string) => void;
  onNotice?: (message: string) => void;
  onTargetDateChange?: (date: string) => void;
}

export function useMealInlineComposer({
  date,
  returnTab,
  defaultMeal,
  onLogged,
  onNotice,
  onTargetDateChange,
}: UseMealInlineComposerOptions) {
  const { controller } = useAppRuntime();
  const preferences = usePreferences();
  const action = useAction();
  const ai = useAIStatus();
  const activeDraft = useActiveDraft();

  const [fieldMeal, setFieldMeal] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<PickedMealImage | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState<QuickValues>(emptyQuick);
  const [selected, setSelected] = useState<QuickField>('protein');
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);

  const unit = preferences.value?.energyUnit ?? 'kcal';
  const typingNumber = isNumeric(description);
  const showQuick = !!fieldMeal && (quickOpen || typingNumber);
  const liveQuery = fieldMeal && !typingNumber ? description.trim() : '';
  const search = useCatalogSearch(liveQuery);
  const searchPending = Boolean(liveQuery) && (search.debouncing || search.loading);
  const localMatches = liveQuery && search.value ? [...search.value.yours, ...search.value.database] : [];
  const blocked = action.busy || activeDraft.busy;

  useEffect(() => { if (showQuick) Keyboard.dismiss(); }, [showQuick]);

  const changeDescription = (value: string) => {
    setDescription(value);
    onNotice?.('');
    if (isNumeric(value)) {
      setQuickOpen(true);
      setSelected('kcal');
      setQuick(old => ({ ...old, kcal: value.trim() }));
    } else if (value.trim()) {
      setQuickOpen(false);
      setQuick(old => ({ ...old, kcal: '' }));
    } else {
      setQuick(old => ({ ...old, kcal: '' }));
    }
  };

  const voiceSession = useVoiceDictation({
    onText: changeDescription,
    onError: message => onNotice?.(message),
  });

  const closeField = useCallback(() => {
    voiceSession.cancel();
    setFieldMeal(null);
    setDescription('');
    setPhoto(null);
    setQuickOpen(false);
    setQuick(emptyQuick());
    onNotice?.('');
    Keyboard.dismiss();
  }, [onNotice, voiceSession]);

  const openField = useCallback((meal = defaultMeal, quickAdd = false) => {
    voiceSession.cancel();
    setFieldMeal(meal);
    setDescription('');
    setPhoto(null);
    setQuickOpen(quickAdd);
    setQuick(emptyQuick());
    setSelected(quickAdd ? 'kcal' : 'protein');
    onNotice?.('');
    activeDraft.clearError();
  }, [activeDraft, defaultMeal, onNotice, voiceSession]);

  const changeQuick = (value: string) => {
    setQuick(old => ({ ...old, [selected]: value }));
    if (selected === 'kcal') setDescription(value);
  };

  const capture = (captureInput?: Parameters<typeof activeDraft.capture>[0]) => {
    const resolvedInput = captureInput ?? {
      text: description,
      ...(photo ? { imageDataUrl: photo.imageDataUrl } : {}),
      meal: fieldMeal ?? defaultMeal,
      date,
    };
    if (!ai.value || ai.loading || blocked) return;
    if (ai.value.mode === 'disconnected' || !ai.value.consentAccepted) {
      router.push('/chatgpt');
      return;
    }
    voiceSession.stop();
    Keyboard.dismiss();
    void activeDraft.capture(resolvedInput).then(proposal => {
      if (proposal) {
        closeField();
      }
    });
  };

  const openCamera = (meal: string) => {
    voiceSession.cancel();
    router.push({ pathname: '/barcode', params: { meal, date, mode: 'photo', returnTo: returnTab } });
  };

  const openBarcode = (meal: string) => {
    voiceSession.cancel();
    router.push({ pathname: '/barcode', params: { meal, date, mode: 'barcode', returnTo: returnTab } });
  };

  const cancelVoice = voiceSession.cancel;
  useFocusEffect(useCallback(() => {
    const pending = consumePendingMealPhoto(returnTab);
    if (pending) {
      if (pending.date && pending.date !== date) {
        onTargetDateChange?.(pending.date);
      }
      setFieldMeal(current => {
        if (current !== pending.meal) {
          setDescription('');
          setQuickOpen(false);
          setQuick(emptyQuick());
          setSelected('protein');
        }
        return pending.meal;
      });
      setPhoto(pending.photo);
      onNotice?.('');
    }
    return () => {
      cancelVoice();
    };
  }, [cancelVoice, date, onNotice, onTargetDateChange, returnTab]));

  const voice = (meal: string) => {
    if (voiceSession.active && fieldMeal === meal) {
      voiceSession.stop();
      return;
    }
    const existing = fieldMeal === meal && !typingNumber ? description : '';
    if (fieldMeal !== meal) {
      setFieldMeal(meal);
      setDescription('');
      setPhoto(null);
      setQuickOpen(false);
      setQuick(emptyQuick());
      setSelected('protein');
      activeDraft.clearError();
    } else if (typingNumber) {
      setDescription('');
    }
    setQuickOpen(false);
    onNotice?.('');
    void voiceSession.start(existing);
  };

  const logFood = (food: FoodRecord, meal: string) => void action.run(async () => {
    await controller.confirm({ food, quantity: defaultQuantity(food), meal, date, idempotencyKey: generateId() });
    hapticSuccess();
    closeField();
    onLogged?.(meal);
  });

  const logQuick = () => {
    const kcalValue = parsed(quick.kcal);
    if (!fieldMeal || kcalValue == null || !Number.isFinite(kcalValue) || kcalValue <= 0) return;
    const destination = fieldMeal;
    void action.run(async () => {
      await controller.quickAdd({
        kcal: toCanonicalKcal(kcalValue, unit),
        proteinG: parsed(quick.protein),
        carbsG: parsed(quick.carbs),
        fatG: parsed(quick.fat),
        meal: destination,
        date,
        idempotencyKey: generateId(),
      });
      hapticSuccess();
      closeField();
      onLogged?.(destination);
    });
  };

  const saveOfflinePhoto = (meal: string) => {
    if (!photo) return;
    void action.run(async () => {
      await controller.saveOfflinePhotoDraft({ meal, note: description, imageDataUrl: photo.imageDataUrl, date });
      hapticSuccess();
      closeField();
      onNotice?.('Photo draft saved on this device.');
    });
  };

  const collapseQuick = () => {
    voiceSession.cancel();
    setQuickOpen(false);
    setDescription('');
    setSelected('kcal');
  };

  return {
    date,
    unit,
    fieldMeal,
    description,
    photo,
    setPhoto,
    quickOpen,
    quick,
    selected,
    setSelected,
    showQuick,
    liveQuery,
    search,
    searchPending,
    localMatches,
    blocked,
    ai,
    action,
    activeDraft,
    voiceSession,
    inputRef,
    openField,
    closeField,
    changeDescription,
    changeQuick,
    capture,
    openCamera,
    openBarcode,
    voice,
    logFood,
    logQuick,
    saveOfflinePhoto,
    collapseQuick,
  };
}

export type MealInlineComposerController = ReturnType<typeof useMealInlineComposer>;

const RESULTS_PER_PAGE = 4;
const RESULT_ROW_HEIGHT = 52;
const PAGER_BODY_HEIGHT = RESULTS_PER_PAGE * RESULT_ROW_HEIGHT;
const PAGER_FOOTER_HEIGHT = 36;
const SPARKLE_SLOT_HEIGHT = 44;
const MAX_VISIBLE_DOTS = 7;

/** Scrolls a mounted node to the top of its parent ScrollView when activated or when the keyboard opens. */
export function useScrollNodeIntoView(
  scrollRef: RefObject<ComponentRef<typeof ScrollView> | null> | undefined,
  scrollOffsetRef: RefObject<number> | undefined,
  getNode: () => ComponentRef<typeof View> | null | undefined,
  activeKey: string | null,
) {
  useEffect(() => {
    if (!activeKey || !scrollRef) return;
    const scrollToNode = () => {
      const scrollNode = scrollRef.current;
      const targetNode = getNode();
      if (!scrollNode || !targetNode) return;
      scrollNode.measureInWindow((_sx, scrollY) => {
        targetNode.measureInWindow((_rx, nodeY) => {
          const targetY = (scrollOffsetRef?.current ?? 0) + (nodeY - scrollY) - 8;
          scrollNode.scrollTo({ y: Math.max(0, targetY), animated: true });
        });
      });
    };
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleScroll = (delayMs: number) => {
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        scrollToNode();
      }, delayMs);
    };
    scheduleScroll(140);
    const sub = Keyboard.addListener('keyboardDidShow', () => scheduleScroll(90));
    return () => {
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      sub.remove();
    };
  }, [activeKey, getNode, scrollOffsetRef, scrollRef]);
}

/**
 * Returns a callback that keeps any focused form/input node cleanly above the
 * active soft keyboard (and re-adjusts automatically whenever the keyboard
 * opens or resizes).
 */
export function useScrollAboveKeyboard(
  scrollRef: RefObject<ComponentRef<typeof ScrollView> | null>,
  scrollOffsetRef: RefObject<number>,
) {
  const activeNodeRef = useRef<ComponentRef<typeof View> | null>(null);
  const keyboardHeightRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const measureAndScroll = useCallback((explicitKeyboardHeight?: number) => {
    const scrollNode = scrollRef.current;
    const targetNode = activeNodeRef.current;
    if (!scrollNode || !targetNode) return;
    const kbHeight = explicitKeyboardHeight ?? keyboardHeightRef.current;
    const windowHeight = Dimensions.get('window').height;
    scrollNode.measureInWindow((_sx, scrollY, _sw, scrollH) => {
      targetNode.measureInWindow((_nx, nodeY, _nw, nodeH) => {
        const nextY = computeScrollTargetAboveKeyboard({
          currentScrollY: scrollOffsetRef.current ?? 0,
          scrollViewTop: scrollY,
          scrollViewHeight: scrollH,
          nodeTop: nodeY,
          nodeHeight: nodeH,
          windowHeight,
          keyboardHeight: kbHeight,
        });
        if (nextY !== null) {
          scrollNode.scrollTo({ y: nextY, animated: true });
        }
      });
    });
  }, [scrollOffsetRef, scrollRef]);

  const scheduleMeasure = useCallback((delayMs: number, explicitKeyboardHeight?: number) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      measureAndScroll(explicitKeyboardHeight);
    }, delayMs);
  }, [measureAndScroll]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, event => {
      const h = event.endCoordinates?.height ?? 0;
      keyboardHeightRef.current = h;
      // Wait for React to commit the increased ScrollView paddingBottom before measuring & scrolling.
      scheduleMeasure(90, h);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardHeightRef.current = 0;
      activeNodeRef.current = null;
    });
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      showSub.remove();
      hideSub.remove();
    };
  }, [scheduleMeasure]);

  return useCallback((node: ComponentRef<typeof View> | null) => {
    activeNodeRef.current = node;
    if (node) {
      scheduleMeasure(keyboardHeightRef.current > 0 ? 70 : 180);
    }
  }, [scheduleMeasure]);
}

/** Shared scroll-to-active-meal effect used by Today and History when opening the inline composer. */
export function useScrollToMealComposer(
  scrollRef: RefObject<ComponentRef<typeof ScrollView> | null>,
  scrollOffsetRef: RefObject<number>,
  mealRowRefs: RefObject<Record<string, ComponentRef<typeof View> | null>>,
  composer: MealInlineComposerController,
) {
  const activeMeal = composer.fieldMeal;
  const getNode = useCallback(
    () => (activeMeal ? mealRowRefs.current?.[activeMeal] : null),
    [activeMeal, mealRowRefs],
  );
  useScrollNodeIntoView(scrollRef, scrollOffsetRef, getNode, activeMeal);
}

/** Quiet Doop-style geometric line mark for the reserved results pane before typing. */
function ComposerEmptyArtwork() {
  return (
    <View style={styles.emptyArtwork} pointerEvents="none" accessible={false}>
      <Svg width={132} height={116} viewBox="0 0 132 116">
        <Circle cx={66} cy={58} r={46} fill="none" stroke={colors.border} strokeWidth={1} strokeDasharray="3 5" strokeOpacity={0.34} />
        <Circle cx={66} cy={58} r={28} fill="none" stroke={colors.border} strokeWidth={1} strokeOpacity={0.28} />
        <Circle cx={66} cy={58} r={17} fill="none" stroke={colors.accent} strokeWidth={1} strokeOpacity={0.22} />
        <Line x1={32} y1={43} x2={32} y2={73} stroke={colors.muted} strokeWidth={1.1} strokeLinecap="round" strokeOpacity={0.24} />
        <Path d="M29 43v8a3 3 0 0 0 6 0v-8" fill="none" stroke={colors.muted} strokeWidth={1.1} strokeLinecap="round" strokeOpacity={0.24} />
        <Path d="M100 43v30M100 43c2.8 0 4.2 3.2 4.2 9.5 0 3.2-1.4 5.5-4.2 5.5" fill="none" stroke={colors.muted} strokeWidth={1.1} strokeLinecap="round" strokeOpacity={0.24} />
        <Path d="M97 22l1.4 3.6 3.6 1.4-3.6 1.4-1.4 3.6-1.4-3.6-3.6-1.4 3.6-1.4Z" fill={colors.lavender} fillOpacity={0.32} />
        <Circle cx={33} cy={88} r={1.8} fill={colors.accent} fillOpacity={0.28} />
      </Svg>
    </View>
  );
}

export interface LocalFoodSearchPagerProps {
  query: string;
  candidates: SearchCandidate[];
  pending: boolean;
  error?: string | null | undefined;
  energyUnit: 'kcal' | 'kJ';
  disabled?: boolean | undefined;
  emptyMessage?: string | undefined;
  addLabel: (food: FoodRecord) => string;
  onAdd: (food: FoodRecord) => void;
  onInspect?: ((food: FoodRecord) => void) | undefined;
  inspectLabel?: ((food: FoodRecord) => string) | undefined;
}

/** Fixed-height swipe-paginated local food results tray shared by Today, History, and Recipe ingredient search. */
export function LocalFoodSearchPager({
  query,
  candidates,
  pending,
  error,
  energyUnit,
  disabled = false,
  emptyMessage = 'No local matches.',
  addLabel,
  onAdd,
  onInspect,
  inspectLabel,
}: LocalFoodSearchPagerProps) {
  const pagerRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [pageState, setPageState] = useState({ query, page: 0 });
  const pages = useMemo(() => paginateList(candidates, RESULTS_PER_PAGE), [candidates]);
  const pageCount = pages.length;
  const currentPage = pageState.query === query ? Math.min(pageState.page, Math.max(0, pageCount - 1)) : 0;

  useEffect(() => {
    pagerRef.current?.scrollTo({ x: 0, animated: false });
  }, [query]);

  const goToPage = (nextPage: number) => {
    const clamped = Math.max(0, Math.min(pageCount - 1, nextPage));
    setPageState({ query, page: clamped });
    if (pageWidth > 0) {
      pagerRef.current?.scrollTo({ x: clamped * pageWidth, animated: true });
    }
  };

  const dotWindowStart = pageCount <= MAX_VISIBLE_DOTS
    ? 0
    : Math.max(0, Math.min(currentPage - Math.floor(MAX_VISIBLE_DOTS / 2), pageCount - MAX_VISIBLE_DOTS));
  const dotIndices = Array.from(
    { length: Math.min(pageCount, MAX_VISIBLE_DOTS) },
    (_, offset) => dotWindowStart + offset,
  );
  const visiblePages = pageWidth > 0 ? pages : pages.slice(0, 1);

  return (
    <View
      style={styles.resultsBox}
      onLayout={event => {
        const nextWidth = Math.round(event.nativeEvent.layout.width);
        if (nextWidth > 0 && nextWidth !== pageWidth) setPageWidth(nextWidth);
      }}
    >
      <View style={styles.resultsBody}>
        {error ? (
          <View style={styles.resultsState}>
            <ErrorMessage message={error} />
          </View>
        ) : !query ? (
          <ComposerEmptyArtwork />
        ) : pending && pageCount === 0 ? (
          <View style={styles.resultsState}>
            <Muted>Searching foods…</Muted>
          </View>
        ) : pageCount === 0 ? (
          <View style={styles.resultsState}>
            <Muted>{emptyMessage}</Muted>
          </View>
        ) : (
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
            pointerEvents={pending ? 'none' : 'auto'}
            onScroll={event => {
              if (pageWidth <= 0) return;
              const next = Math.max(0, Math.min(pageCount - 1, Math.round(event.nativeEvent.contentOffset.x / pageWidth)));
              if (next !== currentPage) setPageState({ query, page: next });
            }}
            style={[styles.pagerScroll, pending && styles.pagerDimmed]}
          >
            {visiblePages.map((pageItems, pageIndex) => (
              <View key={pageIndex} style={[styles.pagerPage, pageWidth > 0 ? { width: pageWidth } : styles.pagerPageFull]}>
                {pageItems.map(candidate => {
                  const portion = defaultQuantity(candidate.food);
                  const nutrients = calculateNutrition(candidate.food, portion);
                  const portionText = formatQuantityLabel(portion, candidate.food);
                  return (
                    <View key={`${candidate.food.source_pack_id ?? 'yours'}:${candidate.food.id}`} style={styles.result}>
                      <DoopIcon name={inferFoodGlyph(candidate.food.name)} size={18} color={colors.muted} />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={onInspect ? (inspectLabel?.(candidate.food) ?? candidate.food.name) : addLabel(candidate.food)}
                        disabled={disabled || pending}
                        style={styles.resultCopy}
                        onPress={() => (onInspect ? onInspect(candidate.food) : onAdd(candidate.food))}
                      >
                        <Text numberOfLines={1} style={styles.resultName}>{candidate.food.name}</Text>
                        <Text numberOfLines={1} style={styles.resultMeta}>{candidate.sourceLabel} · {portionText}</Text>
                      </Pressable>
                      <Text style={styles.resultEnergy}>{number(energyValue(nutrients.kcal, energyUnit))}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={addLabel(candidate.food)}
                        disabled={disabled || pending}
                        onPress={() => onAdd(candidate.food)}
                        style={styles.smallAdd}
                      >
                        <DoopIcon name="plus" size={14} color={colors.muted} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
      <View style={styles.pagerFooter}>
        {query && !pending && pageCount > 0 ? (
          <>
            <Text style={styles.pagerMeta}>{`${candidates.length} ${candidates.length === 1 ? 'match' : 'matches'}`}</Text>
            {pageCount > 1 ? (
              <>
                <View style={styles.pagerDots}>
                  {dotIndices.map(index => (
                    <View key={index} style={[styles.pagerDot, index === currentPage && styles.pagerDotActive]} />
                  ))}
                </View>
                <View style={styles.pagerNav}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Previous results page"
                    accessibilityState={{ disabled: currentPage === 0 }}
                    disabled={currentPage === 0}
                    onPress={() => goToPage(currentPage - 1)}
                    style={[styles.pagerNavBtn, currentPage === 0 && styles.pagerNavDisabled]}
                  >
                    <DoopIcon name="chevronLeft" size={14} color={colors.muted} />
                  </Pressable>
                  <Text style={styles.pagerCount}>{`${currentPage + 1}/${pageCount}`}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Next results page"
                    accessibilityState={{ disabled: currentPage >= pageCount - 1 }}
                    disabled={currentPage >= pageCount - 1}
                    onPress={() => goToPage(currentPage + 1)}
                    style={[styles.pagerNavBtn, currentPage >= pageCount - 1 && styles.pagerNavDisabled]}
                  >
                    <DoopIcon name="chevronRight" size={14} color={colors.muted} />
                  </Pressable>
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

export function MealComposerField({ composer, meal }: { composer: MealInlineComposerController; meal: string }) {
  const {
    date,
    unit,
    description,
    photo,
    setPhoto,
    quickOpen,
    quick,
    selected,
    setSelected,
    showQuick,
    liveQuery,
    search,
    searchPending,
    localMatches,
    blocked,
    ai,
    action,
    activeDraft,
    voiceSession,
    inputRef,
    closeField,
    changeDescription,
    capture,
    openCamera,
    openBarcode,
    voice,
    logFood,
    logQuick,
    saveOfflinePhoto,
    collapseQuick,
  } = composer;

  return <RevealPanel visible direction="down">
    <View style={styles.fieldRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Close ${meal} input`} disabled={blocked} onPress={closeField} style={[styles.circle, styles.closeCircle]}><DoopIcon name="close" size={15} color={colors.muted} /></Pressable>
      {photo && (
        <Pressable accessibilityRole="button" accessibilityLabel="Remove attached photo" disabled={blocked} onPress={() => setPhoto(null)} style={styles.inlineThumbWrap}>
          <Image source={{ uri: photo.uri }} accessibilityLabel="Attached meal photo" style={styles.inlineThumb} />
        </Pressable>
      )}
      <TextInput
        ref={inputRef}
        autoFocus={!quickOpen && !voiceSession.active && !photo}
        accessibilityLabel={`Add food to ${meal}`}
        placeholder={meal}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        value={description}
        onChangeText={changeDescription}
        editable={!blocked}
        showSoftInputOnFocus={!showQuick && !voiceSession.active}
        onPressIn={() => { if (voiceSession.active) voiceSession.stop(); }}
        onFocus={() => { if (showQuick) setSelected('kcal'); }}
        style={styles.mealInput}
        onSubmitEditing={() => { if (showQuick) logQuick(); else if (description.trim() || photo) capture(); }}
        returnKeyType="done"
      />
      <View style={styles.fieldActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open camera for meal photo or barcode" disabled={blocked} onPress={() => openCamera(meal)} onLongPress={() => openBarcode(meal)} style={styles.circle}><DoopIcon name="camera" size={19} color={colors.muted} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={voiceSession.active ? 'Stop voice dictation' : 'Dictate meal by voice'} accessibilityState={{ selected: voiceSession.active }} disabled={blocked} onPress={() => voice(meal)} style={[styles.circle, voiceSession.active && styles.micActive]}><VoiceMicRing active={voiceSession.active} size={40} borderRadius={20} /><DoopIcon name="mic" size={18} color={voiceSession.active ? colors.onAccent : colors.muted} /></Pressable>
      </View>
    </View>

    {!showQuick && (
      <View style={styles.typing}>
        <View style={styles.sparkleSlot}>
          {description.trim() || photo ? (
            <SparklePromptRow
              summary={ai.value?.mode !== 'disconnected' && ai.value?.consentAccepted ? description.trim() || 'Draft this photo' : 'Connect ChatGPT to draft this meal'}
              busy={activeDraft.busy}
              disabled={action.busy || ai.loading || !ai.value}
              onPress={() => capture()}
            />
          ) : (
            <View style={styles.sparkleHint}>
              <DoopIcon name="sparkle" size={15} color={colors.muted} />
              <Text numberOfLines={1} style={styles.sparkleHintText}>Type a food, describe a meal, or enter calories</Text>
            </View>
          )}
        </View>
        <LocalFoodSearchPager
          query={liveQuery}
          candidates={localMatches}
          pending={searchPending}
          error={search.error ?? ai.error}
          energyUnit={unit}
          disabled={blocked}
          emptyMessage="No local matches. Draft with AI or type calories."
          addLabel={food => `Add ${food.name} to ${meal}`}
          onAdd={food => logFood(food, meal)}
          inspectLabel={food => `Review ${food.name} in Library`}
          onInspect={food => router.push({ pathname: '/(tabs)/library', params: { meal, date, q: food.name } })}
        />
      </View>
    )}

    <RevealPanel visible={showQuick} direction="down">
      <View style={styles.quickHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close quick add" accessibilityState={{ expanded: true }} onPress={collapseQuick} style={styles.quickToggle}>
          <Text style={styles.quickLabel}>Quick add</Text>
          <View style={{ transform: [{ rotate: '180deg' }] }}><DoopIcon name="chevronDown" size={12} color={colors.muted} /></View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit energy in ${unit}`} onPress={() => { hapticSelection(); setSelected('kcal'); }} style={styles.quickEnergyButton}>
          <Text style={styles.quickEnergy}>{quick.kcal || '—'}<Text style={styles.quickUnit}> {unit}</Text></Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Log quick add to ${meal}`} disabled={blocked || !quick.kcal || !Number.isFinite(Number(quick.kcal)) || Number(quick.kcal) <= 0} onPress={logQuick} style={styles.quickAdd}><DoopIcon name="plus" size={17} color={colors.muted} /></Pressable>
      </View>
      <View style={styles.macroCells}>{([
        ['P', 'protein', macroColors.protein], ['C', 'carbs', macroColors.carbs], ['F', 'fat', macroColors.fat],
      ] as const).map(([label, key, color], index) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={`Edit ${key}, ${quick[key] || 'unknown'} grams`} accessibilityState={{ selected: selected === key }} onPress={() => { hapticSelection(); setSelected(key); }} style={[styles.macroCell, index > 0 && styles.macroCellDivider, selected === key && styles.macroCellActive]}>
        <Text style={[styles.macroKey, { color }]}>{label}</Text>
        <Text style={styles.macroValue}>{quick[key] || '—'}<Text style={styles.macroUnit}> g</Text></Text>
      </Pressable>)}</View>
    </RevealPanel>

    <RevealPanel visible={!!photo} direction="down" style={styles.fieldOptions}>
      <Button label="Save offline" quiet disabled={blocked} onPress={() => saveOfflinePhoto(meal)} />
    </RevealPanel>
  </RevealPanel>;
}

export function MealComposerFooter({ composer }: { composer: MealInlineComposerController }) {
  const { voiceSession, showQuick, quick, selected, changeQuick } = composer;
  return <>
    <VoiceDock visible={voiceSession.active} level={voiceSession.level} onStop={voiceSession.stop} />
    <RevealPanel visible={!voiceSession.active && showQuick} direction="up">
      <View style={styles.keypad} accessibilityLabel="Quick add numeric keypad">
        <InlineKeypad
          bare
          showReadout={false}
          value={quick[selected]}
          onChange={changeQuick}
          maxDecimals={2}
          maxLength={8}
          allowEmpty
        />
      </View>
    </RevealPanel>
  </>;
}

const styles = StyleSheet.create({
  fieldRow: { height: 56, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  circle: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  inlineThumbWrap: { width: 32, height: 32, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  inlineThumb: { width: 32, height: 32 },
  micActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  closeCircle: { backgroundColor: 'rgba(192,202,245,0.10)' },
  mealInput: { ...fontFace('semibold'), flex: 1, minWidth: 0, height: 44, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.r12, backgroundColor: colors.dock, paddingHorizontal: 9, paddingVertical: 0, color: colors.ink, fontSize: 16, letterSpacing: -0.16 },
  typing: { gap: 6, marginTop: 6, marginBottom: 8 },
  sparkleSlot: { height: SPARKLE_SLOT_HEIGHT, justifyContent: 'center' },
  sparkleHint: { height: SPARKLE_SLOT_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: radius.r12, borderWidth: 1, borderColor: colors.hairline },
  sparkleHintText: { ...fontFace('medium'), flex: 1, color: colors.muted, fontSize: 12 },
  resultsBox: { height: PAGER_BODY_HEIGHT + PAGER_FOOTER_HEIGHT, overflow: 'hidden' },
  resultsBody: { height: PAGER_BODY_HEIGHT },
  resultsState: { flex: 1, justifyContent: 'center', paddingVertical: 8 },
  emptyArtwork: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pagerScroll: { height: PAGER_BODY_HEIGHT },
  pagerDimmed: { opacity: 0.45 },
  pagerPage: { height: PAGER_BODY_HEIGHT },
  pagerPageFull: { width: '100%' },
  pagerFooter: { height: PAGER_FOOTER_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pagerMeta: { ...fontFace('medium'), ...tabularNums, fontSize: 11, color: colors.muted },
  pagerDots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pagerDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.border, opacity: 0.65 },
  pagerDotActive: { width: 14, backgroundColor: colors.accent, opacity: 1 },
  pagerNav: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pagerNavBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  pagerNavDisabled: { opacity: 0.3 },
  pagerCount: { ...fontFace('semibold'), ...tabularNums, fontSize: 11, color: colors.muted, minWidth: 26, textAlign: 'center' },
  result: { height: RESULT_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  resultCopy: { flex: 1, minWidth: 0, gap: 2, paddingVertical: 6 },
  resultName: { ...fontFace('semibold'), color: colors.ink, fontSize: 14 },
  resultMeta: { ...fontFace('medium'), color: colors.muted, fontSize: 11 },
  resultEnergy: { ...fontFace('semibold'), fontVariant: [...tabularNums.fontVariant], color: colors.ink, fontSize: 14 },
  smallAdd: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  fieldOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 8 },
  quickHeader: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: colors.hairline },
  quickToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, paddingLeft: 6 },
  quickLabel: { ...fontFace('semibold'), color: colors.muted, fontSize: 12 },
  quickEnergyButton: { minHeight: 44, justifyContent: 'center' },
  quickEnergy: { ...fontFace('bold'), fontVariant: [...tabularNums.fontVariant], fontSize: 24, color: colors.ink },
  quickUnit: { ...fontFace('medium'), fontSize: 12, color: colors.muted },
  quickAdd: { width: 44, height: 44, borderWidth: 1, borderColor: colors.hairline, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  macroCells: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.hairline },
  macroCell: { flex: 1, height: 48, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  macroCellDivider: { borderLeftWidth: 1, borderLeftColor: colors.hairline },
  macroCellActive: { backgroundColor: colors.raised, borderBottomColor: colors.accent },
  macroKey: { ...fontFace('bold'), fontSize: 10 },
  macroValue: { ...fontFace('bold'), fontVariant: [...tabularNums.fontVariant], color: colors.ink, fontSize: 16 },
  macroUnit: { ...fontFace('semibold'), color: colors.muted, fontSize: 10 },
  keypad: { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 12, marginHorizontal: -20, backgroundColor: colors.dock, borderTopWidth: 1, borderTopColor: colors.hairline },
});
