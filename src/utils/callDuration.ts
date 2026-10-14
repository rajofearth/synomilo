/**
 * Call duration maths, shared by the mobile call screen and the web app.
 *
 * The bug this replaces: duration was computed as
 *   Math.floor((Date.now() - answeredAt) / 1000)
 * where `answeredAt` is written by the Convex SERVER (`convex/calls.ts` accept)
 * but `Date.now()` is the DEVICE clock. On any device whose clock is behind the
 * server's, that subtraction is negative and the screen renders "-1:-3".
 *
 * Two changes fix it:
 *   1. Reconstruct server time from a single offset sample taken from the call
 *      record (`serverNow` ships alongside `answeredAt`), so both sides of the
 *      subtraction are on the same timeline.
 *   2. Clamp at zero. A duration is never negative; if the offset sample is
 *      missing (offline first paint, old cached record) we show 00:00 rather
 *      than a nonsense value.
 */

/** Milliseconds between the server clock and this device's clock. */
export type ClockOffset = number;

/**
 * Derive a clock offset from a server timestamp observed locally.
 * `serverNow` is the server's clock when it answered; `receivedAt` is the local
 * clock at the moment we saw it. Positive means the device is ahead.
 */
export function deriveClockOffset(serverNow: number, receivedAt: number): ClockOffset {
  return serverNow - receivedAt;
}

/**
 * Elapsed call time in whole seconds, clamped at zero.
 *
 * @param answeredAt Server timestamp of when the call was answered.
 * @param now        Device clock now.
 * @param offset     Offset from `deriveClockOffset`, or null if unknown.
 */
export function elapsedSeconds(
  answeredAt: number | null | undefined,
  now: number,
  offset?: ClockOffset | null,
): number {
  if (!answeredAt) {
    return 0;
  }
  const serverNow = offset == null ? now : now + offset;
  const ms = serverNow - answeredAt;
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

/**
 * Format whole seconds as m:ss, or h:mm:ss past an hour.
 * Negative or non-finite input renders as 00:00 rather than garbage.
 */
export function formatElapsed(totalSeconds: number): string {
  const seconds =
    Number.isFinite(totalSeconds) && totalSeconds > 0
      ? Math.floor(totalSeconds)
      : 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Duration of a finished call, or null while it is still in progress. */
export function completedDurationMs(
  answeredAt: number | null | undefined,
  endedAt: number | null | undefined,
): number | null {
  if (!answeredAt || !endedAt) {
    return null;
  }
  return Math.max(0, endedAt - answeredAt);
}
