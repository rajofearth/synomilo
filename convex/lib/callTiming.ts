/**
 * ------------------------------------------------------------------------
 * HOW LONG A CALL WAS, IN ONE PLACE
 * ------------------------------------------------------------------------
 *
 * The Profile page reported "275 hours" of talking time. That number was not
 * invented by the screen. It came out of `convex/calls.ts` as a plain
 * subtraction of two server timestamps and was formatted by the client, so the
 * bug was in the record, not in the arithmetic on screen.
 *
 * Two writes put a real number on a call that nobody was ever on the phone for:
 *
 *   1. `calls.accept` sweeps an `active` row older than `ACTIVE_CALL_TTL_MS` and
 *      stamps `endedAt: Date.now()`. Nothing in that patch says "this call
 *      ended when we noticed", so the row's duration became
 *      `noticed - answered` - the entire time the row sat there abandoned.
 *   2. `calls.end` on a row that had been `active` for days did the same thing
 *      and, worse, labelled it `endReason: "hangup"`, so a broken record was
 *      indistinguishable from a conversation.
 *
 * A call can only stay `active` with no `endedAt` by never terminating: the
 * app was killed, the process died, the network dropped at hangup time, or the
 * call screen unmounted without `hangUp()` running. There is no scheduled
 * reaper for `active` rows - `markTimedOut` only covers `ringing` - so the row
 * waits for a human to answer their next call before anyone looks at it again.
 *
 * So this module states the rule once, and both the writers and the readers use
 * it:
 *
 *   TALKING TIME = the span of a call that was answered and then ended normally,
 *   measured between two timestamps the server wrote at the two ends of it.
 *
 * Anything else - never answered, still in progress, ended by a sweep because
 * the app died, or a record whose span is longer than a conversation can
 * physically be - has NO talking time. It is `null`, which is not the same as
 * zero: zero would be a claim that the call was instantaneous, and `null` is
 * the honest "we cannot know, so we do not count it".
 *
 * `null` is deliberately what the sum in `calls.history` and the Profile total
 * skip, so an unrecorded call can never inflate a lifetime figure.
 *
 * ------------------------------------------------------------------------
 * WHY THIS IS A PURE FUNCTION AND NOT A STORED COLUMN
 * ------------------------------------------------------------------------
 *
 * The duration is wanted as a value written once at the end of the call. It is
 * a pure function of two immutable, server-written timestamps plus one
 * classification (`endReason`) that is also written exactly once, when the call
 * reaches its terminal state - see `finishCall` in `calls.ts`, which is the
 * only code that may write `endedAt` and refuses to write it twice.
 *
 * That makes it as drift-proof as a stored column while costing no migration:
 * no later clock, no later sweep and no later repair can change what a finished
 * call adds up to, because nothing can write to it afterwards. It also repairs
 * the rows already in the database - a record that was stamped `hangup` while
 * it sat abandoned for eleven days is excluded by the span bound below the
 * moment this ships, with no backfill.
 */

/**
 * The longest a call can be `active` and still be believed to be in progress.
 *
 * Four hours, and it is the same bound `calls.ts` already used to decide that
 * an `active` row is abandoned. Reusing it is deliberate: "this row is a dead
 * call" must mean exactly one thing in this codebase, and a second, larger
 * constant for the arithmetic side would let a row be too old to answer and
 * young enough to be counted.
 *
 * Nobody holds a peer-to-peer voice or video call for four hours. Anything past
 * it is a row whose end was never recorded, and its span measures how long it
 * sat in the database, not how long anybody talked.
 */
export const MAX_CONNECTED_CALL_MS = 4 * 60 * 60 * 1000;

/** Every status a call can reach that means it will never change again. */
export type CallStatus = "ringing" | "active" | "ended" | "rejected" | "missed";

/** Why a call stopped. Mirrors the `endReason` union in `convex/schema.ts`. */
export type EndReason = "hangup" | "declined" | "timeout" | "failed" | "busy";

/** The fields of a `calls` row this module reads. */
export type TimedCall = {
  status: CallStatus;
  answeredAt?: number | null;
  endedAt?: number | null;
  endReason?: EndReason | null;
};

/** True for a status a call can never leave. */
export function isTerminal(status: CallStatus): boolean {
  return status === "ended" || status === "rejected" || status === "missed";
}

/**
 * What to record as the reason a call that had reached `active` has stopped.
 *
 * `hangup` only when the server watched the whole call: it was answered, and
 * the end arrived within the window in which a call can still be considered
 * live. Outside that window the call has been abandoned for longer than any
 * conversation can last, so the end time is unknown - the row is closed as
 * `failed` and `talkDurationMs` will report no talking time for it.
 *
 * Taking a timestamp from an abandoned row is the whole bug: `now` is a real
 * time, but it is the time someone *looked*, and writing it into `endedAt`
 * turns the gap into an apparent conversation.
 */
export function classifyConnectedEnd(
  answeredAt: number | null | undefined,
  now: number,
): "hangup" | "failed" {
  if (answeredAt == null) {
    return "failed";
  }
  const span = now - answeredAt;
  return span >= 0 && span <= MAX_CONNECTED_CALL_MS ? "hangup" : "failed";
}

/**
 * Talking time in milliseconds, or `null` when it is not knowable.
 *
 * Non-null only when all of the following hold, which together mean "the server
 * recorded both ends of a real conversation":
 *
 *   - the call reached `ended`, and no other terminal state - a declined or
 *     missed call was never a conversation;
 *   - `endReason` is `hangup` - the call ended by a hangup, not by a sweep that
 *     discovered a dead row;
 *   - both timestamps exist - an unanswered or unended call has no duration;
 *   - the span is within `MAX_CONNECTED_CALL_MS` - a longer span is a record of
 *     how long the row sat in the database, written before this rule existed.
 *
 * The last clause is what fixes an account whose rows are already stamped with
 * an eleven-day `endedAt - answeredAt`: it stops counting the moment this ships,
 * with no migration, and it stays excluded because a terminal row is never
 * written to again.
 */
export function talkDurationMs(call: TimedCall): number | null {
  if (call.status !== "ended" || call.endReason !== "hangup") {
    return null;
  }
  const answeredAt = call.answeredAt;
  const endedAt = call.endedAt;
  if (answeredAt == null || endedAt == null) {
    return null;
  }
  const span = endedAt - answeredAt;
  if (span < 0 || span > MAX_CONNECTED_CALL_MS) {
    return null;
  }
  return span;
}