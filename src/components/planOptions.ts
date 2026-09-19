import type { Plan, PlanSet } from '../domain/types';

export interface PlanOption {
  plan: Plan;
  /** Why this plan is on the list, e.g. ["Recommended", "Cheapest"]. */
  tags: string[];
}

/**
 * The handful of plans worth comparing, de-duplicated: when the recommended plan
 * is also the cheapest, it appears once with both tags.
 */
export function planOptions(set: PlanSet, recommended: Plan): PlanOption[] {
  const candidates: [string, Plan | null][] = [
    ['Recommended', recommended],
    ['Cheapest', set.cheapest],
    ['Fastest', set.fastest],
    ['Nearest store only', set.baseline],
  ];
  const out: PlanOption[] = [];
  for (const [tag, plan] of candidates) {
    if (!plan) continue;
    const existing = out.find((o) => o.plan.id === plan.id);
    if (existing) existing.tags.push(tag);
    else out.push({ plan, tags: [tag] });
  }
  return out;
}

/** Savings versus the nearest single store. Null when there is no such store. */
export function savingsVsBaseline(set: PlanSet, plan: Plan): number | null {
  return set.baseline ? set.baseline.total - plan.total : null;
}
