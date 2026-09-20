/**
 * Chains that don't publish prices, and how their prices compare to the ones that do.
 *
 * Price levels come from Consumer Reports' 2025 grocery study, which priced the same
 * baskets in six metros (Boston, Chicago, Dallas/Fort Worth, Denver, Los Angeles and
 * Virginia Beach) and compared every chain with Walmart. They are averages over a whole
 * basket, so they say how expensive a chain is overall, not what any one item costs.
 * That is why anything built on them is shown as an estimate.
 */

export interface Chain {
  key: string;
  label: string;
  /** Price level against Walmart = 1.00. Lower is cheaper. */
  level: number;
  /** Needs a paid membership to shop. */
  membership?: boolean;
  /** Mostly sells its own brands, so national-brand items are unlikely to be on the shelf. */
  storeBrandOnly?: boolean;
  /** Matches the start of an OpenStreetMap `brand` or `name`. */
  pattern: RegExp;
}

export const CHAINS: Chain[] = [
  { key: 'walmart', label: 'Walmart', level: 1.0, pattern: /^walmart\b/i },
  { key: 'costco', label: 'Costco', level: 0.786, membership: true, pattern: /^costco\b/i },
  { key: 'bjs', label: "BJ's", level: 0.79, membership: true, pattern: /^bj['’]?s\b/i },
  { key: 'lidl', label: 'Lidl', level: 0.915, storeBrandOnly: true, pattern: /^lidl\b/i },
  { key: 'aldi', label: 'Aldi', level: 0.917, storeBrandOnly: true, pattern: /^aldi\b/i },
  { key: 'winco', label: 'WinCo', level: 0.967, pattern: /^winco\b/i },
  { key: 'heb', label: 'H-E-B', level: 0.998, pattern: /^h[-.\s]?e[-.\s]?b\b/i },
  { key: 'target', label: 'Target', level: 1.059, pattern: /^target\b/i },
  { key: 'safeway', label: 'Safeway', level: 1.088, pattern: /^safeway\b/i },
  { key: 'wholefoods', label: 'Whole Foods', level: 1.397, pattern: /^whole foods\b/i },
];

/** Kroger's own level in the same study. Real Kroger prices are the anchor estimates are scaled from. */
export const KROGER_LEVEL = 1.148;

export function chainByKey(key: string | undefined): Chain | undefined {
  return CHAINS.find((c) => c.key === key);
}

/** Which chain an OpenStreetMap place is, from its brand, name or operator. Null for any other shop. */
export function chainFromNames(names: (string | undefined)[]): Chain | null {
  for (const raw of names) {
    const name = raw?.trim();
    if (!name) continue;
    const hit = CHAINS.find((c) => c.pattern.test(name));
    if (hit) return hit;
  }
  return null;
}

/** How many times a real Kroger price to multiply by to guess this chain's price for the same item. */
export function scaleFromKroger(chain: Chain): number {
  return chain.level / KROGER_LEVEL;
}
