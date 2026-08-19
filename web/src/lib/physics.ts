/**
 * The few physical constants and conversions the interface needs to display.
 *
 * Nothing here computes a result — every number shown comes from the engine.
 * What lives here is the translation between two descriptions of the same
 * channel, which the interface has to do because it offers both.
 */

/**
 * Attenuation length of a standard fibre at 0.2 dB/km.
 *
 * The same constant as `FIBRE_ATTENUATION_LENGTH_KM` in `qkd/channels.py`. It is
 * duplicated rather than fetched because it is a property of the fibre, not of
 * the build — but if the backend ever changes it, this has to follow.
 */
export const L0_KM = 21.714724;

/** γ = 1 − exp(−L/L₀). */
export const gammaFromLength = (km: number): number => 1 - Math.exp(-km / L0_KM);

/** The inverse, clamped short of γ = 1 where the length would diverge. */
export const lengthFromGamma = (gamma: number): number =>
  -L0_KM * Math.log(1 - Math.min(0.985, gamma));

/** Tsirelson's bound: the largest S quantum mechanics allows. */
export const TSIRELSON = 2 * Math.SQRT2;

/** The classical bound a local hidden-variable model cannot exceed. */
export const CLASSICAL_BOUND = 2;

export const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * The smallest E91 run the backend can actually evaluate.
 *
 * With nine angle combinations a very short run can leave one CHSH setting with
 * no samples at all, and the correlator has nothing to average — the engine
 * raises rather than inventing a number. Below this the interface refuses first
 * and says why, which is more useful than a 500.
 */
export const MIN_E91_PAIRS = 100;
