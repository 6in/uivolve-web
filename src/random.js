const RANDOM_BYTES = 1024;

export function browserRandom() {
  return Array.from(crypto.getRandomValues(new Uint8Array(RANDOM_BYTES)));
}

// Version 4, variant 10xx, the remaining 122 bits random: the same bits `uuid_string` sets in the
// engine. Built from `getRandomValues` alone, which an insecure context still has, and kept apart
// from `randomProvider` so a fixed provider cannot make two screens share a token.
export function uuidV4() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function validateRandom(value) {
  if (value === undefined) return undefined;
  if (value instanceof Uint8Array && value.length === RANDOM_BYTES) return Array.from(value);
  if (
    Array.isArray(value) &&
    value.length === RANDOM_BYTES &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  )
    return Array.from(value);
  throw new Error("randomには0〜255の整数1,024個が必要です");
}
