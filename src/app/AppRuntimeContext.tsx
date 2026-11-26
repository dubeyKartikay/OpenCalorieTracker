import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { bootstrap } from './bootstrap';
import type { AppRuntime } from './runtime';
import { localDate, shiftDate } from './controller';
import type { AppController } from './controller';
import type { OfflinePhotoDraft, Quantity, WaterLog } from '../domain';
import type { SavedMeal } from '../storage';
import type { HealthCapability, HealthPermissionsState } from '../health';
import { colors, MIN_TOUCH_TARGET, spacing } from '../ui/tokens';

const RuntimeContext = createContext<AppRuntime | null>(null);
export function AppRuntimeProvider({ children }: React.PropsWithChildren) {
  const [runtime, setRuntime] = useState<AppRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let opened: AppRuntime | null = null;
    bootstrap().then(value => { opened = value; if (active) setRuntime(value); else void value.controller.close(); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; if (opened) void opened.controller.close(); };
  }, [attempt]);
  if (!runtime) return <View style={{ flex: 1, backgroundColor: colors.ground, justifyContent: 'center', padding: spacing.s24, gap: spacing.s16 }}>
    <Text style={{ color: colors.ink, fontSize: 24, fontWeight: '700' }}>OpenCalorieTracker</Text>
    {error ? <><Text accessibilityRole="alert" style={{ color: colors.muted, lineHeight: 24 }}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={() => { setError(null); setAttempt(value => value + 1); }} style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}><Text style={{ color: colors.accent }}>Retry storage initialization</Text></Pressable></>
      : <><ActivityIndicator color={colors.accent} /><Text style={{ color: colors.muted }}>Opening your local diary…</Text></>}
  </View>;
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}
export function useAppRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('AppRuntimeProvider is required');
  useSyncExternalStore(runtime.controller.subscribe, runtime.controller.getRevision, runtime.controller.getRevision);
  return runtime;
}
export function useAsyncResource<T>(load: () => Promise<T>, resourceKey?: string) {
  const [state, setState] = useState<{ load: () => Promise<T>; key?: string; value?: T; error: string | null; loading: boolean }>({
    load,
    ...(resourceKey === undefined ? {} : { key: resourceKey }),
    error: null,
    loading: true,
  });
  useEffect(() => {
    let active = true;
    load()
      .then(value => {
        if (active) {
          setState({ load, ...(resourceKey === undefined ? {} : { key: resourceKey }), value, error: null, loading: false });
        }
      })
      .catch(error => {
        if (active) {
          setState(previous => ({
            load,
            ...(resourceKey === undefined ? {} : { key: resourceKey }),
            ...(resourceKey !== undefined && previous.key !== resourceKey ? {} : { value: previous.value }),
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          }));
        }
      });
    return () => { active = false; };
  }, [load, resourceKey]);
  if (resourceKey !== undefined && state.key !== resourceKey) {
    return { load, key: resourceKey, value: undefined as T | undefined, error: null, loading: true };
  }
  return state.load === load ? state : { ...state, error: null, loading: true };
}
export function useHistoryDay(date: string) {
  const { controller } = useAppRuntime();
  const revision = controller.getRevision();
  return useAsyncResource(useCallback(() => { void revision; return controller.day(date); }, [controller, date, revision]), date);
}
export function useTodayDiary() { return useHistoryDay(localDate()); }
export function useTodayWater(date = localDate()) {
  const { controller } = useAppRuntime(); const revision = controller.getRevision();
  return useAsyncResource<{ totalMl: number; logs: WaterLog[] }>(useCallback(() => {
    void revision; return controller.getDailyWater(date);
  }, [controller, date, revision]), date);
}
export function useOfflinePhotoDrafts() {
  const { controller } = useAppRuntime(); const revision = controller.getRevision();
  return useAsyncResource<OfflinePhotoDraft[]>(useCallback(() => {
    void revision; return controller.listOfflinePhotoDrafts();
  }, [controller, revision]));
}
export function useHealthStatus() {
  const { controller } = useAppRuntime(); const revision = controller.getRevision();
  return useAsyncResource<{ capability: HealthCapability; permissions: HealthPermissionsState; nutritionWriteEnabled: boolean; weightReadEnabled: boolean }>(useCallback(() => {
    void revision; return controller.getHealthStatus();
  }, [controller, revision]));
}
export function usePreferences() {
  const { controller } = useAppRuntime(); const revision = controller.getRevision();
  return useAsyncResource(useCallback(() => { void revision; return controller.getPreferences(); }, [controller, revision]));
}
export function useSavedMeals() {
  const { controller } = useAppRuntime(); const revision = controller.getRevision();
  return useAsyncResource(useCallback(() => { void revision; return controller.listSavedMeals(); }, [controller, revision]));
}
export function useTodaySuggestions(limit = 3) {
  const { controller } = useAppRuntime(); const revision = controller.getRevision();
  return useAsyncResource(useCallback(() => { void revision; return controller.getTodaySuggestions(limit); }, [controller, limit, revision]));
}
export function useRecipes() {
  const { controller } = useAppRuntime(); const revision = controller.getRevision();
  return useAsyncResource(useCallback(() => { void revision; return controller.listRecipes(); }, [controller, revision]));
}
export function useRecipeBatches(recipeId: string) {
  const { controller } = useAppRuntime(); const revision = controller.getRevision();
  return useAsyncResource(useCallback(() => { void revision; return controller.listBatches(recipeId); }, [controller, recipeId, revision]), recipeId);
}
export function useWeekSummary(endDate = localDate()) {
  const { controller } = useAppRuntime(); const revision = controller.getRevision();
  return useAsyncResource(useCallback(() => { void revision; return controller.getWeekSummary(endDate); }, [controller, endDate, revision]), endDate);
}
export function useProgressData(range = 7, endDate = localDate()) {
  const { controller } = useAppRuntime(); const revision = controller.getRevision();
  return useAsyncResource(useCallback(() => { void revision; return controller.progress(range, endDate); }, [controller, range, endDate, revision]), `${range}:${endDate}`);
}
export function useDateRangeCalendarLoader() {
  const { controller } = useAppRuntime();
  return useCallback(async (start: string, end: string) => {
    const days = [];
    for (let cursor = start; cursor <= end; cursor = shiftDate(cursor, 7)) {
      days.push(...await controller.getWeekSummary(shiftDate(cursor, 6)));
    }
    return days;
  }, [controller]);
}
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === '' || delayMs <= 0) {
      const immediate = setTimeout(() => setDebounced(value), 0);
      return () => clearTimeout(immediate);
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return value === '' ? value : debounced;
}
export function useCatalogSearch(query: string, debounceMs = 180) {
  const { controller } = useAppRuntime();
  const revision = controller.getRevision();
  const normalized = query.trim();
  const debounced = useDebouncedValue(normalized, debounceMs);
  const resource = useAsyncResource(
    useCallback(() => { void revision; return controller.search(debounced); }, [controller, debounced, revision]),
    debounced,
  );
  return { ...resource, debouncing: normalized !== debounced };
}
export function usePacksManager() {
  const runtime = useAppRuntime();
  const revision = runtime.controller.getRevision();
  return { ...useAsyncResource(useCallback(() => { void revision; return runtime.controller.listPacks(); }, [runtime, revision])), runtime };
}
export function useAction() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(null);
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { pending.current = false; setBusy(false); }
  };
  return { busy, error, run };
}

export function useAIStatus() {
  const { controller } = useAppRuntime(); const revision = controller.getRevision();
  return useAsyncResource(useCallback(() => { void revision; return controller.getAIStatus(); }, [controller, revision]));
}

// Capture can start in Library and finish in Today or History. Keep its action state and photo with the controller.
type CaptureInput = { text: string; imageDataUrl?: string; meal: string; date?: string };
type NormalizedCaptureInput = { text: string; imageDataUrl?: string; meal: string; date: string };
export interface DraftActionError {
  message: string;
  operation: 'capture' | 'draft';
  meal: string;
  date: string;
}
const draftActions = new WeakMap<AppController, {
  busy: boolean;
  actionError: DraftActionError | null;
  lastCapture: NormalizedCaptureInput | null;
  photoUri: string | null;
}>();
export function useActiveDraft() {
  const { controller } = useAppRuntime();
  let state = draftActions.get(controller);
  if (!state) { state = { busy: false, actionError: null, lastCapture: null, photoUri: null }; draftActions.set(controller, state); }
  const actionState = state;
  const run = async <T,>(
    context: { operation: 'capture' | 'draft'; meal: string; date: string },
    action: () => Promise<T>,
  ): Promise<T | undefined> => {
    if (actionState.busy) return;
    actionState.busy = true; actionState.actionError = null; controller.refresh();
    try { return await action(); }
    catch (reason) {
      actionState.actionError = {
        message: reason instanceof Error ? reason.message : String(reason),
        ...context,
      };
      return undefined;
    }
    finally { actionState.busy = false; controller.refresh(); }
  };
  return {
    draft: controller.getActiveDraft(),
    photoUri: actionState.photoUri,
    busy: actionState.busy,
    error: actionState.actionError?.message ?? null,
    actionError: actionState.actionError,
    lastCapture: actionState.lastCapture,
    clearError: () => { actionState.actionError = null; controller.refresh(); },
    capture: (input: CaptureInput) => {
      const normalized: NormalizedCaptureInput = { ...input, date: input.date ?? localDate() };
      return run({ operation: 'capture', meal: normalized.meal, date: normalized.date }, async () => {
        actionState.lastCapture = normalized;
        const proposal = await controller.captureMealWithAI(normalized);
        actionState.photoUri = normalized.imageDataUrl ?? null;
        return proposal;
      });
    },
    answerQuestion: (questionId: string, optionId: string) => {
      const active = controller.getActiveDraft();
      const context = active
        ? { operation: 'draft' as const, meal: active.meal, date: active.date }
        : { operation: 'draft' as const, meal: '', date: localDate() };
      return run(context, () => controller.answerDraftQuestion(questionId, optionId));
    },
    removeItem: (itemId: string) => controller.removeDraftItem(itemId),
    updateItemQuantity: (index: number, quantity: Quantity) => controller.updateDraftItemQuantity(index, quantity),
    saveAsMeal: (name: string): Promise<SavedMeal> => controller.saveActiveDraftAsMeal(name),
    confirmAll: (idempotencyPrefix?: string) => {
      const active = controller.getActiveDraft();
      const context = active
        ? { operation: 'draft' as const, meal: active.meal, date: active.date }
        : { operation: 'draft' as const, meal: '', date: localDate() };
      return run(context, async () => {
        const entries = await controller.confirmActiveDraft(idempotencyPrefix);
        actionState.lastCapture = null;
        actionState.photoUri = null;
        return entries;
      });
    },
    discard: () => { actionState.actionError = null; actionState.lastCapture = null; actionState.photoUri = null; controller.discardActiveDraft(); },
  };
}
