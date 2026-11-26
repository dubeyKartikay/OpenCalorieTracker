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
export { consumePendingMealPhoto, setPendingMealPhoto } from './pendingMealPhoto';
export type { PendingMealPhoto } from './pendingMealPhoto';
export { mergeDictatedTranscript, useVoiceDictation, VoiceDock, VoiceMicRing } from './VoiceDock';
export type { UseVoiceDictationOptions, VoiceDictationController, VoiceDockProps, VoiceMicRingProps } from './VoiceDock';
export { LocalFoodSearchPager, MealComposerField, MealComposerFooter, useMealInlineComposer, useScrollNodeIntoView, useScrollToMealComposer } from './MealInlineComposer';
export type { LocalFoodSearchPagerProps, MealInlineComposerController, UseMealInlineComposerOptions } from './MealInlineComposer';
export { isDraftForMeal, MealActiveDraftBlock, MealDraftAuxBlock } from './MealDraftSection';
export type { MealActiveDraftBlockProps, MealDraftAuxBlockProps } from './MealDraftSection';
export { CUSTOM_FOOD_BASIS_OPTIONS, customFoodNutrientFields, parseCustomFoodNutrients, parseNonNegativeNumber } from './customFoodForm';
export type { CustomFoodNutrientInputs, CustomFoodNutrientKey } from './customFoodForm';
