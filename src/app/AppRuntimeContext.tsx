import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { bootstrap } from './bootstrap';
import type { AppRuntime } from './runtime';
import { localDate } from './controller';
import type { AppController } from './controller';
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
export function useAsyncResource<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ load: () => Promise<T>; value?: T; error: string | null; loading: boolean }>({ load, error: null, loading: true });
  useEffect(() => {
    let active = true;
    load().then(value => { if (active) setState({ load, value, error: null, loading: false }); })
      .catch(error => { if (active) setState({ load, error: error instanceof Error ? error.message : String(error), loading: false }); });
    return () => { active = false; };
  }, [load]);
  return state.load === load ? state : { error: null, loading: true, value: undefined };
}
export function useHistoryDay(date: string) {
  const { controller } = useAppRuntime();
  const revision = controller.getRevision();
  return useAsyncResource(useCallback(() => { void revision; return controller.day(date); }, [controller, date, revision]));
}
export function useTodayDiary() { return useHistoryDay(localDate()); }
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
  return useAsyncResource(useCallback(() => { void revision; return controller.listBatches(recipeId); }, [controller, recipeId, revision]));
}
export function useWeekSummary(endDate = localDate()) {
  const { controller } = useAppRuntime(); const revision = controller.getRevision();
  return useAsyncResource(useCallback(() => { void revision; return controller.getWeekSummary(endDate); }, [controller, endDate, revision]));
}
export function useProgressData(range = 7, endDate = localDate()) {
  const { controller } = useAppRuntime(); const revision = controller.getRevision();
  return useAsyncResource(useCallback(() => { void revision; return controller.progress(range, endDate); }, [controller, range, endDate, revision]));
}
export function useCatalogSearch(query: string) {
  const { controller } = useAppRuntime();
  const revision = controller.getRevision();
  return useAsyncResource(useCallback(() => { void revision; return controller.search(query); }, [controller, query, revision]));
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

// Capture can start in Library and finish in Today. Keep its action state with the controller.
type CaptureInput = Parameters<AppController['captureMealWithAI']>[0];
const draftActions = new WeakMap<AppController, { busy: boolean; error: string | null; lastCapture: CaptureInput | null }>();
export function useActiveDraft() {
  const { controller } = useAppRuntime();
  let state = draftActions.get(controller);
  if (!state) { state = { busy: false, error: null, lastCapture: null }; draftActions.set(controller, state); }
  const actionState = state;
  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (actionState.busy) return;
    actionState.busy = true; actionState.error = null; controller.refresh();
    try { return await action(); }
    catch (reason) { actionState.error = reason instanceof Error ? reason.message : String(reason); return undefined; }
    finally { actionState.busy = false; controller.refresh(); }
  };
  return { draft: controller.getActiveDraft(), busy: actionState.busy, error: actionState.error, lastCapture: actionState.lastCapture,
    clearError: () => { actionState.error = null; controller.refresh(); },
    capture: (input: CaptureInput) => run(() => { actionState.lastCapture = input; return controller.captureMealWithAI(input); }),
    answerQuestion: (questionId: string, optionId: string) => run(() => controller.answerDraftQuestion(questionId, optionId)),
    removeItem: (itemId: string) => controller.removeDraftItem(itemId),
    confirmAll: (idempotencyPrefix?: string) => run(async () => {
      const entries = await controller.confirmActiveDraft(idempotencyPrefix); actionState.lastCapture = null; return entries;
    }),
    discard: () => { actionState.error = null; actionState.lastCapture = null; controller.discardActiveDraft(); },
  };
}
