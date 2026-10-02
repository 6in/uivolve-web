import { afterEach, expect, it, vi } from "vite-plus/test";
import { ResourceClient } from "../src/resource-client.js";

const BASE = "https://ui.example/";
const ENDPOINT = "https://auth.example/refresh";
const OLD = "header.old.signature",
  NEXT = "header.next.signature";
const RT = "opaque refresh +/=";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const create = (fetcher, options = {}) => {
  const client = new ResourceClient({ baseUrl: BASE, fetch: fetcher });
  client.setAuthentication({
    mode: "jwt",
    token: OLD,
    refresh: { url: ENDPOINT, token: RT },
    ...options,
  });
  return client;
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("refreshes a 401 once and sends the refresh token only to the explicit POST endpoint", async () => {
  const fetcher = vi.fn(async (url, options) =>
    options.method === "POST"
      ? json({ accessToken: NEXT, refreshToken: "rotated-refresh", expiresIn: 3600 })
      : options.headers.get("Authorization") === `Bearer ${NEXT}`
        ? new Response("screen")
        : new Response("expired", { status: 401 }),
  );
  const client = create(fetcher);
  expect(await client.text("app.json")).toBe("screen");
  expect(fetcher).toHaveBeenCalledTimes(3);
  const [url, request] = fetcher.mock.calls[1];
  expect(url.href).toBe(ENDPOINT);
  expect(request).toMatchObject({
    method: "POST",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  expect(new Headers(request.headers).has("Authorization")).toBe(false);
  expect(JSON.parse(request.body)).toEqual({ refreshToken: RT });
  for (const [, options] of fetcher.mock.calls.filter(([, o]) => o.method === "GET"))
    expect(JSON.stringify(options)).not.toContain(RT);
  const metadata = JSON.stringify(client.getAuthentication());
  for (const secret of [OLD, NEXT, RT, "rotated-refresh"]) expect(metadata).not.toContain(secret);
});

it("rotates refresh tokens and atomically uses the replacement for the next refresh", async () => {
  let count = 0;
  const fetcher = vi.fn(async (_url, options) => {
    if (options.method === "POST")
      return json({ accessToken: `token.${++count}.sig`, refreshToken: `refresh-${count}` });
    return options.headers.get("Authorization") === `Bearer token.${count}.sig` && count > 0
      ? new Response("ok")
      : new Response(null, { status: 401 });
  });
  const client = create(fetcher);
  await client.text("app.json");
  const metadata = await client.refreshAuthentication();
  expect(metadata.refresh).toEqual({ url: ENDPOINT, format: "json" });
  const posts = fetcher.mock.calls.filter(([, options]) => options.method === "POST");
  expect(posts.map(([, options]) => JSON.parse(options.body).refreshToken)).toEqual([
    RT,
    "refresh-1",
  ]);
  await client.text("app.rhai");
  expect(fetcher.mock.lastCall[1].headers.get("Authorization")).toBe("Bearer token.2.sig");
});

it("keeps an omitted refresh-token replacement and supports public-client OAuth encoding", async () => {
  const fetcher = vi.fn(async () =>
    json({ access_token: NEXT, token_type: "Bearer", expires_in: 3600 }),
  );
  const client = create(fetcher, {
    refresh: { url: ENDPOINT, token: RT, format: "oauth", clientId: "public + client" },
  });
  await client.refreshAuthentication();
  await client.refreshAuthentication();
  for (const [, options] of fetcher.mock.calls) {
    expect(new Headers(options.headers).get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(Object.fromEntries(new URLSearchParams(options.body))).toEqual({
      grant_type: "refresh_token",
      refresh_token: RT,
      client_id: "public + client",
    });
    expect(new Headers(options.headers).has("Authorization")).toBe(false);
  }
});

it("combines concurrent 401s into one refresh and retries each resource with the new access token", async () => {
  const started = deferred(),
    reply = deferred();
  const fetcher = vi.fn(async (_url, options) => {
    if (options.method === "POST") {
      started.resolve();
      return reply.promise;
    }
    return options.headers.get("Authorization") === `Bearer ${NEXT}`
      ? new Response("ok")
      : new Response(null, { status: 401 });
  });
  const client = create(fetcher);
  const pending = [client.text("app.json"), client.text("dark.json")];
  await started.promise;
  reply.resolve(json({ accessToken: NEXT, refreshToken: "rotated" }));
  expect(await Promise.all(pending)).toEqual(["ok", "ok"]);
  expect(fetcher.mock.calls.filter(([, o]) => o.method === "POST")).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([, o]) => o.method === "GET")).toHaveLength(4);
});

it("reuses a completed refresh for a delayed older 401 even when the access token string is unchanged", async () => {
  const delayed = deferred();
  let refreshed = false;
  const fetcher = vi.fn(async (url, options) => {
    if (options.method === "POST") {
      refreshed = true;
      return json({ accessToken: OLD });
    }
    if (!refreshed && url.pathname === "/late.json") return delayed.promise;
    return new Response(refreshed ? "ok" : null, { status: refreshed ? 200 : 401 });
  });
  const client = create(fetcher);
  const late = client.text("late.json");
  expect(await client.text("first.json")).toBe("ok");
  delayed.resolve(new Response(null, { status: 401 }));
  expect(await late).toBe("ok");
  expect(fetcher.mock.calls.filter(([, o]) => o.method === "POST")).toHaveLength(1);
});

it("refreshes before an explicit expiry on the next request without immediately repeating short lifetimes", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  const fetcher = vi.fn(async (_url, options) =>
    options.method === "POST" ? json({ accessToken: NEXT, expiresIn: 1 }) : new Response("ok"),
  );
  const client = create(fetcher, { expiresIn: 60 });
  await client.text("initial.json");
  clock.mockReturnValue(1_031_000);
  await client.text("near-expiry.json");
  await client.text("near-expiry.rhai");
  expect(fetcher.mock.calls.map(([, o]) => o.method)).toEqual(["GET", "POST", "GET", "GET"]);
  expect(fetcher.mock.lastCall[1].headers.get("Authorization")).toBe(`Bearer ${NEXT}`);
});

it("waits for a newer in-flight rotation before retrying a delayed old 401", async () => {
  const delayed = deferred(),
    secondStarted = deferred(),
    secondReply = deferred();
  let count = 0;
  const fetcher = vi.fn(async (url, options) => {
    if (options.method === "POST") {
      if (++count === 1) return json({ accessToken: NEXT });
      secondStarted.resolve();
      return secondReply.promise;
    }
    if (url.pathname === "/late.json" && options.headers.get("Authorization") === `Bearer ${OLD}`)
      return delayed.promise;
    const accepted =
      options.headers.get("Authorization") === `Bearer ${count === 1 ? NEXT : "token.latest.sig"}`;
    return new Response(accepted ? "ok" : null, { status: accepted ? 200 : 401 });
  });
  const client = create(fetcher);
  const late = client.text("late.json");
  await client.text("first.json");
  const renewed = client.refreshAuthentication();
  await secondStarted.promise;
  delayed.resolve(new Response(null, { status: 401 }));
  secondReply.resolve(json({ accessToken: "token.latest.sig" }));
  await renewed;
  expect(await late).toBe("ok");
  expect(fetcher.mock.calls.filter(([, o]) => o.method === "POST")).toHaveLength(2);
});

it("does not refresh on 403, server/network errors or an unapproved resource origin", async () => {
  for (const status of [403, 500]) {
    const fetcher = vi.fn(async () => new Response(null, { status }));
    await expect(create(fetcher).text("app.json")).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.lastCall[1].method).toBe("GET");
  }
  const fetcher = vi.fn(async () => {
    throw new Error(RT);
  });
  const client = create(fetcher);
  await expect(client.text("https://foreign.example/app.rhai")).rejects.toThrow(/許可/);
  expect(fetcher).not.toHaveBeenCalled();
  await expect(client.text("app.json")).rejects.toThrow(/^HTTP取得に失敗/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("fails closed on invalid refresh responses and never retries the used refresh token or falls back anonymously", async () => {
  const failures = [
    () => json({ error: "invalid_grant" }, 400),
    () => json({ accessToken: NEXT }, 401),
    () => json({ accessToken: NEXT }, 403),
    () => json({ accessToken: NEXT }, 500),
    () => new Response("{invalid"),
    () => json(null),
    () => json({ accessToken: "bad token" }),
    () => json({ accessToken: NEXT, refreshToken: "" }),
    () => json({ accessToken: NEXT, expiresIn: -1 }),
    () => json({ accessToken: NEXT, tokenType: "MAC" }),
    () => json({ error: RT, accessToken: NEXT }),
    () => new Response("x".repeat(64_001)),
  ];
  for (const fail of failures) {
    const fetcher = vi.fn(async (_url, options) =>
      options.method === "POST" ? fail() : new Response(null, { status: 401 }),
    );
    const client = create(fetcher);
    await expect(client.text("app.json")).rejects.toThrow(
      /^トークンを更新できませんでした。再認証してください$/,
    );
    await expect(client.text("again.json")).rejects.toThrow(/再認証/);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].headers.get("Authorization")).toBe(`Bearer ${OLD}`);
  }
});

it("requires Bearer token_type in OAuth responses", async () => {
  for (const token_type of [undefined, "MAC", 123]) {
    const fetcher = vi.fn(async () => json({ access_token: NEXT, token_type }));
    const client = create(fetcher, { refresh: { url: ENDPOINT, token: RT, format: "oauth" } });
    await expect(client.refreshAuthentication()).rejects.toThrow(/再認証/);
  }
});

it("limits the retry to one GET and stops the session if the new token is also rejected", async () => {
  const fetcher = vi.fn(async (_url, options) =>
    options.method === "POST" ? json({ accessToken: NEXT }) : new Response(null, { status: 401 }),
  );
  const client = create(fetcher);
  await expect(client.text("app.json")).rejects.toThrow(/HTTP 401/);
  expect(fetcher.mock.calls.map(([, o]) => o.method)).toEqual(["GET", "POST", "GET"]);
  await expect(client.text("app.json")).rejects.toThrow(/再認証/);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("lets a cancelled waiter leave without cancelling the shared refresh or another waiter", async () => {
  const started = deferred(),
    reply = deferred();
  let refreshSignal;
  const fetcher = vi.fn(async (_url, options) => {
    if (options.method === "POST") {
      refreshSignal = options.signal;
      started.resolve();
      return reply.promise;
    }
    return options.headers.get("Authorization") === `Bearer ${NEXT}`
      ? new Response("ok")
      : new Response(null, { status: 401 });
  });
  const client = create(fetcher),
    controller = new AbortController();
  const first = client.text("first.json", { signal: controller.signal });
  const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const second = client.text("second.json");
  await started.promise;
  controller.abort();
  await cancelled;
  expect(refreshSignal.aborted).toBe(false);
  reply.resolve(json({ accessToken: NEXT, refreshToken: "rotated" }));
  expect(await second).toBe("ok");
  expect(fetcher.mock.calls.filter(([, o]) => o.method === "POST")).toHaveLength(1);
});

it("aborts refresh on logout and prevents a late response from restoring credentials", async () => {
  const started = deferred(),
    reply = deferred();
  let refreshSignal;
  const fetcher = vi.fn(async (_url, options) => {
    if (options.method === "POST") {
      refreshSignal = options.signal;
      started.resolve();
      return reply.promise;
    }
    return options.headers.has("Authorization")
      ? new Response(null, { status: 401 })
      : new Response("public");
  });
  const client = create(fetcher);
  const pending = client.text("app.json");
  await started.promise;
  client.setAuthentication({ mode: "none" });
  expect(refreshSignal.aborted).toBe(true);
  reply.resolve(json({ accessToken: NEXT, refreshToken: "rotated" }));
  await expect(pending).rejects.toThrow(/認証設定が変更/);
  expect(await client.text("public.json")).toBe("public");
  expect(client.getAuthentication()).toEqual({ mode: "none", allowedOrigins: [] });
  expect(fetcher.mock.lastCall[1].headers.has("Authorization")).toBe(false);
});

it("bounds refresh waits to ten seconds and hides network/token-response secrets", async () => {
  vi.useFakeTimers();
  const started = deferred();
  const fetcher = vi.fn(async (_url, options) => {
    if (options.method !== "POST") return new Response(null, { status: 401 });
    started.resolve();
    return new Promise((_resolve, reject) =>
      options.signal.addEventListener("abort", () => reject(new Error(RT)), { once: true }),
    );
  });
  const client = create(fetcher);
  const pending = expect(client.text("app.json")).rejects.toThrow(
    /^トークンを更新できませんでした。再認証してください$/,
  );
  await started.promise;
  await vi.advanceTimersByTimeAsync(10_000);
  await pending;
  expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(client.refreshAuthentication()).rejects.toThrow(/再認証/);
});

it("keeps previous credentials when invalid refresh configuration is rejected", async () => {
  const fetcher = vi.fn(async () => new Response("ok"));
  const client = create(fetcher);
  const badRefresh = [
    null,
    [],
    { url: ENDPOINT, token: "" },
    { url: ENDPOINT, token: RT, format: "other" },
    { url: "http://auth.example/refresh", token: RT },
    { url: "https://user:secret@auth.example/refresh", token: RT },
    { url: `${ENDPOINT}#fragment`, token: RT },
    { url: ENDPOINT, token: RT, clientId: "client" },
  ];
  for (const refresh of badRefresh)
    expect(() => client.setAuthentication({ mode: "jwt", token: NEXT, refresh })).toThrow();
  expect(() =>
    client.setAuthentication({
      mode: "jwt",
      getToken: () => NEXT,
      refresh: { url: ENDPOINT, token: RT },
    }),
  ).toThrow(/併用/);
  expect(() =>
    client.setAuthentication({
      mode: "jwt",
      token: NEXT,
      refresh: { url: ENDPOINT, token: RT },
      expiresIn: -1,
    }),
  ).toThrow();
  await client.text("app.json");
  expect(fetcher.mock.lastCall[1].headers.get("Authorization")).toBe(`Bearer ${OLD}`);
  client.setAuthentication({ mode: "none" });
  await expect(client.refreshAuthentication()).rejects.toThrow(/設定がありません/);
});
