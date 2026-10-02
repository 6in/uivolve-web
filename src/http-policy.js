export function httpUrl(value, base) {
  let url;
  try {
    url = new URL(value, base);
  } catch {
    throw new Error("HTTP / HTTPSのURLを指定してください");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("認証情報を含まないHTTP / HTTPSのURLを指定してください");
  return url;
}

export function secureOrigin(url) {
  return url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export function bearerToken(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("JWTを指定してください");
  const token = value.trim();
  if (!/^[A-Za-z0-9._~+/-]+=*$/.test(token))
    throw new Error("JWTにはBearerトークンの文字列だけを指定してください");
  return token;
}
