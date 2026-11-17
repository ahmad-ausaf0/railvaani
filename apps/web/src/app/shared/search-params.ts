/** A validated search, straight from the /results query params. Class-free:
 *  every search runs the engine's Any-class path; a cls parameter left over
 *  in an old saved link is ignored. */
export interface SearchParams {
  from: string;
  to: string;
  date: string;
  quota: string;
  budget?: number;
}

/** Today in India, as YYYY-MM-DD (UTC arithmetic; India has no DST). */
export function istToday(): string {
  const d = new Date(Date.now() + (5 * 60 + 30) * 60_000);
  return d.toISOString().slice(0, 10);
}

/** Parses and validates the /results query params. Null sends the user back to the form. */
export function parseSearchParams(
  raw: Record<string, string | undefined>,
  today = istToday(),
): SearchParams | null {
  const from = (raw['from'] ?? '').trim().toUpperCase();
  const to = (raw['to'] ?? '').trim().toUpperCase();
  const date = (raw['date'] ?? '').trim();
  const quota = (raw['quota'] ?? '').trim() || 'GN';
  if (!from || !to || from === to) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) return null;
  const budgetRaw = raw['budget']?.trim();
  let budget: number | undefined;
  if (budgetRaw) {
    const n = Number(budgetRaw);
    if (!Number.isFinite(n) || n <= 0) return null;
    budget = n;
  }
  return { from, to, date, quota, budget };
}
