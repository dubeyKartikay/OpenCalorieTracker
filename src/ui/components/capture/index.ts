/**
 * Capture-surface cards for Wave 5C.
 *
 * Presentational only: barcode, custom-food, draft and ChatGPT settings cards
 * take plain props, render with the Doop Tokyo Night tokens, and leave all
 * persistence and AI wiring to the screens that mount them.
 */
export { AIFailedCard, DraftAskChips, DraftItemCard, MealDraftPanel, SparklePromptRow } from './DraftCards';
export type {
  AIFailedCardProps,
  DraftAskChipsProps,
  DraftAskOption,
  DraftItemCardProps,
  DraftPortionCertainty,
  MealDraftPanelProps,
  SparklePromptRowProps,
} from './DraftCards';

export {
  BarcodeFoundCard,
  BarcodeNotFoundCard,
  BarSeg,
  CustomFoodFormCard,
  SegmentedSwitch,
} from './BarcodeCards';
export type {
  BarcodeFoundCardProps,
  BarcodeNotFoundCardProps,
  BarcodePortion,
  BarSegProps,
  CustomFoodBasis,
  CustomFoodFormCardProps,
  CustomFoodFormValues,
  SegmentedSwitchOption,
  SegmentedSwitchProps,
} from './BarcodeCards';

export { ChatGPTConnectionCard } from './ChatGPTCards';
export type { AIModelChoice, ChatGPTConnectionCardProps } from './ChatGPTCards';
export { pickMealImage } from './PhotoPicker';
export type { PickedMealImage } from './PhotoPicker';
