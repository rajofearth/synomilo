import { NativeModules, Platform } from 'react-native';

export interface CallMediaFlags {
  muted: boolean;
  speakerOn: boolean;
}

const flags: CallMediaFlags = { muted: false, speakerOn: false };
const listeners = new Set<(next: CallMediaFlags) => void>();

/**
 * Live media flags for the current call, owned outside React.
 *
 * The ongoing-call notification has Mute / Speaker actions, and those presses are
 * delivered by Notifee's background event, which does not run through React. When
 * the process is alive - which it is, because the ongoing notification is a
 * foreground service - that event is dispatched onto the existing JS runtime, so a
 * module-level singleton here IS shared with the mounted `WebRTCCallScreen`. The
 * screen subscribes and applies the change to the live peer connection.
 *
 * If the OS killed the process there is no peer connection to change and the flag
 * simply does not survive; that case is a no-op rather than a lie, because nothing
 * claims to have applied it.
 */
export const callMediaState = {
  get(): CallMediaFlags {
    return flags;
  },
  set(patch: Partial<CallMediaFlags>): CallMediaFlags {
    const next = { ...flags, ...patch };
    if (next.muted === flags.muted && next.speakerOn === flags.speakerOn) {
      return next;
    }
    flags.muted = next.muted;
    flags.speakerOn = next.speakerOn;
    listeners.forEach(listener => listener({ ...flags }));
    return { ...flags };
  },
  subscribe(listener: (next: CallMediaFlags) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  reset(): void {
    callMediaState.set({ muted: false, speakerOn: false });
  },
};

/**
 * `react-native-webrtc` exposes the tracks but not the audio route, so the speaker
 * toggle goes through a ~40-line native module over the platform AudioManager
 * (android/app/src/main/java/.../CallAudioModule.kt). Returns false on platforms
 * where there is nothing to route.
 */
export async function applyAudioRoute(speakerOn: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  const audio = NativeModules.CallAudio as
    | { setSpeakerOn?: (value: boolean) => Promise<boolean> }
    | undefined;
  if (!audio?.setSpeakerOn) {
    return false;
  }
  try {
    return await audio.setSpeakerOn(speakerOn);
  } catch {
    return false;
  }
}

/**
 * Put the session into voice-call mode without expressing a preference about
 * *where* the audio comes out.
 *
 * `MODE_IN_COMMUNICATION` is required - it is what engages Android's voice-call
 * processing and stops the peer coming out of the loudspeaker - and the platform
 * then routes to a connected Bluetooth or wired headset and falls back to the
 * earpiece by itself.
 *
 * The distinction from [applyAudioRoute] is the whole point: `setSpeakerOn(false)`
 * and `setCommunicationDevice(TYPE_BUILTIN_EARPIECE)` are *overrides*. Calling
 * either at setup is what made a Bluetooth headset or a car kit be ignored for
 * the whole call unless the user noticed and turned the override back off, so
 * this deliberately expresses nothing and only undoes a stale override.
 *
 * The user-facing speaker toggle is untouched: it still goes through
 * [applyAudioRoute].
 */
export async function prepareCallAudioRoute(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  const audio = NativeModules.CallAudio as
    | { useDefaultRoute?: () => Promise<boolean> }
    | undefined;
  if (!audio?.useDefaultRoute) {
    // A native binary predating the method. The old behaviour is better than
    // doing nothing, because it at least sets the audio mode.
    return applyAudioRoute(false);
  }
  try {
    return await audio.useDefaultRoute();
  } catch {
    return false;
  }
}

export async function releaseAudioRoute(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  const audio = NativeModules.CallAudio as
    | { releaseAudio?: () => Promise<boolean> }
    | undefined;
  try {
    await audio?.releaseAudio?.();
  } catch {}
}