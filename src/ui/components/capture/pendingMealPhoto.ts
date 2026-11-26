import type { PickedMealImage } from './PhotoPicker';

export interface PendingMealPhoto {
  meal: string;
  photo: PickedMealImage;
  date?: string;
  returnTab?: 'today' | 'history';
}

let pendingMealPhoto: PendingMealPhoto | null = null;

/** Stores a freshly captured camera photo in memory for Today or History to pick up on focus. */
export function setPendingMealPhoto(handoff: PendingMealPhoto | null): void {
  pendingMealPhoto = handoff;
}

/** Consumes and clears any pending meal photo captured for the matching destination tab. */
export function consumePendingMealPhoto(expectedTab?: 'today' | 'history'): PendingMealPhoto | null {
  const current = pendingMealPhoto;
  if (!current) return null;
  if (expectedTab && current.returnTab && current.returnTab !== expectedTab) return null;
  pendingMealPhoto = null;
  return current;
}
