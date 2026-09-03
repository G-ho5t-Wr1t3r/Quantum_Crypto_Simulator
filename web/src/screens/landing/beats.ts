/**
 * Turning scroll position into the beats of the story.
 *
 * The unit is one section rather than a pixel count, so the choreography holds
 * whatever the viewport is: `k` is how much of the page one screen occupies, and
 * every beat is placed at a multiple of it. Each beat *completes* while its
 * paragraph is still on screen and then holds, so the reader finishes reading
 * with the finished picture beside them rather than watching it resolve after
 * the words have gone.
 */

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** A ramp from 0 to 1 across [a, b], flat outside it. */
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

/** How many screens of scroll each story section is given. */
const SECTION = 1.7;

export interface Beats {
  grow: number;
  collapse: number;
  implode: number;
  point: number;
  fibre: number;
  pair: number;
  eve: number;
  earth: number;
  earthOut: number;
  fade: number;
}

export function beatsFor(progress: number, viewport: number, scrollHeight: number): Beats {
  // Guarded low as well as high: before layout settles the ratio can be absurd,
  // and an unguarded k would put every beat at once.
  const k = Math.min(0.34, Math.max(0.012, viewport / Math.max(1, scrollHeight - viewport)));
  const at = (index: number, offset: number) => k * (1 + SECTION * index + offset);
  const model = (offset: number) => k * (1 + SECTION * 6 + offset);

  return {
    grow: seg(progress, 0, at(0, 0.35)),
    collapse: seg(progress, at(0, 0.45), at(1, 0.1)),
    implode: seg(progress, at(0, 0.6), at(1, 0.55)),
    point: seg(progress, at(1, 0.45), at(1, 0.95)),
    fibre: seg(progress, at(2, 0), at(2, 0.7)),
    pair: seg(progress, at(3, 0), at(3, 0.65)),
    eve: seg(progress, at(4, 0), at(4, 0.6)),
    earth: seg(progress, at(5, 0), at(5, 0.7)),
    earthOut: seg(progress, model(0.5), model(1.2)),
    fade: seg(progress, model(1.15), model(1.45)),
  };
}
