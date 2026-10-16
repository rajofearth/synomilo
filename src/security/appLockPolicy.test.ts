import {
  callInterruptsLock,
  callReleasesGate,
  claimCallHandOff,
  noteCallHandOff,
  resolveGateSurface,
} from './appLockPolicy';
import type { CallSignal } from './appLockPolicy';

/**
 * The regression tests for "the app lock never asks for my fingerprint".
 *
 * `noteCallHandOff()` is documented as meaning "the user just answered a call and
 * is being navigated to the call screen". The bug was that `App.tsx` also called
 * it from the FCM `AppState` listener, so the stamp was taken on EVERY ordinary
 * foreground. Two policy functions then read a five-second window that three
 * unrelated call sites each consulted on their own schedule, and the gate stood
 * itself down before it ever presented anything.
 */

const noCall: CallSignal = {
  connected: false,
  ringing: false,
  callScreenVisible: false,
};

/** Module state is process-wide, so every test starts by consuming the latch. */
const drainHandOff = () => {
  noteCallHandOff();
  claimCallHandOff();
};

afterEach(drainHandOff);

describe('Cause 1: an ordinary foreground is not a call hand-off', () => {
  it('does not read as a call in the picture, however fresh the stamp is', () => {
    // What App.tsx's `AppState` listener did on every resume.
    noteCallHandOff();

    expect(callInterruptsLock(noCall)).toBe(false);
    expect(callReleasesGate(noCall)).toBe(false);
  });

  it('does not read as a call in the picture 4.9 seconds later either', () => {
    noteCallHandOff();
    jest.spyOn(Date, 'now').mockReturnValueOnce(Date.now() + 4_900);

    expect(callInterruptsLock(noCall)).toBe(false);
    expect(callReleasesGate(noCall)).toBe(false);
  });

  it('still reads as a call when the observable signal says so', () => {
    // The stamp must not have been removed by accident: the real race the latch
    // exists for is one where no React state has caught up yet.
    noteCallHandOff();
    expect(callReleasesGate({ ...noCall, connected: true })).toBe(true);
    expect(callReleasesGate({ ...noCall, callScreenVisible: true })).toBe(true);
    expect(callInterruptsLock({ ...noCall, ringing: true })).toBe(true);
  });
});

describe('the hand-off latch is claimable exactly once', () => {
  it('answers true for the first arming and false for every one after', () => {
    noteCallHandOff();

    expect(claimCallHandOff()).toBe(true);
    expect(claimCallHandOff()).toBe(false);
    expect(claimCallHandOff()).toBe(false);
  });

  it('is false when no hand-off was ever noted', () => {
    expect(claimCallHandOff()).toBe(false);
  });

  it('is false once the navigation window has passed', () => {
    noteCallHandOff();
    // 5s is the documented window; one tick past it must not be claimable.
    expect(claimCallHandOff(Date.now() + 5_000)).toBe(false);
  });

  it('re-arms when a second call is answered', () => {
    noteCallHandOff();
    expect(claimCallHandOff()).toBe(true);

    noteCallHandOff();
    expect(claimCallHandOff()).toBe(true);
  });

  it('cannot be claimed by a stamp that is already spent, even if re-dated', () => {
    // The dangerous shape: a reader that both re-arms and consumes. Nothing but
    // `noteCallHandOff` may reset the claim, and it is called from one site.
    noteCallHandOff();
    claimCallHandOff();
    expect(claimCallHandOff(Date.now() + 1)).toBe(false);
  });
});

describe('resolveGateSurface: an armed gate always offers a way forward', () => {
  it('is the PIN pad whenever no prompt is up and a PIN exists', () => {
    expect(resolveGateSurface({ promptShowing: false, pinUsable: true })).toBe('pinPad');
  });

  it('is the reset path when no prompt is up and there is no PIN', () => {
    expect(resolveGateSurface({ promptShowing: false, pinUsable: false })).toBe('recovery');
  });

  it('is the prompt while the OS dialog is up', () => {
    expect(resolveGateSurface({ promptShowing: true, pinUsable: true })).toBe('prompt');
  });

  it('never returns nothing, for any combination', () => {
    for (const promptShowing of [true, false]) {
      for (const pinUsable of [true, false]) {
        expect(resolveGateSurface({ promptShowing, pinUsable })).not.toBeNull();
      }
    }
  });
});
