import { beforeAll, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { ResourceClient } from "../src/resource-client.js";
import { WasmEngine } from "../src/engine.js";

const baseUrl = "https://ui.example/demo/";
const token = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.test-signature";
const create = (fetcher = vi.fn(async () => new Response("ok"))) => ({
  client: new ResourceClient({ baseUrl, fetch: fetcher }),
  fetcher,
});
let wasm;
beforeAll(async () => {
  wasm = await readFile(new URL("../public/engine.wasm", import.meta.url));
});

it("defaults to CORS and no Bearer header, preserving public HTTP and redirect behavior", async () => {
  const { client, fetcher } = create();
  await client.text("screens/app.json");
  await client.text("https://public.example/script.rhai");
  for (const [, options] of fetcher.mock.calls) {
    expect(options.headers.has("Authorization")).toBe(false);
    expect(options).toMatchObject({
      mode: "cors",
      cache: "no-cache",
      redirect: "follow",
      credentials: "same-origin",
    });
  }
  expect(fetcher.mock.calls[0][0].href).toBe(`${baseUrl}screens/app.json`);
  expect(client.getAuthentication()).toEqual({ mode: "none", allowedOrigins: [] });
});

it("sends Bearer JWT to allowed screen/script/theme origins, and clears it when disabled", async () => {
  const { client, fetcher } = create();
  client.setAuthentication({
    mode: "jwt",
    token,
    allowedOrigins: ["https://ui.example", "https://scripts.example/"],
  });
  const signal = new AbortController().signal;
  for (const url of ["screens/app.json", "https://scripts.example/app.rhai", "themes/dark.json"])
    await client.text(url, { signal });
  for (const [, options] of fetcher.mock.calls) {
    expect(options.headers.get("Authorization")).toBe(`Bearer ${token}`);
    expect(options).toMatchObject({
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal,
    });
  }
  expect(JSON.stringify(client)).not.toContain(token);
  expect(JSON.stringify(client.getAuthentication())).not.toContain(token);
  client.setAuthentication({ mode: "none" });
  await client.text("screens/app.json");
  expect(fetcher.mock.lastCall[1].headers.has("Authorization")).toBe(false);
});

it("rejects unapproved origins before calling the token provider or issuing a request", async () => {
  const { client, fetcher } = create();
  const getToken = vi.fn(() => token);
  client.setAuthentication({ mode: "jwt", getToken });
  for (const url of [
    "https://foreign.example/app.rhai",
    "https://ui.example.evil.example/file",
    "http://ui.example/file",
    "https://ui.example:444/file",
  ])
    await expect(client.text(url)).rejects.toThrow(/許可/);
  expect(getToken).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps previous authentication after invalid replacements and prevents unsafe headers/URLs", async () => {
  const { client, fetcher } = create();
  client.setAuthentication({ mode: "jwt", token });
  for (const options of [
    { mode: "unknown" },
    { mode: "jwt", token: "" },
    { mode: "jwt", token: "bad\r\nHeader: value" },
    { mode: "jwt", token: "Bearer value" },
    { mode: "jwt", token, allowedOrigins: [] },
    { mode: "jwt", token, allowedOrigins: ["https://ui.example/private"] },
    { mode: "jwt", token, allowedOrigins: ["https://ui.example/?token=secret"] },
    { mode: "jwt", token, allowedOrigins: ["http://api.example"] },
    { mode: "jwt", token, allowedOrigins: ["https://name:password@ui.example"] },
    { mode: "jwt", token, getToken: () => token },
  ])
    expect(() => client.setAuthentication(options)).toThrow();
  await client.text("screens/app.json");
  expect(fetcher.mock.lastCall[1].headers.get("Authorization")).toBe(`Bearer ${token}`);
  for (const url of [
    "file:///private",
    "javascript:alert(1)",
    "https://name:password@ui.example/file",
  ])
    await expect(client.text(url)).rejects.toThrow(/HTTP/);
});

it("supports local HTTP development and rejects remote HTTP in JWT mode", async () => {
  const { client, fetcher } = create();
  const allowedOrigins = ["http://localhost:4000", "http://127.0.0.1:4000", "http://[::1]:4000"];
  client.setAuthentication({ mode: "jwt", token, allowedOrigins });
  for (const origin of allowedOrigins) await client.text(`${origin}/app.json`);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(() =>
    client.setAuthentication({ mode: "jwt", token, allowedOrigins: ["http://localhost.example"] }),
  ).toThrow(/HTTPS/);
});

it("uses a fresh provider token for each request without exposing provider errors", async () => {
  const { client, fetcher } = create();
  const getToken = vi
    .fn()
    .mockResolvedValueOnce(token)
    .mockResolvedValueOnce(`${token}-rotated`)
    .mockRejectedValueOnce(new Error(token));
  client.setAuthentication({ mode: "jwt", getToken });
  await client.text("screens/app.json");
  await client.text("screens/app.rhai");
  expect(fetcher.mock.calls[0][1].headers.get("Authorization")).toBe(`Bearer ${token}`);
  expect(fetcher.mock.calls[1][1].headers.get("Authorization")).toBe(`Bearer ${token}-rotated`);
  await expect(client.text("themes/dark.json")).rejects.toThrow(/^JWTを取得できませんでした$/);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("stops before sending a token when a pending provider is cancelled or authentication changes", async () => {
  const { client, fetcher } = create();
  let complete;
  const getToken = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  client.setAuthentication({ mode: "jwt", getToken });
  const controller = new AbortController();
  const cancelled = client.text("screens/app.json", { signal: controller.signal });
  controller.abort();
  complete(token);
  await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  const changed = client.text("screens/app.json");
  client.setAuthentication({ mode: "none" });
  complete(token);
  await expect(changed).rejects.toThrow(/認証設定が変更/);
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    client.text("screens/app.json", { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("propagates authentication failures without retrying anonymously or reading server error bodies", async () => {
  for (const status of [401, 403, 500]) {
    const response = new Response(token, { status });
    const { client, fetcher } = create(vi.fn(async () => response));
    client.setAuthentication({ mode: "jwt", token });
    await expect(client.text("screens/app.json")).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(response.bodyUsed).toBe(false);
  }
  const { client } = create(
    vi.fn(async () => {
      throw new Error(token);
    }),
  );
  client.setAuthentication({ mode: "jwt", token });
  await expect(client.text("screens/app.json")).rejects.toThrow(/^HTTP取得に失敗/);
});

it("retains text size checks and discards a response when authentication changes mid-request", async () => {
  const { client } = create(vi.fn(async () => new Response("a".repeat(1_000_001))));
  await expect(client.text("screens/app.json")).rejects.toThrow(/1 MB/);
  let respond;
  const { client: other } = create(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const pending = other.text("screens/app.json");
  other.setAuthentication({ mode: "none" });
  respond(new Response("old content"));
  await expect(pending).rejects.toThrow(/認証設定が変更/);
});

it("can bootstrap the actual WASM engine through the same authenticated resource client", async () => {
  const { client, fetcher } = create(
    vi.fn(async () => new Response(wasm, { headers: { "Content-Type": "application/wasm" } })),
  );
  client.setAuthentication({ mode: "jwt", token });
  const engine = await WasmEngine.create(new URL("engine.wasm", baseUrl), { resources: client });
  expect(engine.theme().mode).toBe("light");
  expect(engine.bytes).toBe(wasm.byteLength);
  expect(fetcher.mock.lastCall[1].headers.get("Authorization")).toBe(`Bearer ${token}`);
});
