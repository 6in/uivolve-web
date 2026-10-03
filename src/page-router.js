// Same host/engine, different package. The route identifies a bundled page only.
export function readPageRoute(url, base, ids, initialPage = "orders") {
  url = new URL(url);
  base = new URL(base);
  const prefix = `${base.pathname}pages/`;
  if (url.pathname.startsWith(prefix)) {
    const id = url.pathname.slice(prefix.length).replace(/\/$/, "");
    if (!ids.includes(id)) throw new Error(`未知の画面URLです: ${url.pathname}`);
    return id;
  }
  if (![base.pathname, `${base.pathname}index.html`].includes(url.pathname))
    throw new Error(`未知の画面URLです: ${url.pathname}`);
  const legacy = url.searchParams.get("screen");
  return ids.includes(legacy) ? legacy : initialPage;
}
export function pageUrl(id, base, current) {
  const url = new URL(`pages/${encodeURIComponent(id)}`, base);
  const previous = new URL(current);
  url.search = previous.search;
  url.searchParams.delete("screen");
  url.hash = previous.hash;
  return url;
}
