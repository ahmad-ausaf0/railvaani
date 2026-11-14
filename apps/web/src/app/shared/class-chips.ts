import type { Availability } from '@railvaani/train-core';
import type { LegClassOption } from '@railvaani/split-engine';

import { availTone, stampText } from './stamps';

/** One per-class chip on a direct card in Any-class mode. */
export interface ClassChip {
  /** Class code, e.g. 'SL'. */
  cls: string;
  fare: number;
  /** Stamp text for the class's seat status, e.g. 'Available 50', 'WL 12'. */
  status: string;
  /** Colour class for the status text, the same tones as the card's stamps. */
  tone: string;
  availability: Availability;
}

/** The chip row for a direct card in Any-class mode; empty in single-class mode.
 *  Order follows the leg's per-class list, cheapest class first. */
export function classChips(perClass: LegClassOption[] | undefined): ClassChip[] {
  if (!perClass?.length) return [];
  return perClass.map((e) => ({
    cls: e.cls,
    fare: e.fare,
    status: stampText(e.availability),
    tone: availTone(e.availability),
    availability: e.availability,
  }));
}
