/**
 * Helpers for the contract's one convention: `null` means "not applicable".
 *
 * They exist so that no component reaches for `?? 0`. The Bell parameter is
 * null in BB84 because there is no entangled pair, and what an eavesdropper
 * knows is null when nobody is listening; rendering either as zero would state
 * a measurement that was never made — a violation with no violation, or an
 * eavesdropper who learned nothing while standing on the line.
 *
 * A chart drops those points. A readout says so in words.
 */

/** True when a value was actually measured. */
export function measured<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * A number for display, or the placeholder that stands for "not applicable".
 *
 * The placeholder is an em dash rather than "0" or "N/A" because it reads as an
 * absence at a glance, which is the whole point.
 */
export function show(value: number | null | undefined, digits = 3): string {
  return measured(value) ? value.toFixed(digits) : "—";
}

/** The same as a percentage, for the error rates. */
export function showPercent(value: number | null | undefined, digits = 2): string {
  return measured(value) ? `${(value * 100).toFixed(digits)}%` : "—";
}

/**
 * Keep only the points that carry a measurement, for plotting.
 *
 * Dropping them is right and interpolating across them is wrong: a gap in a
 * curve says "not measured here", while a line drawn through it claims a value.
 */
export function plottable<T, K extends keyof T>(
  points: T[],
  key: K,
): (T & Record<K, NonNullable<T[K]>>)[] {
  return points.filter((point) => measured(point[key])) as (T & Record<K, NonNullable<T[K]>>)[];
}
