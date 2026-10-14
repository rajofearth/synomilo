/**
 * Call duration maths, copied from `src/utils/callDuration.ts`.
 *
 * `answeredAt` is written by the Convex SERVER (`convex/calls.ts` accept) while
 * `Date.now()` is the browser clock. On any machine whose clock is behind the
 * server's, a naive subtraction is negative and the readout renders garbage.
 * The fix is to reconstruct server time from a single offset sample taken out of
 * the call record, which ships `serverNow` alongside `answeredAt` for exactly
 * this purpose.
 */

/** Milliseconds between the server clock and this browser's clock. */
export type ClockOffset = number;

export function deriveClockOffset(serverNow: number, receivedAt: number): ClockOffset {
  return serverNow - receivedAt;
}

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

export function formatElapsed(totalSeconds: number): string {
  const seconds =
    Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
