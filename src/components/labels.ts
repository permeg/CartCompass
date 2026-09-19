export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = 'right' | 'left' | 'top' | 'bottom';

export interface Placed {
  x: number;
  /** Text baseline. */
  y: number;
  anchor: 'start' | 'middle' | 'end';
  rect: Rect;
}

const hits = (a: Rect, b: Rect, pad = 3) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

export function textWidth(text: string, size: number, mono = false): number {
  return text.length * size * (mono ? 0.6 : 0.55);
}

/**
 * Put a label beside a marker on the first side where it fits, avoiding other
 * labels, markers and the frame edge. Falls back to the first side that stays
 * inside the frame if nothing is clear.
 */
export function placeLabel(
  at: { x: number; y: number },
  text: string,
  size: number,
  offset: number,
  sides: Side[],
  taken: Rect[],
  frame: Rect,
  mono = false,
): Placed {
  const tw = textWidth(text, size, mono);
  const th = size + 3;
  const options = sides.map((side): Placed => {
    switch (side) {
      case 'right':
        return { x: at.x + offset, y: at.y + size * 0.35, anchor: 'start', rect: { x: at.x + offset, y: at.y - th / 2, w: tw, h: th } };
      case 'left':
        return { x: at.x - offset, y: at.y + size * 0.35, anchor: 'end', rect: { x: at.x - offset - tw, y: at.y - th / 2, w: tw, h: th } };
      case 'top':
        return { x: at.x, y: at.y - offset - 3, anchor: 'middle', rect: { x: at.x - tw / 2, y: at.y - offset - th, w: tw, h: th } };
      case 'bottom':
        return { x: at.x, y: at.y + offset + th - 3, anchor: 'middle', rect: { x: at.x - tw / 2, y: at.y + offset, w: tw, h: th } };
    }
  });
  const inside = (r: Rect) =>
    r.x >= frame.x && r.y >= frame.y && r.x + r.w <= frame.x + frame.w && r.y + r.h <= frame.y + frame.h;
  const clear = options.find((o) => inside(o.rect) && !taken.some((t) => hits(o.rect, t)));
  const chosen = clear ?? options.find((o) => inside(o.rect)) ?? options[0];
  taken.push(chosen.rect);
  return chosen;
}

/** Try to place a label centred on a point. Returns null when it would collide. */
export function placeCentered(
  at: { x: number; y: number },
  text: string,
  size: number,
  taken: Rect[],
  frame: Rect,
): Placed | null {
  const tw = textWidth(text, size, true);
  const th = size + 3;
  const rect = { x: at.x - tw / 2, y: at.y - th / 2, w: tw, h: th };
  if (rect.x < frame.x || rect.y < frame.y || rect.x + tw > frame.x + frame.w || rect.y + th > frame.y + frame.h) return null;
  if (taken.some((t) => hits(rect, t, 2))) return null;
  taken.push(rect);
  return { x: at.x, y: at.y + size * 0.35, anchor: 'middle', rect };
}
