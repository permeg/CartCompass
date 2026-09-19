import type { Product } from './types';

/** Crude English stemmer: enough that "cucumbers", "tomatoes" and "berries" match their singulars. */
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(oes|ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem);
}

/** True when `a` and `b` differ by at most one insertion, deletion or substitution. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  const rest = (s: string, from: number) => s.slice(from);
  return (
    rest(a, i + 1) === rest(b, i + 1) || // substitution
    rest(a, i + 1) === rest(b, i) || // a has an extra letter
    rest(a, i) === rest(b, i + 1) // b has an extra letter
  );
}

/**
 * Score one query word against a product's words: 0 for a prefix match,
 * 1 for a match with one typo, null for no match. Typos are only forgiven
 * on words of four or more letters.
 */
function scoreToken(token: string, haystack: string[]): number | null {
  let best: number | null = null;
  for (const w of haystack) {
    if (w.startsWith(token)) return 0;
    if (token.length >= 4) {
      // Compare against a few prefix lengths, since a typo can add or drop a letter.
      for (const len of [token.length - 1, token.length, token.length + 1]) {
        if (withinOneEdit(token, w.slice(0, len))) best = 1;
      }
    }
  }
  return best;
}

export function searchCatalog(catalog: Product[], query: string, limit = 8): Product[] {
  const tokens = words(query);
  if (tokens.length === 0) return [];

  const scored: { product: Product; score: number; namePos: number }[] = [];
  for (const product of catalog) {
    const nameWords = words(product.name);
    const haystack = [
      ...nameWords,
      ...words(product.size),
      ...words(product.category),
      ...(product.aliases ?? []).flatMap(words),
    ];
    let total = 0;
    let ok = true;
    for (const t of tokens) {
      const s = scoreToken(t, haystack);
      if (s === null) {
        ok = false;
        break;
      }
      total += s;
    }
    if (!ok) continue;
    const pos = nameWords.findIndex((w) => w.startsWith(tokens[0]));
    scored.push({ product, score: total, namePos: pos === -1 ? 99 : pos });
  }

  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.namePos - b.namePos ||
        a.product.name.localeCompare(b.product.name) ||
        a.product.size.localeCompare(b.product.size),
    )
    .slice(0, limit)
    .map((s) => s.product);
}
