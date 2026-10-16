import { create } from 'zustand';

/**
 * Live call state, outside React.
 *
 * Every piece of it used to live in `useState` inside `WebRTCCallScreen`, so
 * backgrounding the app and coming back could not tell anybody a call was running:
 * the state died with the screen, there was no store to read, and the ongoing-call
 * notification (see src/notifications/ongoingCall.ts) had nothing to render from.
 *
 * The notification's Mute / Speaker actions write to `callMediaState` for the same
 * reason - they are dispatched outside React.
 */
export interface ActiveCall {
  callId: string;
  role: 'caller' | 'callee';
  peerName: string;
  type: 'audio' | 'video';
  /** SERVER timestamp; `convex/calls.ts accept` writes it with the Convex clock. */
  answeredAt: number;
  /** `serverNow - deviceNow`. Null when the server has not shipped `serverNow` yet. */
  clockOffset: number | null;
}

interface CallStore {
  active: ActiveCall | null;
  /** True while the call screen is mounted, i.e. the user can already see it. */
  screenVisible: boolean;
  setActive: (call: ActiveCall | null) => void;
  setScreenVisible: (visible: boolean) => void;
}

export const useCallStore = create<CallStore>(set => ({
  active: null,
  screenVisible: false,
  setActive: active => set({ active }),
  setScreenVisible: screenVisible => set({ screenVisible }),
}));

export const isOngoingCall = (callId: string | undefined | null): boolean =>
  !!callId && useCallStore.getState().active?.callId === callId;

/**
 * Whether *any* call is live.
 *
 * Distinct from `isOngoingCall(id)` on purpose, for the audio route. The
 * AudioManager's communication device and audio mode are a single global slot
 * with a single owner, and the owner is "a call that is still going", not "this
 * particular call". So tearing down one call's notification while a different
 * call is live must not release audio: it would take the live call out of
 * voice-call mode, which is the defect this predicate exists to avoid.
 */
export const hasOngoingCall = (): boolean => !!useCallStore.getState().active;