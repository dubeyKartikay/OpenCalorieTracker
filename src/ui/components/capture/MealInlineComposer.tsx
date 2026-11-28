import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { BackHandler, Dimensions, Image, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { useAction, useActiveDraft, useAIStatus, useAppRuntime, useAsyncResource, useCatalogSearch, usePreferences } from '../../../app/AppRuntimeContext';
import { availableUnits, defaultQuantity } from '../../../app/controller';
import { calculateNutrition, generateId, type DiaryEntrySnapshot, type FoodRecord, type NutrientProfile, type Quantity } from '../../../domain';
import type { SearchCandidate } from '../../../catalog';
import { foodKey } from '../../../storage';
import { paginateList } from '../../format';
import { hapticMedium, hapticSelection, hapticSuccess } from '../../haptics';
import { colors, fontFace, macroColors, radius, SCREEN_GUTTER, tabularNums, useLayoutClass } from '../../tokens';
import { computeResultsPerPage, formatQuantityLabel } from '../customUnitMath';
import { GLOBAL_UNITS, kindOf, labelOf, PortionEditor, usualQuantity, withUnits } from '../FoodSearch';
import { computeScrollTargetAboveKeyboard } from '../keyboardScrollMath';
import { InlineKeypad } from '../doop/InlineKeypad';
import { RevealPanel } from '../doop/Motion';
import { DoopIcon, inferFoodGlyph, mealDaypartGlyph } from '../DoopIcons';
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
  const fieldMealRef = useRef<string | null>(null);
  const [description, setDescription] = useState('');
  const descriptionRef = useRef('');
  const [selectedCandidate, setSelectedCandidate] = useState<SearchCandidate | null>(null);
  const [photo, setPhoto] = useState<PickedMealImage | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState<QuickValues>(emptyQuick);
  const [selected, setSelected] = useState<QuickField>('protein');
  const [resultsPageState, setResultsPageState] = useState<SearchPagerState>({ query: '', anchorIndex: 0 });
  const composerSessionRef = useRef(0);
  const [composerSession, setComposerSession] = useState(0);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);

  const bumpComposerSession = useCallback(() => {
    composerSessionRef.current += 1;
    setComposerSession(composerSessionRef.current);
    return composerSessionRef.current;
  }, []);

  const unit = preferences.value?.energyUnit ?? 'kcal';
  const typingNumber = isNumeric(description);
  const showQuick = !!fieldMeal && !photo && (quickOpen || typingNumber);
  const liveQuery = fieldMeal && !typingNumber ? description.trim() : '';
  const search = useCatalogSearch(liveQuery);
  const searchPending = Boolean(liveQuery) && (search.debouncing || search.loading);
  const localMatches = liveQuery && search.value ? [...search.value.yours, ...search.value.database] : [];
  const blocked = action.busy || activeDraft.busy;

  useEffect(() => { if (showQuick) Keyboard.dismiss(); }, [showQuick]);

  const changeDescription = (value: string) => {
    descriptionRef.current = value;
    setDescription(value);
    setSelectedCandidate(null);
    onNotice?.('');
    if (!photo && isNumeric(value)) {
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
    bumpComposerSession();
    voiceSession.cancel();
    fieldMealRef.current = null;
    descriptionRef.current = '';
    setFieldMeal(null);
    setDescription('');
    setSelectedCandidate(null);
    setPhoto(null);
    setQuickOpen(false);
    setQuick(emptyQuick());
    setResultsPageState({ query: '', anchorIndex: 0 });
    onNotice?.('');
    Keyboard.dismiss();
  }, [bumpComposerSession, onNotice, voiceSession]);

  const openField = useCallback((meal = defaultMeal, quickAdd = false) => {
    bumpComposerSession();
    voiceSession.cancel();
    fieldMealRef.current = meal;
    descriptionRef.current = '';
    setFieldMeal(meal);
    setDescription('');
    setSelectedCandidate(null);
    setPhoto(null);
    setQuickOpen(quickAdd);
    setQuick(emptyQuick());
    setSelected(quickAdd ? 'kcal' : 'protein');
    setResultsPageState({ query: '', anchorIndex: 0 });
    onNotice?.('');
    activeDraft.clearError();
  }, [activeDraft, bumpComposerSession, defaultMeal, onNotice, voiceSession]);

  const selectCandidate = useCallback((candidate: SearchCandidate) => {
    voiceSession.cancel();
    Keyboard.dismiss();
    hapticSelection();
    setSelectedCandidate(candidate);
  }, [voiceSession]);

  const clearSelectedCandidate = useCallback(() => {
    hapticSelection();
    setSelectedCandidate(null);
  }, []);

  const finishFoodAdd = useCallback((addedMeals: string[], forSession?: number) => {
    if (forSession !== undefined && composerSessionRef.current !== forSession) return;
    const primaryMeal = addedMeals[0] ?? fieldMeal ?? defaultMeal;
    closeField();
    onLogged?.(primaryMeal);
  }, [closeField, defaultMeal, fieldMeal, onLogged]);

  useFocusEffect(useCallback(() => {
    if (!fieldMeal || Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedCandidate) clearSelectedCandidate();
      else closeField();
      return true;
    });
    return () => sub.remove();
  }, [clearSelectedCandidate, closeField, fieldMeal, selectedCandidate]));

  const changeQuick = (value: string) => {
    setQuick(old => ({ ...old, [selected]: value }));
    if (selected === 'kcal') {
      descriptionRef.current = value;
      setDescription(value);
    }
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
    const activeSession = composerSessionRef.current;
    voiceSession.stop();
    Keyboard.dismiss();
    void activeDraft.capture(resolvedInput).then(proposal => {
      if (proposal && composerSessionRef.current === activeSession) {
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
      if (fieldMealRef.current !== pending.meal) {
        bumpComposerSession();
        fieldMealRef.current = pending.meal;
        descriptionRef.current = '';
        setFieldMeal(pending.meal);
        setDescription('');
        setQuick(emptyQuick());
        setSelected('protein');
        setResultsPageState({ query: '', anchorIndex: 0 });
      } else if (isNumeric(descriptionRef.current)) {
        descriptionRef.current = '';
        setDescription('');
        setQuick(emptyQuick());
      }
      setSelectedCandidate(null);
      setQuickOpen(false);
      setPhoto(pending.photo);
      onNotice?.('');
    }
    return () => {
      cancelVoice();
    };
  }, [bumpComposerSession, cancelVoice, date, onNotice, onTargetDateChange, returnTab]));

  const voice = (meal: string) => {
    if (voiceSession.active && fieldMeal === meal) {
      voiceSession.stop();
      return;
    }
    const existing = fieldMeal === meal && !typingNumber ? description : '';
    if (fieldMeal !== meal) {
      bumpComposerSession();
      fieldMealRef.current = meal;
      descriptionRef.current = '';
      setFieldMeal(meal);
      setDescription('');
      setSelectedCandidate(null);
      setPhoto(null);
      setQuickOpen(false);
      setQuick(emptyQuick());
      setSelected('protein');
      setResultsPageState({ query: '', anchorIndex: 0 });
      activeDraft.clearError();
    } else if (typingNumber) {
      descriptionRef.current = '';
      setDescription('');
      setSelectedCandidate(null);
    }
    setQuickOpen(false);
    setSelectedCandidate(null);
    onNotice?.('');
    void voiceSession.start(existing);
  };

  const logFood = (food: FoodRecord, meal: string) => {
    const activeSession = composerSessionRef.current;
    void action.run(async () => {
      await controller.confirm({ food, quantity: defaultQuantity(food), meal, date, idempotencyKey: generateId() });
      hapticSuccess();
      if (composerSessionRef.current === activeSession) {
        closeField();
      }
      onLogged?.(meal);
    });
  };

  const logQuick = () => {
    const kcalValue = parsed(quick.kcal);
    if (!fieldMeal || kcalValue == null || !Number.isFinite(kcalValue) || kcalValue <= 0) return;
    const destination = fieldMeal;
    const activeSession = composerSessionRef.current;
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
      if (composerSessionRef.current === activeSession) {
        closeField();
      }
      onLogged?.(destination);
    });
  };

  const saveOfflinePhoto = (meal: string) => {
    if (!photo) return;
    const activeSession = composerSessionRef.current;
    void action.run(async () => {
      await controller.saveOfflinePhotoDraft({ meal, note: description, imageDataUrl: photo.imageDataUrl, date });
      hapticSuccess();
      if (composerSessionRef.current === activeSession) {
        closeField();
      }
      onNotice?.('Photo draft saved on this device.');
    });
  };

  const collapseQuick = () => {
    voiceSession.cancel();
    descriptionRef.current = '';
    setQuickOpen(false);
    setDescription('');
    setSelectedCandidate(null);
    setSelected('kcal');
  };

  return {
    date,
    unit,
    fieldMeal,
    composerSession,
    resultsPageState,
    setResultsPageState,
    description,
    selectedCandidate,
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
    selectCandidate,
    clearSelectedCandidate,
    finishFoodAdd,
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
const FILL_RESULT_ROW_HEIGHT = 56;
const PAGER_BODY_HEIGHT = RESULTS_PER_PAGE * RESULT_ROW_HEIGHT;
const PAGER_FOOTER_HEIGHT = 36;
const SPARKLE_SLOT_HEIGHT = 44;
const MAX_VISIBLE_DOTS = 7;

/**
 * Coordinates the choreographed push-off animation for diary screens (Today & History):
 * elements above the tapped meal glide up & fade out, while elements at/below glide down,
 * clearing the full viewport for the focused `MealComposerStage`.
 */
export function useComposerPushOff(activeMeal: string | null, meals: readonly string[]) {
  const reducedMotion = useReducedMotion();
  const isActive = Boolean(activeMeal);
  const activeIndex = activeMeal ? meals.indexOf(activeMeal) : -1;
  const [latchedSplit, setLatchedSplit] = useState(0);
  if (activeIndex >= 0 && activeIndex !== latchedSplit) {
    setLatchedSplit(activeIndex);
  }

  const progress = useSharedValue(isActive ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) {
      progress.set(isActive ? 1 : 0);
      return;
    }
    if (isActive) {
      progress.set(withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    } else {
      progress.set(withSpring(0, { damping: 24, stiffness: 260, mass: 0.85 }));
    }
  }, [isActive, progress, reducedMotion]);

  const pushUpStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.72, 1], [1, 0.08, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: reducedMotion ? 0 : interpolate(progress.value, [0, 1], [0, -160], Extrapolation.CLAMP) },
      { scale: reducedMotion ? 1 : interpolate(progress.value, [0, 1], [1, 0.96], Extrapolation.CLAMP) },
    ],
  }));

  const pushDownStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.72, 1], [1, 0.08, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: reducedMotion ? 0 : interpolate(progress.value, [0, 1], [0, 180], Extrapolation.CLAMP) },
      { scale: reducedMotion ? 1 : interpolate(progress.value, [0, 1], [1, 0.96], Extrapolation.CLAMP) },
    ],
  }));

  return {
    isActive,
    splitIndex: latchedSplit,
    pushUpStyle,
    pushDownStyle,
  };
}

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

export interface SearchPagerState {
  query: string;
  anchorIndex: number;
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
  onSelectCandidate?: ((candidate: SearchCandidate) => void) | undefined;
  onLongPress?: ((food: FoodRecord) => void) | undefined;
  longPressLabel?: ((food: FoodRecord) => string) | undefined;
  loggedMealsForFood?: ((food: FoodRecord) => string[]) | undefined;
  trailingIcon?: 'chevron' | 'plus' | undefined;
  footerHint?: string | undefined;
  fill?: boolean | undefined;
  onBackdropPress?: (() => void) | undefined;
  pageState?: SearchPagerState | undefined;
  onPageStateChange?: ((next: SearchPagerState) => void) | undefined;
}

/** Fixed-height or full-height swipe-paginated local food results tray shared by Today, History, and Recipe ingredient search. */
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
  onSelectCandidate,
  onLongPress,
  longPressLabel,
  loggedMealsForFood,
  trailingIcon = 'chevron',
  footerHint,
  fill = false,
  onBackdropPress,
  pageState: controlledPageState,
  onPageStateChange,
}: LocalFoodSearchPagerProps) {
  const pagerRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [trayHeight, setTrayHeight] = useState(0);
  const perPage = fill
    ? (trayHeight > 0
      ? computeResultsPerPage(trayHeight, FILL_RESULT_ROW_HEIGHT, PAGER_FOOTER_HEIGHT, 1, 12)
      : RESULTS_PER_PAGE)
    : RESULTS_PER_PAGE;
  const [localPageState, setLocalPageState] = useState<SearchPagerState>({ query, anchorIndex: 0 });
  const pageState = controlledPageState ?? localPageState;
  const setPageState = useCallback((next: SearchPagerState) => {
    if (controlledPageState === undefined) setLocalPageState(next);
    onPageStateChange?.(next);
  }, [controlledPageState, onPageStateChange]);
  const pages = useMemo(() => paginateList(candidates, perPage), [candidates, perPage]);
  const pageCount = pages.length;
  const currentPage =
    pageState.query === query && perPage > 0
      ? Math.min(Math.floor(Math.max(0, pageState.anchorIndex) / perPage), Math.max(0, pageCount - 1))
      : 0;

  const pagerMounted = Boolean(!error && query && !(pending && pageCount === 0) && pageCount > 0);
  const lastSyncedLayoutRef = useRef<{ query: string; perPage: number; pageWidth: number } | null>(null);
  useEffect(() => {
    if (!pagerMounted) {
      lastSyncedLayoutRef.current = null;
      return;
    }
    if (pageWidth <= 0) return;
    const prev = lastSyncedLayoutRef.current;
    if (prev && prev.query === query && prev.perPage === perPage && prev.pageWidth === pageWidth) return;
    lastSyncedLayoutRef.current = { query, perPage, pageWidth };
    pagerRef.current?.scrollTo({ x: currentPage * pageWidth, animated: false });
  }, [currentPage, pageWidth, pagerMounted, perPage, query]);

  const goToPage = (nextPage: number) => {
    const clamped = Math.max(0, Math.min(pageCount - 1, nextPage));
    setPageState({ query, anchorIndex: clamped * perPage });
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
      style={fill ? styles.resultsBoxFill : styles.resultsBox}
      onLayout={event => {
        const nextWidth = Math.round(event.nativeEvent.layout.width);
        const nextHeight = Math.round(event.nativeEvent.layout.height);
        if (nextWidth > 0 && nextWidth !== pageWidth) setPageWidth(nextWidth);
        if (fill && nextHeight > 0 && nextHeight !== trayHeight) setTrayHeight(nextHeight);
      }}
    >
      <View style={fill ? styles.resultsBodyFill : styles.resultsBody}>
        {error ? (
          <View style={styles.resultsState}>
            <ErrorMessage message={error} />
          </View>
        ) : !query ? (
          onBackdropPress ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss search"
              onPress={onBackdropPress}
              style={styles.emptyArtworkHit}
            >
              <ComposerEmptyArtwork />
            </Pressable>
          ) : (
            <ComposerEmptyArtwork />
          )
        ) : pending && pageCount === 0 ? (
          <View style={styles.resultsState}>
            <Muted>Searching foods…</Muted>
          </View>
        ) : pageCount === 0 ? (
          onBackdropPress ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss search"
              onPress={onBackdropPress}
              style={styles.resultsState}
            >
              <Muted>{emptyMessage}</Muted>
            </Pressable>
          ) : (
            <View style={styles.resultsState}>
              <Muted>{emptyMessage}</Muted>
            </View>
          )
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
              if (next !== currentPage) setPageState({ query, anchorIndex: next * perPage });
            }}
            style={[fill ? styles.pagerScrollFill : styles.pagerScroll, pending && styles.pagerDimmed]}
          >
            {visiblePages.map((pageItems, pageIndex) => {
              const rows = (
                <>
                  {pageItems.map(candidate => {
                    const portion = defaultQuantity(candidate.food);
                    const nutrients = calculateNutrition(candidate.food, portion);
                    const portionText = formatQuantityLabel(portion, candidate.food);
                    const loggedMeals = loggedMealsForFood ? loggedMealsForFood(candidate.food) : [];
                    return (
                      <Pressable
                        key={`${candidate.food.source_pack_id ?? 'yours'}:${candidate.food.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={addLabel(candidate.food)}
                        accessibilityHint={onLongPress ? 'Tap to choose portion and meal, hold for full nutrition' : undefined}
                        accessibilityActions={onLongPress ? [{ name: 'longpress', label: longPressLabel?.(candidate.food) ?? `Open full nutrition for ${candidate.food.name}` }] : undefined}
                        onAccessibilityAction={onLongPress ? event => {
                          if (event.nativeEvent.actionName === 'longpress') onLongPress(candidate.food);
                        } : undefined}
                        disabled={disabled || pending}
                        delayLongPress={380}
                        onLongPress={onLongPress ? () => { hapticMedium(); onLongPress(candidate.food); } : undefined}
                        onPress={() => (onSelectCandidate ? onSelectCandidate(candidate) : onAdd(candidate.food))}
                        style={({ pressed }) => [styles.result, fill && styles.resultFill, pressed && styles.resultPressed]}
                      >
                        <View style={styles.resultGlyph}>
                          <DoopIcon name={inferFoodGlyph(candidate.food.name, kindOf(candidate.food))} size={16} color={colors.muted} />
                        </View>
                        <View style={styles.resultCopy}>
                          <Text numberOfLines={1} style={styles.resultName}>{candidate.food.name}</Text>
                          <Text numberOfLines={1} style={styles.resultMeta}>
                            {candidate.sourceLabel} · {portionText}
                            {loggedMeals.length ? <> · <Text style={styles.resultLogged}>In {loggedMeals.join(', ')}</Text></> : null}
                          </Text>
                        </View>
                        <Text style={styles.resultEnergy}>{number(energyValue(nutrients.kcal, energyUnit))}</Text>
                        <View style={styles.resultTrailing}>
                          <DoopIcon name={trailingIcon === 'plus' ? 'plus' : 'chevronRight'} size={14} color={colors.muted} />
                        </View>
                      </Pressable>
                    );
                  })}
                  {fill && onBackdropPress ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Dismiss search"
                      onPress={onBackdropPress}
                      style={styles.pagerEmptyFill}
                    />
                  ) : null}
                </>
              );
              if (fill) {
                return (
                  <ScrollView
                    key={pageIndex}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    style={[styles.pagerPageFill, pageWidth > 0 ? { width: pageWidth } : styles.pagerPageFull]}
                    contentContainerStyle={styles.pagerPageFillContent}
                  >
                    {rows}
                  </ScrollView>
                );
              }
              return (
                <View key={pageIndex} style={[styles.pagerPage, pageWidth > 0 ? { width: pageWidth } : styles.pagerPageFull]}>
                  {rows}
                </View>
              );
            })}
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
            ) : footerHint ? (
              <Text numberOfLines={1} style={styles.pagerHint}>{footerHint}</Text>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

type InlineLivePreview = { quantity: Quantity; nutrients: NutrientProfile | undefined } | null;

function InlineFoodAddCard({
  candidate,
  meal,
  date,
  energyUnit,
  entries = [],
  onBack,
  onAdded,
  onEnsureVisible,
}: {
  candidate: SearchCandidate;
  meal: string;
  date: string;
  energyUnit: 'kcal' | 'kJ';
  entries?: DiaryEntrySnapshot[] | undefined;
  onBack: () => void;
  onAdded: (meals: string[]) => void;
  onEnsureVisible?: ((node: ComponentRef<typeof View> | null) => void) | undefined;
}) {
  const { controller } = useAppRuntime();
  const revision = controller.getRevision();
  const baseFood = candidate.food;
  const key = foodKey(baseFood);
  const [updatedFood, setUpdatedFood] = useState<{ base: FoodRecord; food: FoodRecord } | null>(null);
  const original = updatedFood?.base === baseFood ? updatedFood.food : baseFood;
  const [chosen, setChosen] = useState<Quantity | null>(null);
  const [livePreview, setLivePreview] = useState<InlineLivePreview>(null);

  const meta = useAsyncResource(useCallback(async () => {
    void revision;
    const [globalUnits, learned] = await Promise.all([
      controller.deps.library.listUserFoodUnits(GLOBAL_UNITS),
      controller.deps.library.listLearnedPortions(key),
    ]);
    return { globalUnits, learned };
  }, [controller, key, revision]), `inline-add:${key}`);

  const globalUnits = meta.value?.globalUnits;
  const learnedList = meta.value?.learned;
  const food = useMemo(
    () => (globalUnits && globalUnits.length > 0 ? withUnits(original, globalUnits) : original),
    [globalUnits, original],
  );
  const validUnits = useMemo(() => availableUnits(food), [food]);
  const learnedPortion = useMemo(() => {
    if (!learnedList?.length) return null;
    const usual = learnedList.find(item => validUnits.includes(item.unit));
    return usual ? { amount: usual.amount, unit: usual.unit } : null;
  }, [learnedList, validUnits]);
  const safeChosen = useMemo(
    () => (chosen && validUnits.includes(chosen.unit) ? chosen : null),
    [chosen, validUnits],
  );
  const portion = useMemo(
    () => safeChosen ?? learnedPortion ?? usualQuantity(food),
    [food, learnedPortion, safeChosen],
  );
  const fallbackNutrients = useMemo(() => {
    try { return calculateNutrition(food, portion); } catch { return undefined; }
  }, [food, portion]);

  const displayQty = livePreview?.quantity ?? portion;
  const displayNutrients = livePreview?.nutrients ?? fallbackNutrients;
  const foodEntries = useMemo(
    () => entries.filter(entry => foodKey(entry.food) === key),
    [entries, key],
  );

  const openFullDetail = useCallback(() => {
    hapticMedium();
    const validAmount = Number.isFinite(displayQty.amount) && displayQty.amount > 0;
    router.push({
      pathname: '/food',
      params: {
        id: food.id,
        ...(food.source_pack_id ? { packId: food.source_pack_id } : {}),
        meal,
        date,
        ...(validAmount ? { amount: String(displayQty.amount), unit: displayQty.unit } : {}),
      },
    });
  }, [date, displayQty.amount, displayQty.unit, food.id, food.source_pack_id, meal]);

  return (
    <View style={styles.addCard} accessibilityLabel={`Add ${food.name}`}>
      <View style={styles.addCardHead}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to search results"
          onPress={onBack}
          style={({ pressed }) => [styles.addCardBack, pressed && { opacity: 0.7 }]}
        >
          <DoopIcon name="chevronLeft" size={16} color={colors.muted} />
        </Pressable>
        <Pressable
          delayLongPress={380}
          onLongPress={openFullDetail}
          accessibilityHint="Hold for full nutrition details"
          style={styles.addCardTitleWrap}
        >
          <Text numberOfLines={1} style={styles.addCardName}>{food.name}</Text>
          <Text numberOfLines={1} style={styles.addCardSub}>
            {`${candidate.sourceLabel} · ${labelOf(displayQty, food)}`}
          </Text>
        </Pressable>
        <View style={styles.addCardEnergy}>
          <Text style={styles.addCardEnergyNum}>{number(energyValue(displayNutrients?.kcal, energyUnit))}</Text>
          <Text style={styles.addCardEnergyUnit}>{energyUnit}</Text>
        </View>
      </View>
      <PortionEditor
        inCard
        food={food}
        meal={meal}
        date={date}
        quantity={portion}
        onQuantityChange={setChosen}
        onFoodChange={next => setUpdatedFood({ base: baseFood, food: next })}
        onPreviewChange={setLivePreview}
        entries={foodEntries}
        entriesReady
        onAdded={onAdded}
        onDetailHoldOpen={openFullDetail}
        onEnsureVisible={onEnsureVisible}
      />
    </View>
  );
}

export function MealComposerField({
  composer,
  meal,
  entries = [],
  onEnsureVisible,
  fill = false,
}: {
  composer: MealInlineComposerController;
  meal: string;
  entries?: DiaryEntrySnapshot[] | undefined;
  onEnsureVisible?: ((node: ComponentRef<typeof View> | null) => void) | undefined;
  fill?: boolean | undefined;
}) {
  const {
    date,
    unit,
    composerSession,
    resultsPageState,
    setResultsPageState,
    description,
    selectedCandidate,
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
    selectCandidate,
    clearSelectedCandidate,
    finishFoodAdd,
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

  const loggedMealsByFoodKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of entries) {
      const k = foodKey(entry.food);
      const list = map.get(k);
      if (list) {
        if (!list.includes(entry.meal)) list.push(entry.meal);
      } else {
        map.set(k, [entry.meal]);
      }
    }
    return map;
  }, [entries]);

  const openFoodDetail = useCallback((food: FoodRecord) => {
    const qty = defaultQuantity(food);
    router.push({
      pathname: '/food',
      params: {
        id: food.id,
        ...(food.source_pack_id ? { packId: food.source_pack_id } : {}),
        meal,
        date,
        amount: String(qty.amount),
        unit: qty.unit,
      },
    });
  }, [date, meal]);

  const cardScrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const cardScrollOffsetRef = useRef(0);
  const ensureCardVisible = useScrollAboveKeyboard(cardScrollRef, cardScrollOffsetRef);

  const inner = (
    <>
      <View style={[styles.fieldRow, fill && styles.fieldRowFill]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Close ${meal} input`} disabled={blocked} onPress={closeField} style={[styles.circle, styles.closeCircle]}><DoopIcon name="close" size={15} color={colors.muted} /></Pressable>
        {photo && (
          <Pressable accessibilityRole="button" accessibilityLabel="Remove attached photo" disabled={blocked} onPress={() => setPhoto(null)} style={styles.inlineThumbWrap}>
            <Image source={{ uri: photo.uri }} accessibilityLabel="Attached meal photo" style={styles.inlineThumb} />
          </Pressable>
        )}
        <TextInput
          ref={inputRef}
          autoFocus={!quickOpen && !voiceSession.active && !photo && !selectedCandidate}
          accessibilityLabel={`Add food to ${meal}`}
          placeholder={fill ? `Search food for ${meal}` : meal}
          placeholderTextColor={colors.muted}
          selectionColor={colors.accent}
          value={description}
          onChangeText={changeDescription}
          editable={!blocked}
          showSoftInputOnFocus={!showQuick && !voiceSession.active}
          onPressIn={() => {
            if (voiceSession.active) voiceSession.stop();
            if (selectedCandidate) clearSelectedCandidate();
          }}
          onFocus={() => {
            if (showQuick) setSelected('kcal');
            if (selectedCandidate) clearSelectedCandidate();
          }}
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
        selectedCandidate ? (
          fill ? (
            <ScrollView
              ref={cardScrollRef}
              scrollEventThrottle={16}
              onScroll={event => { cardScrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.stageCardScroll}
              contentContainerStyle={styles.stageCardContent}
            >
              <RevealPanel visible direction="down">
                <InlineFoodAddCard
                  key={foodKey(selectedCandidate.food)}
                  candidate={selectedCandidate}
                  meal={meal}
                  date={date}
                  energyUnit={unit}
                  entries={entries}
                  onBack={clearSelectedCandidate}
                  onAdded={addedMeals => finishFoodAdd(addedMeals, composerSession)}
                  onEnsureVisible={ensureCardVisible}
                />
              </RevealPanel>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to search results"
                onPress={clearSelectedCandidate}
                style={styles.stageTapOffFill}
              />
            </ScrollView>
          ) : (
            <RevealPanel visible direction="down" style={styles.addCardWrap}>
              <InlineFoodAddCard
                key={foodKey(selectedCandidate.food)}
                candidate={selectedCandidate}
                meal={meal}
                date={date}
                energyUnit={unit}
                entries={entries}
                onBack={clearSelectedCandidate}
                onAdded={addedMeals => finishFoodAdd(addedMeals, composerSession)}
                onEnsureVisible={onEnsureVisible}
              />
            </RevealPanel>
          )
        ) : (
          <View style={[styles.typing, fill && styles.typingFill]}>
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
              fill={fill}
              query={liveQuery}
              candidates={localMatches}
              pending={searchPending}
              error={search.error ?? ai.error}
              energyUnit={unit}
              disabled={blocked}
              emptyMessage="No local matches. Draft with AI or type calories."
              addLabel={food => `Add ${food.name} to ${meal}`}
              onAdd={food => logFood(food, meal)}
              onSelectCandidate={selectCandidate}
              onLongPress={openFoodDetail}
              longPressLabel={food => `Open full nutrition for ${food.name}`}
              loggedMealsForFood={food => loggedMealsByFoodKey.get(foodKey(food)) ?? []}
              footerHint="Tap to add · Hold for nutrition"
              onBackdropPress={fill ? closeField : undefined}
              pageState={resultsPageState}
              onPageStateChange={setResultsPageState}
            />
          </View>
        )
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
      {fill && showQuick ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close quick add"
          onPress={closeField}
          style={styles.stageTapOffFill}
        />
      ) : null}

      <RevealPanel visible={!!photo} direction="down" style={styles.fieldOptions}>
        <Button label="Save offline" quiet disabled={blocked} onPress={() => saveOfflinePhoto(meal)} />
      </RevealPanel>

      {fill && (action.error || activeDraft.error) ? (
        <View style={styles.stageErrorWrap}>
          <ErrorMessage message={action.error ?? activeDraft.error} />
        </View>
      ) : null}
    </>
  );

  if (fill) {
    return <View style={styles.fieldFill}>{inner}</View>;
  }
  return <RevealPanel visible direction="down">{inner}</RevealPanel>;
}

export interface MealComposerStageProps {
  composer: MealInlineComposerController;
  entries?: DiaryEntrySnapshot[] | undefined;
  subtitle?: string | undefined;
}

/**
 * Full-viewport focused meal composer stage that animates smoothly into place
 * while the surrounding diary elements glide off-screen, freeing up space to
 * display more search matches per page.
 */
export function MealComposerStage({
  composer,
  entries = [],
  subtitle,
}: MealComposerStageProps) {
  const visible = Boolean(composer.fieldMeal);
  const reducedMotion = useReducedMotion();
  const { isExpanded } = useLayoutClass();
  const insets = useSafeAreaInsets();
  const stageRef = useRef<ComponentRef<typeof View> | null>(null);
  const keyboardMetricsRef = useRef<{ height: number; screenY: number }>({ height: 0, screenY: 0 });
  const [measuredOverlap, setMeasuredOverlap] = useState(0);
  const [mounted, setMounted] = useState(visible);
  const [latchedMeal, setLatchedMeal] = useState<string>(composer.fieldMeal ?? 'Breakfast');
  const progress = useSharedValue(visible ? 1 : 0);

  const updateKeyboardOverlap = useCallback(() => {
    const { height, screenY } = keyboardMetricsRef.current;
    if (height <= 0 || Platform.OS === 'web') {
      setMeasuredOverlap(0);
      return;
    }
    const node = stageRef.current;
    if (!node) return;
    node.measureInWindow((_x, y, _w, h) => {
      if (h <= 0) return;
      const windowHeight = Dimensions.get('window').height;
      const keyboardTop = screenY > 0 ? screenY : Math.max(0, windowHeight - height);
      const stageBottom = y + h;
      const overlap = Math.max(0, Math.round(stageBottom - keyboardTop));
      setMeasuredOverlap(prev => (prev === overlap ? prev : overlap));
    });
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, event => {
      keyboardMetricsRef.current = {
        height: event.endCoordinates?.height ?? 0,
        screenY: event.endCoordinates?.screenY ?? 0,
      };
      updateKeyboardOverlap();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardMetricsRef.current = { height: 0, screenY: 0 };
      setMeasuredOverlap(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [updateKeyboardOverlap]);

  if (composer.fieldMeal && composer.fieldMeal !== latchedMeal) {
    setLatchedMeal(composer.fieldMeal);
  }
  if (visible && !mounted) {
    setMounted(true);
  } else if (!visible && mounted && reducedMotion) {
    setMounted(false);
  }

  useEffect(() => {
    if (visible) {
      if (reducedMotion) {
        progress.set(1);
      } else {
        progress.set(withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }));
      }
      return;
    }
    if (!mounted) return;
    if (reducedMotion) {
      progress.set(0);
      return;
    }
    progress.set(
      withTiming(
        0,
        { duration: 190, easing: Easing.in(Easing.cubic) },
        finished => {
          if (finished) scheduleOnRN(setMounted, false);
        },
      ),
    );
  }, [mounted, progress, reducedMotion, visible]);

  const stageStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.35, 1], [0, 0.85, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: reducedMotion ? 0 : interpolate(progress.value, [0, 1], [26, 0], Extrapolation.CLAMP) },
      { scale: reducedMotion ? 1 : interpolate(progress.value, [0, 1], [0.975, 1], Extrapolation.CLAMP) },
    ],
  }));

  if (!mounted) return null;

  const keyboardOverlap =
    !composer.showQuick && !composer.voiceSession.active
      ? measuredOverlap
      : 0;
  const maxWidth = isExpanded ? 760 : 540;

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[styles.stageBackdrop, stageStyle]}
    >
      <View
        ref={stageRef}
        collapsable={false}
        onLayout={updateKeyboardOverlap}
        style={[
          styles.stageInner,
          {
            maxWidth,
            paddingTop: Math.max(insets.top, 8) + 6,
            paddingBottom: keyboardOverlap,
          },
        ]}
      >
        <View style={styles.stageHeader}>
          <View style={styles.stageMealWell}>
            <DoopIcon name={mealDaypartGlyph(latchedMeal)} size={16} color={colors.accent} />
          </View>
          <Text numberOfLines={1} accessibilityRole="header" style={styles.stageTitle}>
            {`Adding to ${latchedMeal}`}
          </Text>
          {subtitle ? <Text style={styles.stageSubtitle}>{subtitle}</Text> : null}
        </View>

        <View style={styles.stageBody}>
          <MealComposerField
            composer={composer}
            meal={latchedMeal}
            entries={entries}
            fill
          />
        </View>

        {(composer.voiceSession.active || composer.showQuick) && (
          <View style={styles.stageFooter}>
            <MealComposerFooter composer={composer} />
          </View>
        )}
      </View>
    </Animated.View>
  );
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
  stageBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 40 },
  stageInner: { flex: 1, width: '100%', alignSelf: 'center', paddingHorizontal: SCREEN_GUTTER },
  stageHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 },
  stageMealWell: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(122,162,247,0.16)', alignItems: 'center', justifyContent: 'center' },
  stageTitle: { ...fontFace('bold'), color: colors.ink, fontSize: 16, letterSpacing: -0.2, flex: 1, minWidth: 0 },
  stageSubtitle: { ...fontFace('semibold'), color: colors.muted, fontSize: 12 },
  stageBody: { flex: 1, minHeight: 0 },
  stageFooter: { paddingTop: 4 },
  stageCardScroll: { flex: 1, marginTop: 8 },
  stageCardContent: { flexGrow: 1, paddingBottom: 24 },
  stageTapOffFill: { flex: 1, minHeight: 80 },
  fieldFill: { flex: 1, minHeight: 0 },
  fieldRow: { height: 56, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldRowFill: { paddingHorizontal: 0, height: 52 },
  fieldActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  circle: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  inlineThumbWrap: { width: 32, height: 32, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  inlineThumb: { width: 32, height: 32 },
  micActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  closeCircle: { backgroundColor: 'rgba(192,202,245,0.10)' },
  mealInput: { ...fontFace('semibold'), flex: 1, minWidth: 0, height: 44, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.r12, backgroundColor: colors.dock, paddingHorizontal: 9, paddingVertical: 0, color: colors.ink, fontSize: 16, letterSpacing: -0.16 },
  typing: { gap: 6, marginTop: 6, marginBottom: 8 },
  typingFill: { flex: 1, minHeight: 0, gap: 8, marginTop: 8, marginBottom: 4 },
  sparkleSlot: { height: SPARKLE_SLOT_HEIGHT, justifyContent: 'center' },
  sparkleHint: { height: SPARKLE_SLOT_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: radius.r12, borderWidth: 1, borderColor: colors.hairline },
  sparkleHintText: { ...fontFace('medium'), flex: 1, color: colors.muted, fontSize: 12 },
  resultsBox: { height: PAGER_BODY_HEIGHT + PAGER_FOOTER_HEIGHT, overflow: 'hidden' },
  resultsBoxFill: { flex: 1, minHeight: 0, overflow: 'hidden' },
  resultsBody: { height: PAGER_BODY_HEIGHT },
  resultsBodyFill: { flex: 1, minHeight: 0 },
  resultsState: { flex: 1, justifyContent: 'center', paddingVertical: 8 },
  emptyArtworkHit: { flex: 1 },
  emptyArtwork: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pagerScroll: { height: PAGER_BODY_HEIGHT },
  pagerScrollFill: { flex: 1 },
  pagerDimmed: { opacity: 0.45 },
  pagerPage: { height: PAGER_BODY_HEIGHT },
  pagerPageFill: { flex: 1 },
  pagerPageFillContent: { flexGrow: 1 },
  pagerEmptyFill: { flex: 1 },
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
  pagerHint: { ...fontFace('medium'), fontSize: 11, color: colors.muted, opacity: 0.75, flexShrink: 1 },
  result: { height: RESULT_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, borderRadius: radius.r8, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  resultFill: { height: FILL_RESULT_ROW_HEIGHT },
  resultPressed: { backgroundColor: 'rgba(122,162,247,0.12)' },
  resultGlyph: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(65,72,104,0.75)', alignItems: 'center', justifyContent: 'center' },
  resultCopy: { flex: 1, minWidth: 0, gap: 2, paddingVertical: 6 },
  resultName: { ...fontFace('semibold'), color: colors.ink, fontSize: 14 },
  resultMeta: { ...fontFace('medium'), color: colors.muted, fontSize: 11 },
  resultLogged: { ...fontFace('semibold'), color: colors.success },
  resultEnergy: { ...fontFace('semibold'), fontVariant: [...tabularNums.fontVariant], color: colors.ink, fontSize: 14 },
  resultTrailing: { width: 18, alignItems: 'center', justifyContent: 'center', opacity: 0.55 },
  addCardWrap: { marginTop: 8, marginBottom: 10 },
  addCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.r16, padding: 14 },
  addCardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addCardBack: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  addCardTitleWrap: { flex: 1, minWidth: 0, gap: 2 },
  addCardName: { ...fontFace('bold'), color: colors.ink, fontSize: 15 },
  addCardSub: { ...fontFace('medium'), ...tabularNums, color: colors.muted, fontSize: 12 },
  addCardEnergy: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  addCardEnergyNum: { ...fontFace('extrabold'), ...tabularNums, color: colors.ink, fontSize: 19 },
  addCardEnergyUnit: { ...fontFace('semibold'), color: colors.muted, fontSize: 11 },
  fieldOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 8 },
  stageErrorWrap: { paddingVertical: 6 },
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
