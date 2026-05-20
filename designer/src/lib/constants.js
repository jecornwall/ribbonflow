/**
 * Designer-app constants. Kept tiny and centralised so the editor canvas,
 * the mutation layer, and the inspector agree on shared values.
 */

/** Radius (in flow/viewBox units) of a node handle on the editor canvas. */
export const NODE_RADIUS = 16

/**
 * Default vertical gap between a node and its label, in viewBox units.
 * `setLabelSide` resets `labelDy` to ±LABEL_GAP; the user then fine-tunes by
 * dragging the label handle. Chosen to clear the default 70-unit band.
 */
export const LABEL_GAP = 70

/**
 * Defaults stamped onto a node created on the canvas — the v1.1 node controls
 * (LENGTH / SPEED / WIDTH) plus the per-node colour scheme. These match the
 * library's NODE_DEFAULTS (format/model.js); kept here so the pure mutation
 * layer stays library-import-free for headless tests.
 */
export const NEW_NODE_LENGTH = 0.8
export const NEW_NODE_SPEED = 1.0
export const NEW_NODE_WIDTH = 70
export const NEW_NODE_COLOR_SCHEME = 'neutral'

/** Default emit rate for a node switched to kind:'source'. */
export const DEFAULT_SOURCE_RATE = 1.0

/**
 * Defaults stamped onto a rejection edge created by the add-rejection tool —
 * mirrors the library's DEFAULT_REJECTION_RATE / DEFAULT_REJECTION_BOW_DEPTH
 * (format/model.js §2.3); kept here so the pure mutation layer stays
 * library-import-free for headless tests. The bow side is auto-picked per
 * edge (opposite the `from` node's label) rather than a constant — see
 * flowMutations.addRejection.
 */
export const NEW_REJECTION_RATE = 0.15
export const NEW_REJECTION_BOW_DEPTH = 80

/**
 * Grid pitch (viewBox units) for the optional snap-to-grid mode. When the
 * mode is enabled, node moves / creation snap x and y to the nearest multiple
 * of this value, keeping placements aligned (bd ai-engineer-esx8). 40 over a
 * 1600×900 viewBox gives a 40×~22 lattice — coarse enough to read as
 * alignment, fine enough not to fight intentional placement.
 */
export const GRID_SIZE = 40

/**
 * v1.3 large particles (spec §5). A source emits one particle size; a node
 * may `transform` arriving particles (split / combine). These mirror the
 * library's DEFAULT_PARTICLE_SIZE / DEFAULT_SPLIT_COUNT / DEFAULT_COMBINE_COUNT
 * (format/model.js §2.3) — kept here so the pure mutation layer stays
 * library-import-free for headless tests.
 */
export const DEFAULT_PARTICLE_SIZE = 'small'
export const NEW_SPLIT_COUNT = 4
export const NEW_COMBINE_COUNT = 4
