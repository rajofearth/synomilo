# Android platform backlog

A reference map of Android platform capabilities for a messaging app, turned into
an ordered backlog. Nothing here is in the app yet. It is recorded so the list
survives, and so the ordering is a decision rather than a drift.

Source: a platform feature survey covering notification system, bubbles, foreground
services, people and conversations, sharing, push and real time, auth, and
assorted platform APIs. Ordered here by what actually moves the needle for this
app, which is not the same as the survey's own ordering.

## Rule for this backlog

Bugs first. Nothing on this list gets started while a reported defect is open,
because every item here is additive and none of them are broken today. The list
exists so that when the bug queue is clear, the next thing picked is deliberate.

## Already done, keep as precedent

| Capability | Where | Note |
|---|---|---|
| `setFullScreenIntent` | `callNotifications.ts`, `IncomingCallActivity.kt` | Lock screen call UI works |
| `foregroundServiceType="phoneCall"` | `AndroidManifest.xml`, ongoing call notification | With `FOREGROUND_SERVICE_PHONE_CALL` and `MANAGE_OWN_CALLS` |
| `VIBRATE`, `POST_NOTIFICATIONS` | `AndroidManifest.xml` | |
| Notification channels | `callNotifications.ts` | Calls have their own channel, `incoming_call_v5` |
| `BiometricPrompt` for app lock | `BiometricGateModule.kt` | |
| `AudioManager` routing | `CallAudioModule.kt` | `MODE_IN_COMMUNICATION`, Bluetooth and speaker routing |
| `ConnectivityManager` callback | `CallNetworkModule.kt` | Wi-Fi to cellular handover triggers an ICE restart |

## P1. Conversation notifications

The single biggest perceived-quality win, and it is what makes the app feel native
rather than like a generic notification app.

1. `NotificationCompat.MessagingStyle` for message notifications: sender names,
   avatars, and several messages in the expanded view. API 24+.
2. `setCategory(CATEGORY_MESSAGE)` on every message notification. API 19+. Also
   the thing Android Auto looks for.
3. `Person` objects built from the real user, reused across notification, shortcut
   and share target so the system sees one consistent identity.
4. Long lived dynamic shortcuts per conversation via
   `ShortcutManagerCompat.pushDynamicShortcut`, `setLongLived(true)`, carrying the
   `Person` and the chat intent. API 30+.
5. `setShortcutInfo` on the notification so the system groups it in the reserved
   Conversations section.

Together those five are what produce WhatsApp-like grouping in the drawer, with no
custom UI work at all.

## P2. Calls, on the platform's own rails

1. `NotificationCompat.CallStyle` (API 31+) to replace the hand built incoming and
   ongoing call notification. System styled answer and decline buttons, and top
   priority in the shade.
2. Direct reply via `setDirectReplyIntent` on message notifications. API 23+.
3. Foreground service type coverage for the media itself: `microphone` during a
   call, and `camera` for video in background, declared alongside `phoneCall` so
   the manifest matches what the call is actually doing.
4. A second incoming call must not ring over a live call. Currently it does.
   A short busy or "already on a call" path is the correct behaviour.

## P3. Sharing in and out

1. `Intent.ACTION_SEND` and `ACTION_SEND_MULTIPLE` intent filters so text, images
   and files can be shared into a conversation from any app.
2. Direct share targets: the long lived shortcuts from P1 with
   `addCapabilityBinding("actions.intent.SEND_MESSAGE")`, so contacts appear in
   the system sharesheet.
3. `MediaStore` save for received images and video, instead of the current
   external storage permissions.

## P4. Floating conversation

`BubbleMetadata` on the conversation notification, pointing at a resizable chat
activity. API 30+. This is what Messenger and Google Messages do. It is opt-in per
user by the system, so it is a differentiator rather than a baseline, and it
depends on P1 being done first because a bubble needs a conversation
notification to hang off.

## P5. Auth

Credential Manager (API 30+) for passkeys and federated sign in, replacing the
custom sign in buttons. Only worth doing once the auth story is otherwise stable.
The existing app lock `BiometricPrompt` work is unrelated and already done.

## P6. Breadth

1. Notification badge via `setNumber` for unread counts. Launcher dependent.
2. App shortcuts for quick actions on the home screen.
3. Wear OS companion notifications.
4. Multi window and split screen correctness for chat.
5. `WorkManager` for deferred work: media upload retries and history sync, so they
   respect Doze instead of fighting it.
6. Big picture style for images in notifications.

## Explicitly not planned

- **A custom keyboard** (`InputMethodService`). Enormous surface area, and a
  sticker keyboard is a product decision rather than a platform exercise.
- **Drag and drop sticker packs.** Low value for this app.

## The TURN decision, which is not really a platform feature

Calls are STUN only. Connectivity is at its ceiling on symmetric NATs and on
networks that block UDP. The fix is a TURN relay, and it is a **decision for the
owner**, not a task, because it needs a provider account or a self-hosted `coturn`
VM plus a shared secret.

What it would take, once decided:

1. A Convex query that mints short lived HMAC signed TURN credentials. The shared
   secret stays server side and never enters the APK.
2. Assemble the `RTCConfiguration` per call from that credential instead of the
   current static `ICE_SERVERS`.
3. Advertise TURN over UDP 443 and TLS 443. TLS on 443 is the only thing that
   survives a network blocking UDP outright.
4. Keep `iceTransportPolicy` at `all`. `relay` would push every call through the
   relay.

Ordering matters: TURN raises the probability that a call connects at all. It does
nothing for a call that connects and is then torn down by a bug, which is why the
deadline and ICE restart work shipped before this was even raised.

## Audit trail

- `docs/call-pipeline-audit.md` covers the current call pipeline against
  reference behaviour, including the NAT traversal analysis behind this section.
