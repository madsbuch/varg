/**
 * The Varg wolf: one geometry shared by the in-app <Mark/> and the app
 * icon (scripts/make-icon.ts), so the two never drift apart.
 *
 * A front-facing wolf head on a 48-unit grid in the manner of Viking animal
 * art: a carved, jagged ruff, spiral curls on the cheeks (the Mammen-style
 * joint spiral), long sweeping eyes and a gem on the brow.
 * Drawn as strokes over a faint fill, the same line language as the app's
 * other icons.
 */

/** Head silhouette: ears, ruff, jaw. */
export const WOLF_HEAD =
  "M11 3.5 L19 12.5 L24 11 L29 12.5 L37 3.5 L38.5 15.5 L43.5 20 L39.5 23.5 L43 28.5 L36.5 30.5 L29.5 39.5 L24 44.5 L18.5 39.5 L11.5 30.5 L5 28.5 L8.5 23.5 L4.5 20 L9.5 15.5 Z";

/** Inner ears: a carved line down each ear. */
export const WOLF_EARS = "M12.5 8 L16.5 14.5 M35.5 8 L31.5 14.5";

/** The brow, a hard V between the eyes. */
export const WOLF_BROW = "M14 19.5 L24 23.5 L34 19.5";

/** Eyes: long almonds sweeping back toward the ears, filled. */
export const WOLF_EYES = "M13.5 22 L21.5 25.3 L18.5 26.6 Z M34.5 22 L26.5 25.3 L29.5 26.6 Z";

/** The brow gem: a diamond, the knot of the app's dividers. Filled. */
export const WOLF_GEM = "M24 13.5 L26 16.5 L24 19.5 L22 16.5 Z";

/** Muzzle: the bridge, widening down to the nose. */
export const WOLF_MUZZLE = "M22 27.5 L20.5 33 M26 27.5 L27.5 33";

/** Nose, filled. */
export const WOLF_NOSE = "M19.5 33 L28.5 33 L24 37 Z";

/** Mouth: the split from the nose down the chin. */
export const WOLF_MOUTH = "M24 37 L24 40.5";

/** Cheek spirals: from the ruff's notch, curling in on themselves. */
export const WOLF_CHEEKS =
  "M8.5 23.5 C12.5 23.5 15.5 26.2 14.6 29 C13.9 31 11.2 30.6 11.4 28.6 C11.5 27.6 12.6 27.3 13.1 28 " +
  "M39.5 23.5 C35.5 23.5 32.5 26.2 33.4 29 C34.1 31 36.8 30.6 36.6 28.6 C36.5 27.6 35.4 27.3 34.9 28";

/** Every stroked detail in drawing order, for renderers that loop. */
export const WOLF_LINES = [WOLF_EARS, WOLF_CHEEKS, WOLF_BROW, WOLF_MUZZLE, WOLF_MOUTH];
