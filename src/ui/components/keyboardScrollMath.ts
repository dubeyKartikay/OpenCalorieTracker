export interface KeyboardScrollInput {
  /** Current ScrollView contentOffset.y */
  currentScrollY: number;
  /** ScrollView top edge in window coordinates */
  scrollViewTop: number;
  /** Optional ScrollView height in window coordinates (caps visible bottom above tab bars / resized windows) */
  scrollViewHeight?: number;
  /** Target node top edge in window coordinates */
  nodeTop: number;
  /** Target node height */
  nodeHeight: number;
  /** Window height (full screen height) */
  windowHeight: number;
  /** Active soft keyboard height in dp (0 when closed) */
  keyboardHeight: number;
  /** Breathing room below the target node above the keyboard (default 18) */
  bottomMargin?: number;
  /** Minimum breathing room below the ScrollView top edge (default 12) */
  topMargin?: number;
}

/**
 * Computes the target `scrollTo({ y })` offset needed to keep a form/input node
 * completely visible above the soft keyboard without scrolling its top edge off-screen.
 * Returns `null` when the node is already comfortably visible.
 */
export function computeScrollTargetAboveKeyboard({
  currentScrollY,
  scrollViewTop,
  scrollViewHeight,
  nodeTop,
  nodeHeight,
  windowHeight,
  keyboardHeight,
  bottomMargin = 18,
  topMargin = 12,
}: KeyboardScrollInput): number | null {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return null;
  const safeKeyboard = Math.max(0, Number.isFinite(keyboardHeight) ? keyboardHeight : 0);
  const keyboardTop = windowHeight - safeKeyboard;
  const scrollBottom = scrollViewHeight != null && Number.isFinite(scrollViewHeight) && scrollViewHeight > 0
    ? scrollViewTop + scrollViewHeight
    : windowHeight;
  const visibleBottom = Math.min(scrollBottom, keyboardTop) - bottomMargin;
  const visibleTop = scrollViewTop + topMargin;
  const nodeBottom = nodeTop + Math.max(0, nodeHeight);

  // If the top of the node is scrolled above the visible viewport, bring it down.
  if (nodeTop < visibleTop) {
    return Math.max(0, currentScrollY - (visibleTop - nodeTop));
  }

  // If the bottom of the node is covered by (or too close to) the keyboard, scroll it up.
  if (nodeBottom > visibleBottom) {
    const neededShift = nodeBottom - visibleBottom;
    // Never push the node's top edge above `visibleTop`.
    const maxShift = Math.max(0, nodeTop - visibleTop);
    const shift = Math.min(neededShift, maxShift);
    if (shift < 2) return null;
    return Math.max(0, currentScrollY + shift);
  }

  return null;
}
