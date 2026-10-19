const RANDOM_BYTES = 1024;

export function browserRandom() {
  return Array.from(crypto.getRandomValues(new Uint8Array(RANDOM_BYTES)));
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
