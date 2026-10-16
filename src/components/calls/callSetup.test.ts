import {
  connectionStatusLabel,
  describeLocalTracks,
  missingVideoReason,
  permissionFailureMessage,
  summarisePermissionResults,
} from './callSetup';

/**
 * These cover the decisions that made the call screen lie to the user:
 * a permission result that was thrown away, a stream with no video in it, a
 * candidate queue that was never drained, and a status line that showed a
 * running timer for a call with no media path.
 */

const CAMERA = 'android.permission.CAMERA';
const MIC = 'android.permission.RECORD_AUDIO';

const makeStream = (kinds: Array<'audio' | 'video'>) => ({
  getTracks: () =>
    kinds.map(kind => ({
      kind,
      id: `${kind}-id`,
      readyState: 'live',
      enabled: true,
    })),
  getVideoTracks: () =>
    kinds.filter(k => k === 'video').map(() => ({ kind: 'video' })),
});

describe('summarisePermissionResults', () => {
  const requests = [
    { permission: MIC, label: 'microphone' },
    { permission: CAMERA, label: 'camera' },
  ];

  it('reports an undeclared permission as refused, not granted', () => {
    // This is the shape the bug produced: CAMERA is absent from the manifest,
    // so Android denies it without ever showing a dialog.
    const summary = summarisePermissionResults(requests, {
      [MIC]: 'granted',
      [CAMERA]: 'denied',
    });
    expect(summary).toEqual({
      granted: ['microphone'],
      refused: ['camera'],
      blocked: [],
    });
  });

  it('separates never_ask_again from a plain denial', () => {
    const summary = summarisePermissionResults(requests, {
      [MIC]: 'granted',
      [CAMERA]: 'never_ask_again',
    });
    expect(summary.blocked).toEqual(['camera']);
    expect(summary.refused).toEqual([]);
  });

  it('treats a missing entry as a refusal rather than success', () => {
    const summary = summarisePermissionResults(requests, {
      [MIC]: 'granted',
    });
    expect(summary.refused).toEqual(['camera']);
  });

  it('counts ios limited as usable', () => {
    const summary = summarisePermissionResults(requests, {
      [MIC]: 'limited',
      [CAMERA]: 'limited',
    });
    expect(summary.refused).toEqual([]);
    expect(summary.blocked).toEqual([]);
  });
});

describe('permissionFailureMessage', () => {
  it('is null when everything was granted', () => {
    const summary = summarisePermissionResults(
      [{ permission: CAMERA, label: 'camera' }],
      { [CAMERA]: 'granted' },
    );
    expect(permissionFailureMessage(summary)).toBeNull();
  });

  it('points at Settings when a permission is permanently off', () => {
    const summary = summarisePermissionResults(
      [{ permission: CAMERA, label: 'camera' }],
      { [CAMERA]: 'never_ask_again' },
    );
    expect(permissionFailureMessage(summary)).toMatch(/Settings/);
  });
});

describe('missingVideoReason', () => {
  it('blames the permission when the camera was refused', () => {
    const reason = missingVideoReason(
      { granted: ['microphone'], refused: ['camera'], blocked: [] },
      makeStream(['audio']),
      true,
    );
    expect(reason).toBe('No camera');
  });

  it('blames the device when the permission was granted but no track exists', () => {
    const reason = missingVideoReason(
      { granted: ['microphone', 'camera'], refused: [], blocked: [] },
      makeStream(['audio']),
      true,
    );
    expect(reason).toBe('Camera unavailable');
  });

  it('is null for an audio call', () => {
    expect(
      missingVideoReason(
        { granted: ['microphone'], refused: [], blocked: [] },
        makeStream(['audio']),
        false,
      ),
    ).toBeNull();
  });

  it('is null once a video track exists', () => {
    expect(
      missingVideoReason(
        { granted: ['microphone', 'camera'], refused: [], blocked: [] },
        makeStream(['audio', 'video']),
        true,
      ),
    ).toBeNull();
  });
});

describe('describeLocalTracks / missingVideoReason', () => {
  it('reports readyState and enabled so a live track is provable', () => {
    expect(describeLocalTracks(makeStream(['audio', 'video']))).toEqual([
      { kind: 'audio', id: 'audio-id', readyState: 'live', enabled: true },
      { kind: 'video', id: 'video-id', readyState: 'live', enabled: true },
    ]);
  });

  it('survives a stream that has no getTracks at all', () => {
    expect(describeLocalTracks(undefined)).toEqual([]);
  });

  it('flags the audio-only stream that used to render as an empty box', () => {
    const allGranted = { granted: ['microphone', 'camera'], refused: [], blocked: [] };
    expect(missingVideoReason(allGranted, makeStream(['audio']), true)).not.toBeNull();
    expect(missingVideoReason(allGranted, makeStream(['audio', 'video']), true)).toBeNull();
    expect(missingVideoReason(allGranted, makeStream(['audio']), false)).toBeNull();
  });
});

describe('connectionStatusLabel', () => {
  const base = {
    notice: null as string | null,
    callStatus: undefined as string | undefined,
    role: 'callee' as 'caller' | 'callee',
    peerState: null as string | null,
    iceState: null as string | null,
    elapsedLabel: '00:42',
  };

  it('shows the timer only once the peer connection is up', () => {
    expect(
      connectionStatusLabel({
        ...base,
        callStatus: 'active',
        peerState: 'connected',
      }),
    ).toBe('00:42');
  });

  it('does not claim an answered call is running before it is connected', () => {
    expect(
      connectionStatusLabel({
        ...base,
        callStatus: 'active',
        peerState: 'connecting',
      }),
    ).toBe('Connecting…');
  });

  it('prefers the ICE layer, which is the one that fails', () => {
    expect(
      connectionStatusLabel({
        ...base,
        callStatus: 'active',
        peerState: 'connecting',
        iceState: 'failed',
      }),
    ).toBe('Connection failed');
  });

  it('says reconnecting rather than hanging up on a blip', () => {
    expect(
      connectionStatusLabel({
        ...base,
        callStatus: 'active',
        peerState: 'disconnected',
      }),
    ).toBe('Reconnecting…');
  });

  it('keeps the caller/callee ringing wording distinct', () => {
    expect(
      connectionStatusLabel({ ...base, callStatus: 'ringing', role: 'caller' }),
    ).toBe('Ringing…');
    expect(
      connectionStatusLabel({ ...base, callStatus: 'ringing', role: 'callee' }),
    ).toBe('Connecting…');
  });

  it('lets a terminal notice win over everything else', () => {
    expect(
      connectionStatusLabel({
        ...base,
        notice: 'Call declined',
        callStatus: 'active',
        peerState: 'connected',
      }),
    ).toBe('Call declined');
  });

  it('never says failed while the call is being recovered', () => {
    expect(
      connectionStatusLabel({
        ...base,
        callStatus: 'active',
        peerState: 'failed',
        iceState: 'failed',
        linkPhase: 'recovering',
      }),
    ).toBe('Reconnecting…');
  });
});

// `shouldGiveUpConnecting` is gone. It is the defect: one deadline armed when the
// row flipped to `active`, every non-`connected` value read as "never going to
// connect", so a working call was hung up for dropping. Its replacement, and the
// regression tests for it, are in callLinkRecovery.test.ts.