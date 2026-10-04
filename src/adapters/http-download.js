import { hostError } from "../host-effects.js";

export async function downloadFile({ resources, url, reference, file, options, signal, limit }) {
  let created = false;
  let committed = false;
  let writer;
  let reader;
  let response;
  let cancellation;
  let result;
  let failure;
  const cancelReader = () => {
    if (reader && !cancellation)
      cancellation = reader.cancel().catch(() => {
        throw hostError("NETWORK", "HTTP応答の中止に失敗しました", "failed");
      });
    // Attach a handler immediately; cleanup still awaits the original promise.
    cancellation?.catch(() => {});
  };
  try {
    signal.throwIfAborted();
    let handle;
    try {
      handle = await reference.handle();
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
    }
    signal.throwIfAborted();
    if (handle && !options.overwrite)
      throw hostError("ALREADY_EXISTS", "保存先ファイルが存在します");
    try {
      response = await resources.transferRequest(url, {
        method: "GET",
        headers: new Headers(options.headers),
        signal,
        allowHttpErrors: true,
      });
    } catch (error) {
      signal.throwIfAborted();
      throw hostError("NETWORK", "HTTP通信・認証に失敗しました", error.outcome ?? "failed");
    }
    if (response.body) reader = response.body.getReader();
    signal.addEventListener("abort", cancelReader, { once: true });
    signal.throwIfAborted();
    if (!response.ok)
      throw hostError(
        `HTTP_${response.status}`,
        `HTTP ${response.status}: リクエストに失敗しました`,
        "failed",
      );
    const length = response.headers.get("content-length");
    // Encoded wire sizes are not decoded byte counts; the streamed count is authoritative.
    if (
      !response.headers.has("content-encoding") &&
      /^\d+$/.test(length ?? "") &&
      Number(length) > limit
    )
      throw hostError("LIMIT", "HTTP転送が容量上限を超えています", "failed");
    if (!handle) {
      handle = await reference.handle({ create: true });
      created = true;
    }
    signal.throwIfAborted();
    writer = await handle.createWritable();
    signal.throwIfAborted();
    let size = 0;
    while (reader) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        throw hostError("NETWORK", "HTTP応答の読み取りに失敗しました", "failed");
      }
      signal.throwIfAborted();
      if (chunk.done) break;
      if (chunk.value.byteLength > limit - size)
        throw hostError("LIMIT", "HTTP転送が容量上限を超えています", "failed");
      size += chunk.value.byteLength;
      await writer.write(chunk.value);
      signal.throwIfAborted();
    }
    signal.throwIfAborted();
    await writer.close();
    // A successful close is the commit boundary, including cancellation during close.
    committed = true;
    result = {
      status: response.status,
      headers: Object.fromEntries(
        (options.responseHeaders ?? []).map((key) => [key, response.headers.get(key)]),
      ),
      body: null,
      files: [{ ...file, size }],
    };
  } catch (error) {
    failure = signal.aborted
      ? hostError("CANCELLED", "HTTP転送が中止されました", "failed")
      : error.code && error.outcome
        ? error
        : hostError("STORAGE", "OPFSへの保存に失敗しました", "failed");
  } finally {
    signal.removeEventListener("abort", cancelReader);
    let cleanupFailed = false;
    if (!committed) {
      cancelReader();
    }
    try {
      await cancellation;
    } catch {
      cleanupFailed = true;
    }
    if (!committed) {
      if (writer) {
        try {
          await writer.abort();
        } catch {
          cleanupFailed = true;
        }
      }
      if (created) {
        try {
          await reference.remove();
        } catch {
          cleanupFailed = true;
        }
      }
    }
    reader?.releaseLock();
    if (cleanupFailed)
      failure = hostError(
        "CLEANUP",
        "HTTP転送の後始末に失敗しました",
        committed ? "committed" : "failed",
      );
  }
  if (failure) throw failure;
  return result;
}
