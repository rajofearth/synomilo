import {
  completedDurationMs,
  deriveClockOffset,
  elapsedSeconds,
  formatElapsed,
} from '../src/utils/callDuration';

describe('call duration', () => {
  // The device running these tests is not the Convex server. The reported bug
  // was that `Date.now() - answeredAt` mixes the two timelines and goes
  // negative whenever the device clock trails the server's.
  const ANSWERED_AT = 1_700_000_000_000;

  describe('elapsedSeconds', () => {
    it('is zero when the call was never answered', () => {
      expect(elapsedSeconds(null, ANSWERED_AT + 5_000, 0)).toBe(0);
      expect(elapsedSeconds(undefined, ANSWERED_AT + 5_000, 0)).toBe(0);
    });

    it('clamps to zero instead of rendering a negative duration', () => {
      // Device clock 30s BEHIND the server, no offset sample yet.
      expect(elapsedSeconds(ANSWERED_AT, ANSWERED_AT - 30_000, null)).toBe(0);
    });

    it('ignores NaN / negative / non-finite inputs', () => {
      expect(elapsedSeconds(ANSWERED_AT, Number.NaN, 0)).toBe(0);
      expect(elapsedSeconds(Number.NaN, ANSWERED_AT, 0)).toBe(0);
    });

    it('measures correctly once the clock offset is known', () => {
      // Server says "now" is ANSWERED_AT + 65s. Device clock reads +30s only.
      const serverNow = ANSWERED_AT + 65_000;
      const deviceNow = ANSWERED_AT + 30_000;
      const offset = deriveClockOffset(serverNow, deviceNow);

      expect(offset).toBe(35_000);
      expect(elapsedSeconds(ANSWERED_AT, deviceNow, offset)).toBe(65);
    });

    it('holds true across a long call on a skewed device', () => {
      const serverNow = ANSWERED_AT + 3_725_000; // ~1h 2m 5s
      const deviceNow = ANSWERED_AT + 3_600_000; // device is 125s behind
      const offset = deriveClockOffset(serverNow, deviceNow);

      expect(elapsedSeconds(ANSWERED_AT, deviceNow, offset)).toBe(3725);
    });

    it('does not double-count when the interval ticks repeatedly', () => {
      // The old implementation incremented a counter in some paths, which
      // stacked intervals and ran the timer at 2x. Recomputing from the
      // absolute timestamp makes the result idempotent.
      const offset = 0;
      const first = elapsedSeconds(ANSWERED_AT, ANSWERED_AT + 10_000, offset);
      const second = elapsedSeconds(ANSWERED_AT, ANSWERED_AT + 10_000, offset);
      expect(second).toBe(first);
    });
  });

  describe('formatElapsed', () => {
    it('never renders negative minutes or seconds', () => {
      // This is the exact reported symptom: -1:-3
      expect(formatElapsed(-3)).toBe('00:00');
      expect(formatElapsed(-1)).toBe('00:00');
    });

    it('renders seconds and minutes zero-padded', () => {
      expect(formatElapsed(0)).toBe('00:00');
      expect(formatElapsed(5)).toBe('00:05');
      expect(formatElapsed(65)).toBe('01:05');
      expect(formatElapsed(600)).toBe('10:00');
      expect(formatElapsed(3599)).toBe('59:59');
    });

    it('adds an hours field past an hour', () => {
      expect(formatElapsed(3600)).toBe('1:00:00');
      expect(formatElapsed(3725)).toBe('1:02:05');
      expect(formatElapsed(86_399)).toBe('23:59:59');
    });

    it('treats NaN and Infinity as zero', () => {
      expect(formatElapsed(Number.NaN)).toBe('00:00');
      expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe('00:00');
    });
  });

  describe('completedDurationMs', () => {
    it('returns null while a call has no answer or no end', () => {
      expect(completedDurationMs(null, 1000)).toBeNull();
      expect(completedDurationMs(1000, null)).toBeNull();
    });

    it('computes end minus answer for a finished call', () => {
      expect(completedDurationMs(1000, 61_000)).toBe(60_000);
    });

    it('clamps a negative span to zero', () => {
      expect(completedDurationMs(61_000, 1_000)).toBe(0);
    });
  });
});
