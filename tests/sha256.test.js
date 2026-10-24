import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { sha256 } from "../src/application-loader.js";
import { sha256Hex } from "../src/sha256.js";

const encoder = new TextEncoder();
const expected = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Lengths around the padding edges: 55 is the longest message that fits one block with its
// length, 56 spills into a second block, 64 / 119 / 120 repeat the edge one block later.
const LENGTHS = [0, 1, 55, 56, 63, 64, 65, 119, 120, 1_000_000];
// crypto with getRandomValues but no subtle, the shape an insecure context (plain http) has.
const stubInsecureCrypto = () => {
  vi.stubGlobal("crypto", { getRandomValues: (a) => webcrypto.getRandomValues(a) });
  expect(globalThis.crypto.subtle).toBe(undefined);
};

afterEach(() => vi.unstubAllGlobals());

describe("sha256Hex", () => {
  // main: src/sha256.js does not exist, so the import fails ("Failed to load url ../src/sha256.js").
  it("既知値と一致する", () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex(encoder.encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  // main: src/sha256.js does not exist, so the import fails ("Failed to load url ../src/sha256.js").
  it.each(LENGTHS)("長さ %i のランダムバイト列で node:crypto と一致する", (length) => {
    const bytes = new Uint8Array(randomBytes(length));
    expect(sha256Hex(bytes)).toBe(expected(bytes));
  });
});

describe("sha256", () => {
  // main: passes on this path alone; it guards that the subtle path still gives the same hex.
  it.each(LENGTHS)("subtle あり: 長さ %i で node:crypto と一致する", async (length) => {
    const bytes = new Uint8Array(randomBytes(length));
    expect(globalThis.crypto.subtle).toBeDefined();
    await expect(sha256(bytes)).resolves.toBe(expected(bytes));
  });

  // main: "Cannot read properties of undefined (reading 'digest')".
  it.each(LENGTHS)("subtle 無し: 長さ %i で node:crypto と一致する", async (length) => {
    const bytes = new Uint8Array(randomBytes(length));
    stubInsecureCrypto();
    await expect(sha256(bytes)).resolves.toBe(expected(bytes));
  });

  // main: "Cannot read properties of undefined (reading 'digest')".
  it("subtle 無し: 既知値と一致する", async () => {
    stubInsecureCrypto();
    await expect(sha256(new Uint8Array())).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    await expect(sha256(encoder.encode("abc"))).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
