export function money(cents: number, opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toFixed(2);
  const body = `$${dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  if (cents < 0) return `−${body}`;
  return opts.sign && cents > 0 ? `+${body}` : body;
}

/** Whole dollars when the amount is round, e.g. slider labels. */
export function moneyShort(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : money(cents);
}

export function miles(m: number): string {
  return `${m.toFixed(1)} mi`;
}

export function minutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} hr` : `${h} hr ${r} min`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
