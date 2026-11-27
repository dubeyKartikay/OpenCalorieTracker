import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { hapticMedium, hapticSelection, hapticSuccess } from '../../haptics';
import type { DiaryEntrySnapshot } from '../../../domain';
import { colors, fontFace, radius, tabularNums } from '../../tokens';
import { DoopIcon, inferFoodGlyph } from '../DoopIcons';
import { energyValue, number } from '../primitives';
import type { Point, ScreenRect } from './hitTest';
import { computeAutoScrollVelocity, computeGhostPosition, findDropTargetMeal, type MealDropZone } from './entryDragMath';

interface ActiveDrag {
  entry: DiaryEntrySnapshot;
  sourceMeal: string;
  ghostWidth: number;
  ghostHeight: number;
}

interface MealEntryDragContextValue {
  isDragging: boolean;
  draggingEntryId: string | null;
  draggingFromMeal: string | null;
  hoveredMeal: string | null;
  recentlyDroppedMeal: string | null;
  disabled: boolean;
  registerDropZone: (meal: string) => (node: ComponentRef<typeof View> | null) => void;
  shouldSuppressTap: () => boolean;
  startDrag: (
    entry: DiaryEntrySnapshot,
    sourceMeal: string,
    rowNode: ComponentRef<typeof View> | null,
    startX: number,
    startY: number,
  ) => void;
  updateDrag: (x: number, y: number) => void;
  endDrag: (x: number, y: number, success: boolean) => void;
  cancelDrag: () => void;
  ghostLeftSV: SharedValue<number>;
  ghostTopSV: SharedValue<number>;
  rowRectSV: SharedValue<ScreenRect>;
  overlayOriginSV: SharedValue<Point>;
  startPointerSV: SharedValue<Point>;
  ghostHeightSV: SharedValue<number>;
}

const MealEntryDragContext = createContext<MealEntryDragContextValue | null>(null);

export interface MealEntryDragProviderProps {
  energyUnit: 'kcal' | 'kJ';
  disabled?: boolean;
  scrollRef?: RefObject<ComponentRef<typeof ScrollView> | null>;
  scrollOffsetRef?: RefObject<number>;
  onMoveEntry: (entry: DiaryEntrySnapshot, targetMeal: string) => void;
  onDraggingChange?: (dragging: boolean) => void;
  children: ReactNode;
}

const GHOST_HEIGHT = 56;
const LIFT_OFFSET_Y = 20;

export function MealEntryDragProvider({
  energyUnit,
  disabled = false,
  scrollRef,
  scrollOffsetRef,
  onMoveEntry,
  onDraggingChange,
  children,
}: MealEntryDragProviderProps) {
  const reducedMotion = useReducedMotion();
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [hoveredMeal, setHoveredMeal] = useState<string | null>(null);
  const [recentlyDroppedMeal, setRecentlyDroppedMeal] = useState<string | null>(null);

  const rootRef = useRef<ComponentRef<typeof View> | null>(null);
  const dropZoneNodes = useRef(new Map<string, ComponentRef<typeof View>>());
  const dropZones = useRef<MealDropZone[]>([]);
  const rootBounds = useRef<ScreenRect>({ x: 0, y: 0, width: 0, height: 0 });
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const hoveredMealRef = useRef<string | null>(null);
  const lastPointerRef = useRef<Point | null>(null);
  const suppressTapUntilRef = useRef(0);
  const sessionRef = useRef(0);
  const mountedRef = useRef(true);
  const dropPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMeasureAtRef = useRef(0);

  const onMoveEntryRef = useRef(onMoveEntry);
  useLayoutEffect(() => {
    onMoveEntryRef.current = onMoveEntry;
  }, [onMoveEntry]);

  const onDraggingChangeRef = useRef(onDraggingChange);
  useLayoutEffect(() => {
    onDraggingChangeRef.current = onDraggingChange;
  }, [onDraggingChange]);

  const ghostLeftSV = useSharedValue(0);
  const ghostTopSV = useSharedValue(0);
  const ghostScaleSV = useSharedValue(0.95);
  const ghostOpacitySV = useSharedValue(0);
  const rowRectSV = useSharedValue<ScreenRect>({ x: 20, y: 0, width: 280, height: GHOST_HEIGHT });
  const overlayOriginSV = useSharedValue<Point>({ x: 0, y: 0 });
  const startPointerSV = useSharedValue<Point>({ x: 0, y: 0 });
  const ghostHeightSV = useSharedValue(GHOST_HEIGHT);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      if (dropPulseTimerRef.current) clearTimeout(dropPulseTimerRef.current);
      if (autoScrollTimerRef.current) clearInterval(autoScrollTimerRef.current);
    };
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimerRef.current) {
      clearInterval(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
  }, []);

  const measureAllZones = useCallback((generation: number) => {
    lastMeasureAtRef.current = Date.now();
    rootRef.current?.measureInWindow((x, y, width, height) => {
      if (!mountedRef.current || generation !== sessionRef.current) return;
      rootBounds.current = { x, y, width, height };
      overlayOriginSV.set({ x, y });
    });

    const entries = [...dropZoneNodes.current.entries()];
    if (!entries.length) {
      dropZones.current = [];
      return;
    }

    const nextZones = new Map<string, MealDropZone>();
    entries.forEach(([meal, node]) => {
      node.measureInWindow((x, y, width, height) => {
        if (!mountedRef.current || generation !== sessionRef.current || width <= 0 || height <= 0) return;
        nextZones.set(meal, { meal, rect: { x, y, width, height } });
        dropZones.current = [...nextZones.values()];
        if (lastPointerRef.current && activeDragRef.current) {
          const hit = findDropTargetMeal(lastPointerRef.current, dropZones.current);
          const nextHover = hit && hit !== activeDragRef.current.sourceMeal ? hit : null;
          if (hoveredMealRef.current !== nextHover) {
            hoveredMealRef.current = nextHover;
            setHoveredMeal(nextHover);
            if (nextHover) hapticSelection();
          }
        }
      });
    });
  }, [overlayOriginSV]);

  const startAutoScroll = useCallback((generation: number) => {
    stopAutoScroll();
    if (!scrollRef || !scrollOffsetRef) return;
    autoScrollTimerRef.current = setInterval(() => {
      if (!mountedRef.current || generation !== sessionRef.current || !activeDragRef.current || !lastPointerRef.current) {
        stopAutoScroll();
        return;
      }
      const bounds = rootBounds.current;
      if (bounds.height <= 0) return;
      const step = computeAutoScrollVelocity(lastPointerRef.current.y, bounds.y, bounds.y + bounds.height);
      if (step === 0) return;
      const currentY = scrollOffsetRef.current ?? 0;
      const nextY = Math.max(0, currentY + step);
      if (nextY === currentY) return;
      scrollRef.current?.scrollTo({ y: nextY, animated: false });
      if (Date.now() - lastMeasureAtRef.current > 90) {
        measureAllZones(generation);
      }
    }, 24);
  }, [measureAllZones, scrollOffsetRef, scrollRef, stopAutoScroll]);

  const startDrag = useCallback((
    entry: DiaryEntrySnapshot,
    sourceMeal: string,
    rowNode: ComponentRef<typeof View> | null,
    startX: number,
    startY: number,
  ) => {
    if (disabled) return;
    const generation = sessionRef.current + 1;
    sessionRef.current = generation;

    const fallbackWidth = Math.max(220, Math.min(340, (rootBounds.current.width || 360) - 40));
    const initialDrag: ActiveDrag = {
      entry,
      sourceMeal,
      ghostWidth: fallbackWidth,
      ghostHeight: GHOST_HEIGHT,
    };

    activeDragRef.current = initialDrag;
    hoveredMealRef.current = null;
    lastPointerRef.current = { x: startX, y: startY };
    suppressTapUntilRef.current = Infinity;

    startPointerSV.set({ x: startX, y: startY });
    ghostHeightSV.set(GHOST_HEIGHT);

    const origin = { x: rootBounds.current.x, y: rootBounds.current.y };
    overlayOriginSV.set(origin);
    const defaultRowRect: ScreenRect = {
      x: origin.x + 20,
      y: startY - GHOST_HEIGHT / 2,
      width: fallbackWidth,
      height: GHOST_HEIGHT,
    };
    rowRectSV.set(defaultRowRect);
    const initialPos = computeGhostPosition(
      { x: startX, y: startY },
      { x: startX, y: startY },
      defaultRowRect,
      origin,
      GHOST_HEIGHT,
      LIFT_OFFSET_Y,
    );
    ghostLeftSV.set(initialPos.left);
    ghostTopSV.set(initialPos.top);

    if (reducedMotion) {
      ghostOpacitySV.set(1);
      ghostScaleSV.set(1.02);
    } else {
      ghostOpacitySV.set(withTiming(1, { duration: 120, easing: Easing.out(Easing.cubic) }));
      ghostScaleSV.set(0.96);
      ghostScaleSV.set(withSpring(1.03, { damping: 20, stiffness: 320, mass: 0.7 }));
    }

    setHoveredMeal(null);
    setActiveDrag(initialDrag);
    onDraggingChangeRef.current?.(true);
    hapticMedium();

    measureAllZones(generation);
    startAutoScroll(generation);

    rowNode?.measureInWindow((x, y, width, height) => {
      if (!mountedRef.current || generation !== sessionRef.current || width <= 0 || height <= 0) return;
      const clampedWidth = Math.max(200, Math.min(width + 16, Math.max(240, (rootBounds.current.width || 360) - 24)));
      const clampedX = Math.max(
        rootBounds.current.x + 12,
        Math.min(x - 8, rootBounds.current.x + (rootBounds.current.width || 360) - clampedWidth - 12),
      );
      const measuredRect: ScreenRect = { x: clampedX, y, width: clampedWidth, height: Math.max(GHOST_HEIGHT, height) };
      rowRectSV.set(measuredRect);
      const updated = { ...initialDrag, ghostWidth: clampedWidth, ghostHeight: GHOST_HEIGHT };
      activeDragRef.current = updated;
      setActiveDrag(updated);
      const latestPointer = lastPointerRef.current ?? { x: startX, y: startY };
      const pos = computeGhostPosition(
        latestPointer,
        { x: startX, y: startY },
        measuredRect,
        { x: rootBounds.current.x, y: rootBounds.current.y },
        GHOST_HEIGHT,
        LIFT_OFFSET_Y,
      );
      ghostLeftSV.set(pos.left);
      ghostTopSV.set(pos.top);
    });
  }, [
    disabled,
    ghostHeightSV,
    ghostLeftSV,
    ghostOpacitySV,
    ghostScaleSV,
    ghostTopSV,
    measureAllZones,
    overlayOriginSV,
    reducedMotion,
    rowRectSV,
    startAutoScroll,
    startPointerSV,
  ]);

  const updateDrag = useCallback((x: number, y: number) => {
    const current = activeDragRef.current;
    if (!current) return;
    lastPointerRef.current = { x, y };
    const hit = findDropTargetMeal({ x, y }, dropZones.current);
    const nextHover = hit && hit !== current.sourceMeal ? hit : null;
    if (hoveredMealRef.current !== nextHover) {
      hoveredMealRef.current = nextHover;
      setHoveredMeal(nextHover);
      if (nextHover) {
        hapticSelection();
        if (!reducedMotion) {
          ghostScaleSV.set(withSpring(1.05, { damping: 20, stiffness: 360, mass: 0.65 }));
        }
      } else if (!reducedMotion) {
        ghostScaleSV.set(withSpring(1.02, { damping: 22, stiffness: 320, mass: 0.7 }));
      }
    }
  }, [ghostScaleSV, reducedMotion]);

  const clearDrag = useCallback(() => {
    stopAutoScroll();
    if (!activeDragRef.current) return;
    activeDragRef.current = null;
    hoveredMealRef.current = null;
    lastPointerRef.current = null;
    sessionRef.current += 1;
    suppressTapUntilRef.current = Date.now() + 360;
    ghostOpacitySV.set(0);
    ghostScaleSV.set(0.95);
    setHoveredMeal(null);
    setActiveDrag(null);
    onDraggingChangeRef.current?.(false);
  }, [ghostOpacitySV, ghostScaleSV, stopAutoScroll]);

  const endDrag = useCallback((x: number, y: number, success: boolean) => {
    const current = activeDragRef.current;
    if (!current) return;
    const pointer = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : lastPointerRef.current;
    const hit = success && pointer ? findDropTargetMeal(pointer, dropZones.current) : null;
    const targetMeal = hit && hit !== current.sourceMeal ? hit : null;
    clearDrag();

    if (targetMeal) {
      hapticSuccess();
      setRecentlyDroppedMeal(targetMeal);
      if (dropPulseTimerRef.current) clearTimeout(dropPulseTimerRef.current);
      dropPulseTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setRecentlyDroppedMeal(null);
      }, 900);
      onMoveEntryRef.current(current.entry, targetMeal);
    }
  }, [clearDrag]);

  const cancelDrag = useCallback(() => {
    clearDrag();
  }, [clearDrag]);

  const shouldSuppressTap = useCallback(() => {
    return Boolean(activeDragRef.current) || Date.now() < suppressTapUntilRef.current;
  }, []);

  const dropZoneRefCache = useRef(new Map<string, (node: ComponentRef<typeof View> | null) => void>());
  const registerDropZone = useCallback((meal: string) => {
    const existing = dropZoneRefCache.current.get(meal);
    if (existing) return existing;
    const callback = (node: ComponentRef<typeof View> | null) => {
      if (node) dropZoneNodes.current.set(meal, node);
      else dropZoneNodes.current.delete(meal);
    };
    dropZoneRefCache.current.set(meal, callback);
    return callback;
  }, []);

  const ghostAnimatedStyle = useAnimatedStyle(() => ({
    opacity: ghostOpacitySV.value,
    transform: [
      { translateX: ghostLeftSV.value },
      { translateY: ghostTopSV.value },
      { scale: ghostScaleSV.value },
    ],
  }));

  const contextValue = useMemo<MealEntryDragContextValue>(() => ({
    isDragging: Boolean(activeDrag),
    draggingEntryId: activeDrag?.entry.id ?? null,
    draggingFromMeal: activeDrag?.sourceMeal ?? null,
    hoveredMeal,
    recentlyDroppedMeal,
    disabled,
    registerDropZone,
    shouldSuppressTap,
    startDrag,
    updateDrag,
    endDrag,
    cancelDrag,
    ghostLeftSV,
    ghostTopSV,
    rowRectSV,
    overlayOriginSV,
    startPointerSV,
    ghostHeightSV,
  }), [
    activeDrag,
    cancelDrag,
    disabled,
    endDrag,
    ghostHeightSV,
    ghostLeftSV,
    ghostTopSV,
    hoveredMeal,
    overlayOriginSV,
    recentlyDroppedMeal,
    registerDropZone,
    rowRectSV,
    shouldSuppressTap,
    startDrag,
    startPointerSV,
    updateDrag,
  ]);

  return (
    <MealEntryDragContext.Provider value={contextValue}>
      <View
        ref={rootRef}
        collapsable={false}
        style={styles.root}
        onLayout={() => {
          rootRef.current?.measureInWindow((x, y, width, height) => {
            if (!mountedRef.current) return;
            rootBounds.current = { x, y, width, height };
            overlayOriginSV.set({ x, y });
          });
        }}
      >
        {children}
        {activeDrag ? (
          <View pointerEvents="none" style={styles.overlay}>
            <Animated.View
              style={[
                styles.ghost,
                { width: activeDrag.ghostWidth, minHeight: activeDrag.ghostHeight },
                hoveredMeal ? styles.ghostReady : null,
                ghostAnimatedStyle,
              ]}
            >
              <View style={[styles.ghostIcon, hoveredMeal ? styles.ghostIconReady : null]}>
                <DoopIcon
                  name={inferFoodGlyph(activeDrag.entry.food.name)}
                  size={18}
                  color={hoveredMeal ? colors.onAccent : colors.accent}
                />
              </View>
              <View style={styles.ghostCopy}>
                <Text numberOfLines={1} style={styles.ghostTitle}>
                  {activeDrag.entry.food.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.ghostMeta, hoveredMeal ? styles.ghostMetaReady : null]}
                >
                  {hoveredMeal
                    ? `Drop in ${hoveredMeal}`
                    : `${number(activeDrag.entry.quantity.amount, 2)} ${activeDrag.entry.quantity.unit} · Drag to a meal`}
                </Text>
              </View>
              <Text style={styles.ghostKcal}>
                {number(energyValue(activeDrag.entry.nutrients.kcal, energyUnit))}
                <Text style={styles.ghostUnit}>{` ${energyUnit}`}</Text>
              </Text>
            </Animated.View>
          </View>
        ) : null}
      </View>
    </MealEntryDragContext.Provider>
  );
}

export function useMealEntryDrag() {
  return useContext(MealEntryDragContext);
}

export interface DraggableEntryRowProps {
  entry: DiaryEntrySnapshot;
  sourceMeal: string;
  disabled?: boolean;
  /** Optional custom style applied to the wrapper View. */
  style?: StyleProp<ViewStyle>;
  /** Dim the original slot while this entry is being dragged. Defaults to true. */
  dimWhileDragging?: boolean;
  children: ReactNode;
}

/**
 * Wraps a diary food item row so holding for 240ms lifts it into the floating
 * drag ghost while preserving quick taps and normal vertical scrolling.
 */
export function DraggableEntryRow({
  entry,
  sourceMeal,
  disabled = false,
  style,
  dimWhileDragging = true,
  children,
}: DraggableEntryRowProps) {
  const drag = useMealEntryDrag();
  const rowRef = useRef<ComponentRef<typeof View> | null>(null);
  const pressScale = useSharedValue(1);
  const reducedMotion = useReducedMotion();

  const entryRef = useRef(entry);
  const sourceMealRef = useRef(sourceMeal);
  useLayoutEffect(() => {
    entryRef.current = entry;
    sourceMealRef.current = sourceMeal;
  }, [entry, sourceMeal]);

  const handleStart = useCallback((x: number, y: number) => {
    drag?.startDrag(entryRef.current, sourceMealRef.current, rowRef.current, x, y);
  }, [drag]);

  const handleUpdate = useCallback((x: number, y: number) => {
    drag?.updateDrag(x, y);
  }, [drag]);

  const handleEnd = useCallback((x: number, y: number, success: boolean) => {
    drag?.endDrag(x, y, success);
  }, [drag]);

  const handleCancel = useCallback(() => {
    drag?.cancelDrag();
  }, [drag]);

  const enabled = Boolean(drag) && !drag?.disabled && !disabled;
  const ghostLeftSV = drag?.ghostLeftSV;
  const ghostTopSV = drag?.ghostTopSV;
  const rowRectSV = drag?.rowRectSV;
  const overlayOriginSV = drag?.overlayOriginSV;
  const startPointerSV = drag?.startPointerSV;
  const ghostHeightSV = drag?.ghostHeightSV;

  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(() => {
    return Gesture.Pan()
      .enabled(enabled)
      .activateAfterLongPress(240)
      .minDistance(10_000)
      .maxPointers(1)
      .shouldCancelWhenOutside(false)
      .onBegin(() => {
        if (!reducedMotion) {
          pressScale.set(withTiming(0.985, { duration: 180, easing: Easing.out(Easing.quad) }));
        }
      })
      .onStart(event => {
        pressScale.set(1);
        scheduleOnRN(handleStart, event.absoluteX, event.absoluteY);
      })
      .onUpdate(event => {
        if (ghostLeftSV && ghostTopSV && rowRectSV && overlayOriginSV && startPointerSV && ghostHeightSV) {
          const sway = Math.max(-28, Math.min(28, (event.absoluteX - startPointerSV.value.x) * 0.22));
          ghostLeftSV.set(rowRectSV.value.x - overlayOriginSV.value.x + sway);
          ghostTopSV.set(event.absoluteY - overlayOriginSV.value.y - ghostHeightSV.value / 2 - LIFT_OFFSET_Y);
        }
        scheduleOnRN(handleUpdate, event.absoluteX, event.absoluteY);
      })
      .onEnd((event, success) => {
        scheduleOnRN(handleEnd, event.absoluteX, event.absoluteY, success);
      })
      .onFinalize(() => {
        pressScale.set(withTiming(1, { duration: 120 }));
        scheduleOnRN(handleCancel);
      });
  }, [
    enabled,
    ghostHeightSV,
    ghostLeftSV,
    ghostTopSV,
    handleCancel,
    handleEnd,
    handleStart,
    handleUpdate,
    overlayOriginSV,
    pressScale,
    reducedMotion,
    rowRectSV,
    startPointerSV,
  ]);
  /* eslint-enable react-hooks/refs */

  const isBeingDragged = drag?.draggingEntryId === entry.id;

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  if (!drag) {
    return <View style={style}>{children}</View>;
  }

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        ref={rowRef}
        collapsable={false}
        style={[
          style,
          animStyle,
          dimWhileDragging && isBeingDragged ? styles.draggingPlaceholder : null,
        ]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

/** Absolute highlight frame behind a meal section so layout and rail alignment never shift. */
export function MealDropHighlight({ state }: { state: 'none' | 'eligible' | 'hovered' | 'landed' }) {
  if (state === 'none') return null;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.dropFrame,
        state === 'eligible' && styles.dropFrameEligible,
        state === 'hovered' && styles.dropFrameHovered,
        state === 'landed' && styles.dropFrameLanded,
      ]}
    />
  );
}

/** Compact pill shown on the right side of a meal row while it is an eligible or active drop target. */
export function MealDropBadge({ active }: { active: boolean }) {
  return (
    <View style={[styles.dropBadge, active ? styles.dropBadgeActive : null]}>
      <Text style={[styles.dropBadgeText, active ? styles.dropBadgeTextActive : null]}>
        {active ? 'Drop here' : 'Move here'}
      </Text>
    </View>
  );
}

export const mealDropStyles = StyleSheet.create({
  iconWellHovered: {
    borderColor: colors.accent,
    borderStyle: 'solid',
    backgroundColor: 'rgba(122,162,247,0.22)',
  },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 999,
    elevation: 32,
  },
  ghost: {
    position: 'absolute',
    left: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.raised,
    borderWidth: 1.5,
    borderColor: colors.border,
    elevation: 18,
    boxShadow: '0 14px 32px rgba(0,0,0,0.55)',
  },
  ghostReady: {
    borderColor: colors.accent,
    backgroundColor: '#292c40',
  },
  ghostIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(122,162,247,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(122,162,247,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostIconReady: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  ghostCopy: { flex: 1, minWidth: 0, gap: 1 },
  ghostTitle: { ...fontFace('bold'), fontSize: 14, color: colors.ink },
  ghostMeta: { ...fontFace('medium'), fontSize: 11, color: colors.muted },
  ghostMetaReady: { ...fontFace('semibold'), color: colors.accent },
  ghostKcal: { ...fontFace('bold'), ...tabularNums, fontSize: 14, color: colors.ink },
  ghostUnit: { ...fontFace('medium'), fontSize: 11, color: colors.muted },
  draggingPlaceholder: {
    opacity: 0.28,
    borderRadius: radius.r12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(122,162,247,0.45)',
    paddingHorizontal: 6,
    marginHorizontal: -6,
  },
  dropFrame: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: -8,
    right: -8,
    borderRadius: 14,
  },
  dropFrameEligible: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(122,162,247,0.34)',
    backgroundColor: 'rgba(122,162,247,0.03)',
  },
  dropFrameHovered: {
    borderWidth: 1.5,
    borderStyle: 'solid',
    borderColor: colors.accent,
    backgroundColor: 'rgba(122,162,247,0.14)',
  },
  dropFrameLanded: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(158,206,106,0.55)',
    backgroundColor: 'rgba(158,206,106,0.08)',
  },
  dropBadge: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(122,162,247,0.35)',
    backgroundColor: 'rgba(122,162,247,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropBadgeActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  dropBadgeText: {
    ...fontFace('semibold'),
    fontSize: 11,
    color: colors.accent,
  },
  dropBadgeTextActive: {
    ...fontFace('bold'),
    color: colors.onAccent,
  },
});
