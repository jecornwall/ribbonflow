/**
 * framePref.js — the designer's remembered aspect-ratio preset (bd ai-engineer-zr7k §7.1).
 *
 * The frame is a PER-DOCUMENT property (a flow's own viewBox), but the last
 * preset the author picked is additionally remembered as a small app
 * preference, used ONLY to seed the viewBox of newly created flows. Keeping the
 * localStorage access here (behind a storage shim) keeps useFlowDoc free of
 * direct storage calls and makes this unit-testable headless.
 *
 * Pure-ish: storage is injected (defaults to globalThis.localStorage) and every
 * access is wrapped so an absent / throwing storage (SSR, private mode, tests)
 * degrades to the default rather than crashing the designer.
 */

import { FRAME_PRESETS } from './slideFrame.js'

/** localStorage key for the remembered preset. Versioned for forward-compat. */
export const FRAME_PREF_KEY = 'ribbonflow.designer.framePref.v1'

/** The fallback preset when none is remembered (keeps 16:9 the default). */
export const DEFAULT_FRAME_PREF = '16:9'

function resolveStorage(storage) {
  if (storage !== undefined) return storage
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

/** True when `name` is one of the known preset keys. */
function isKnownPreset(name) {
  return Object.prototype.hasOwnProperty.call(FRAME_PRESETS, name)
}

/**
 * Read the remembered preset name, defaulting to '16:9' when unset, junk, or
 * unreadable.
 *
 * @param {{getItem(k:string):?string}} [storage] — defaults to localStorage
 * @returns {'16:9'|'4:3'|'1:1'}
 */
export function readFramePref(storage) {
  const s = resolveStorage(storage)
  if (!s || typeof s.getItem !== 'function') return DEFAULT_FRAME_PREF
  try {
    const value = s.getItem(FRAME_PREF_KEY)
    return isKnownPreset(value) ? value : DEFAULT_FRAME_PREF
  } catch {
    return DEFAULT_FRAME_PREF
  }
}

/**
 * Remember a preset name. Unknown names are ignored; a missing / throwing
 * storage is a silent no-op (the in-document viewBox is the source of truth).
 *
 * @param {string} name
 * @param {{setItem(k:string,v:string):void}} [storage] — defaults to localStorage
 */
export function writeFramePref(name, storage) {
  if (!isKnownPreset(name)) return
  const s = resolveStorage(storage)
  if (!s || typeof s.setItem !== 'function') return
  try {
    s.setItem(FRAME_PREF_KEY, name)
  } catch {
    // ignore — remembering the preset is best-effort
  }
}
