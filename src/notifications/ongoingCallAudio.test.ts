/**
 * Audio ownership across the "minimise, then come back to the call" path.
 *
 * `hideOngoingCallNotification` is reached from three very different places and
 * the difference matters:
 *
 *   - returning to the foreground, on a call that is still carrying media;
 *   - hanging up;
 *   - a terminal `cancelled` / `ended` push with no screen mounted.
 *
 * It used to release audio on all three, which meant the act of checking who just
 * messaged took a live call out of voice-call mode: `clearCommunicationDevice()`
 * plus `MODE_NORMAL`, so no Bluetooth, no speaker, and the peer coming out of a
 * phone that had stopped treating itself as being on a call.
 *
 * The rule under test: a live call keeps its audio route, and only a call that has
 * actually ended releases it.
 */

import { NativeModules, Platform } from 'react-native';
import notifee from '@notifee/react-native';

jest.mock('../../convex/_generated/api', () => ({
  api: { calls: { end: 'calls:end' } },
}));

import { hideOngoingCallNotification } from './ongoingCall';
import { useCallStore } from '../components/calls/callStore';

const releaseAudio = jest.fn(async () => true);
const stopForegroundService = jest.fn(async () => {});

const activeCall = {
  callId: 'call-1',
  role: 'caller' as const,
  peerName: 'Ada',
  type: 'audio' as const,
  answeredAt: 1_700_000_000_000,
  clockOffset: 0,
};

describe('returning to the foreground does not disturb a live call', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // `applyAudioRoute`/`releaseAudioRoute` are Android-only, and the jest preset
    // reports iOS - without this the whole test passes vacuously.
    (Platform as any).OS = 'android';
    (NativeModules as any).CallAudio = { releaseAudio, setSpeakerOn: jest.fn() };
    notifee.stopForegroundService = stopForegroundService as any;
    useCallStore.setState({ active: null, screenVisible: false });
  });

  afterEach(() => {
    (Platform as any).OS = 'ios';
    useCallStore.setState({ active: null, screenVisible: false });
  });

  it('still takes the notification down', async () => {
    await hideOngoingCallNotification('call-1');
    expect(notifee.cancelNotification).toHaveBeenCalledWith('ongoing:call-1');
  });

  it('does not release the audio route while the call is live', async () => {
    useCallStore.getState().setActive(activeCall);
    await hideOngoingCallNotification('call-1');
    expect(releaseAudio).not.toHaveBeenCalled();
  });

  it('does not clear the mute/speaker flags either', async () => {
    const { callMediaState } = require('./callMediaState');
    callMediaState.set({ muted: true, speakerOn: true });
    useCallStore.getState().setActive(activeCall);
    await hideOngoingCallNotification('call-1');
    expect(callMediaState.get()).toEqual({ muted: true, speakerOn: true });
    callMediaState.set({ muted: false, speakerOn: false });
  });

  it('releases the audio once the call is genuinely over', async () => {
    // The order `hangUp` uses: the store is cleared first, so "is this call still
    // live" is already false by the time the notification comes down.
    useCallStore.getState().setActive(activeCall);
    useCallStore.getState().setActive(null);
    await hideOngoingCallNotification('call-1');
    expect(releaseAudio).toHaveBeenCalledTimes(1);
  });

  it('releases the audio for a terminal push with no screen mounted', async () => {
    await hideOngoingCallNotification('call-1');
    expect(releaseAudio).toHaveBeenCalledTimes(1);
  });

  it('does not release the audio of a different call', async () => {
    useCallStore.getState().setActive({ ...activeCall, callId: 'call-2' });
    await hideOngoingCallNotification('call-1');
    expect(releaseAudio).not.toHaveBeenCalled();
  });
});