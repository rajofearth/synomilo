import {
  MAX_CONNECTED_CALL_MS,
  classifyConnectedEnd,
  isTerminal,
  talkDurationMs,
  type TimedCall,
} from "./callTiming";

/**
 * ------------------------------------------------------------------------
 * SEEDED FROM THE REPORT
 * ------------------------------------------------------------------------
 * The reported figure was 275 hours. Written out, that is
 *
 *   275 h * 60 * 60 * 1000 = 990_000_000 ms
 *
 * which is 11 days and 10 hours: a call that was answered, was never ended,
 * sat in the database, and was eventually stamped with the time someone
 * *noticed* it. These tests pin that arithmetic down so the fix cannot be a
 * coincidence of formatting.
 */
const ANSWERED_AT = 1_700_000_000_000;
const ELEVEN_DAYS_LATER = ANSWERED_AT + 990_000_000;
const REPORTED_SPAN_MS = ELEVEN_DAYS_LATER - ANSWERED_AT;

describe("call timing", () => {
  it("the reported figure is exactly an 11-day never-ended span", () => {
    expect(REPORTED_SPAN_MS).toBe(990_000_000);
    expect(REPORTED_SPAN_MS / 3_600_000).toBe(275);
    expect(REPORTED_SPAN_MS / 86_400_000).toBeCloseTo(11.46, 2);
  });

  describe("talkDurationMs", () => {
    it("reproduces the runaway figure under the old rule", () => {
      // The rule that shipped: any row with both timestamps is a conversation.
      const abandoned = {
        status: "active" as const,
        answeredAt: ANSWERED_AT,
        endedAt: null,
        endReason: null,
      };
      const asSwept: TimedCall = {
        ...abandoned,
        status: "ended",
        endedAt: ELEVEN_DAYS_LATER,
        endReason: "failed",
      };
      // Pre-fix arithmetic, verbatim from `calls.history`.
      const oldDurationMs =
        asSwept.answeredAt && asSwept.endedAt
          ? Math.max(0, asSwept.endedAt - asSwept.answeredAt)
          : null;
      expect(oldDurationMs).toBe(REPORTED_SPAN_MS);
      // Which is 275 hours once divided into hours.
      expect(Math.floor(oldDurationMs! / 3_600_000)).toBe(275);
    });

    it("excludes the same row once it has been swept", () => {
      // The sweep's own outcome: closed as `failed` at the time it was noticed.
      expect(
        talkDurationMs({
          status: "ended",
          answeredAt: ANSWERED_AT,
          endedAt: ELEVEN_DAYS_LATER,
          endReason: "failed",
        }),
      ).toBeNull();
    });

    it("excludes a legacy row stamped hangup while it sat abandoned", () => {
      // The second path to the same number: `calls.end` on an 11-day-old
      // `active` row. It carried `endReason: "hangup"`, so it looked exactly
      // like a conversation to the pre-fix arithmetic - and it still looks like
      // one to anything that only checks the reason.
      expect(
        talkDurationMs({
          status: "ended",
          answeredAt: ANSWERED_AT,
          endedAt: ELEVEN_DAYS_LATER,
          endReason: "hangup",
        }),
      ).toBeNull();
    });

    it("contributes nothing while the call is still in progress", () => {
      expect(
        talkDurationMs({
          status: "active",
          answeredAt: ANSWERED_AT,
          endedAt: null,
          endReason: null,
        }),
      ).toBeNull();
    });

    it("counts a real conversation", () => {
      expect(
        talkDurationMs({
          status: "ended",
          answeredAt: ANSWERED_AT,
          endedAt: ANSWERED_AT + 252_000,
          endReason: "hangup",
        }),
      ).toBe(252_000);
    });

    it("keeps the boundary inside the window and one ms outside it", () => {
      const at = (
        endedAt: number,
      ) =>
        talkDurationMs({
          status: "ended",
          answeredAt: ANSWERED_AT,
          endedAt,
          endReason: "hangup",
        });
      expect(at(ANSWERED_AT + MAX_CONNECTED_CALL_MS)).toBe(MAX_CONNECTED_CALL_MS);
      expect(at(ANSWERED_AT + MAX_CONNECTED_CALL_MS + 1)).toBeNull();
    });

    it("never returns a negative span", () => {
      expect(
        talkDurationMs({
          status: "ended",
          answeredAt: ANSWERED_AT,
          endedAt: ANSWERED_AT - 5_000,
          endReason: "hangup",
        }),
      ).toBeNull();
    });

    it("requires an answer before it will report any time at all", () => {
      expect(
        talkDurationMs({
          status: "ended",
          answeredAt: null,
          endedAt: ANSWERED_AT + 60_000,
          endReason: "hangup",
        }),
      ).toBeNull();
      expect(
        talkDurationMs({
          status: "ended",
          answeredAt: ANSWERED_AT,
          endedAt: null,
          endReason: "hangup",
        }),
      ).toBeNull();
    });

    it("excludes calls that never connected, whatever they are labelled", () => {
      const preAnswer: TimedCall["status"][] = ["ringing", "rejected", "missed"];
      for (const status of preAnswer) {
        expect(
          talkDurationMs({
            status,
            answeredAt: null,
            endedAt: ANSWERED_AT + 60_000,
            endReason: "timeout",
          }),
        ).toBeNull();
      }
    });

    it("excludes every non-hangup end of a connected call", () => {
      for (const endReason of ["declined", "timeout", "busy", "failed"] as const) {
        expect(
          talkDurationMs({
            status: "ended",
            answeredAt: ANSWERED_AT,
            endedAt: ANSWERED_AT + 30_000,
            endReason,
          }),
        ).toBeNull();
      }
    });
  });

  describe("classifyConnectedEnd", () => {
    it("calls a normal hangup a hangup", () => {
      expect(classifyConnectedEnd(ANSWERED_AT, ANSWERED_AT + 120_000)).toBe("hangup");
    });

    it("calls an end that arrives 11 days late a failure", () => {
      // This is the write-time half of the fix: the sweep and the late `end`
      // now record `failed`, so the row is never labelled a conversation even
      // before the read-side span bound sees it.
      expect(classifyConnectedEnd(ANSWERED_AT, ELEVEN_DAYS_LATER)).toBe("failed");
    });

    it("agrees with the read-side bound at the window edge", () => {
      expect(classifyConnectedEnd(ANSWERED_AT, ANSWERED_AT + MAX_CONNECTED_CALL_MS)).toBe(
        "hangup",
      );
      expect(
        classifyConnectedEnd(ANSWERED_AT, ANSWERED_AT + MAX_CONNECTED_CALL_MS + 1),
      ).toBe("failed");
    });

    it("refuses to call a hangup when the call was never answered", () => {
      expect(classifyConnectedEnd(null, ANSWERED_AT + 1_000)).toBe("failed");
    });

    it("refuses a span that runs backwards", () => {
      expect(classifyConnectedEnd(ANSWERED_AT, ANSWERED_AT - 1_000)).toBe("failed");
    });
  });

  describe("isTerminal", () => {
    it("is true only of statuses a call cannot leave", () => {
      expect(isTerminal("ended")).toBe(true);
      expect(isTerminal("rejected")).toBe(true);
      expect(isTerminal("missed")).toBe(true);
      expect(isTerminal("ringing")).toBe(false);
      expect(isTerminal("active")).toBe(false);
    });
  });
});