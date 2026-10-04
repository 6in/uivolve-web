export function browserClock() {
  const nowMs = Date.now();
  return { nowMs, tzOffsetMinutes: -new Date(nowMs).getTimezoneOffset() };
}

export function validateClock(value) {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["nowMs", "tzOffsetMinutes"].includes(key)) ||
    !Number.isSafeInteger(value.nowMs) ||
    !Number.isInteger(value.tzOffsetMinutes) ||
    Math.abs(value.tzOffsetMinutes) > 840
  )
    throw new Error("clockには整数のnowMsと-840〜840のtzOffsetMinutesが必要です");
  const date = new Date(value.nowMs + value.tzOffsetMinutes * 60_000);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999)
    throw new Error("clockの日付は0001〜9999年の範囲が必要です");
  return { nowMs: value.nowMs, tzOffsetMinutes: value.tzOffsetMinutes };
}

export function clockDate(clock) {
  return new Date(clock.nowMs + clock.tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}
