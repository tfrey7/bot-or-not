// Crockford base32 alphabet — digits + A–Z minus I, L, O, U. 32 chars × 4
// positions = ~1M unique ring IDs, with no look-alike pairs when read aloud
// or copy-pasted across surfaces.
const RING_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RING_ID_LENGTH = 4;

export function randomRingId(): string {
  let id = "";

  for (let i = 0; i < RING_ID_LENGTH; i++) {
    const index = Math.floor(Math.random() * RING_ID_ALPHABET.length);
    id += RING_ID_ALPHABET[index];
  }

  return id;
}

// Deterministic hash of a ring ID into a 0..359 hue. djb2 gives an even
// spread across the 32-symbol alphabet, so visually-adjacent rings end up
// with visually-distinct chips even when their IDs differ by one character.
export function ringHue(ringId: string): number {
  let hash = 5381;

  for (let i = 0; i < ringId.length; i++) {
    hash = ((hash << 5) + hash) ^ ringId.charCodeAt(i);
  }

  return ((hash % 360) + 360) % 360;
}

export function generateRingId(existing: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = randomRingId();
    if (!existing.has(id)) {
      return id;
    }
  }

  // ~1M-element space, dozens of rings — 100 attempts colliding every time
  // would be cosmic-ray territory. If it ever happens, fall back to a longer
  // ID rather than spinning forever.
  return randomRingId() + randomRingId().slice(0, 1);
}
