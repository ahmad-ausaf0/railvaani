import { CLASS_LABELS } from '@railvaani/train-core';
import type { SearchClass, TrainClass } from '@railvaani/train-core';

/** The classes the search form offers, cheapest first. */
export const TRAIN_CLASSES: TrainClass[] = ['SL', '3A', '3E', '2A', '1A', 'CC', '2S'];

/** The picker's leading option: no single class chosen; cards show every class. */
export const ANY_CLASS: SearchClass = 'ANY';

export function classLabel(c: SearchClass): string {
  return c === 'ANY' ? 'Any class' : CLASS_LABELS[c];
}

/** A class code the form picker and the results URL both accept. */
export function isSelectableClass(value: string): boolean {
  return value === 'ANY' || (TRAIN_CLASSES as string[]).includes(value);
}
