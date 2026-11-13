import { CLASS_LABELS } from '@railvaani/train-core';
import type { TrainClass } from '@railvaani/train-core';

/** The classes the search form offers, cheapest first. */
export const TRAIN_CLASSES: TrainClass[] = ['SL', '3A', '3E', '2A', '1A', 'CC', '2S'];

export function classLabel(c: TrainClass): string {
  return CLASS_LABELS[c];
}
