// buildSeedBlob.js — assemble the localStorage seed blob from curated sets.
//
// Output shape is EXACTLY the localStorage backend's scanStore() shape
// ({ sets: [{ id, title, transition?, flows: [{ slug, title, envelope, updatedAt }] }] }),
// so writing it under STORE_KEY seeds the designer directly. Pure → unit-tested.
export function buildSeedBlob(sets, updatedAt) {
  return {
    sets: sets.map((set) => ({
      id: set.id,
      title: set.title,
      ...(set.transition ? { transition: set.transition } : {}),
      flows: set.flows.map((f) => ({
        slug: f.slug,
        title: f.title,
        envelope: f.envelope,
        updatedAt,
      })),
    })),
  }
}
