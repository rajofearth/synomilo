# 11 — Web Stack Research (Next.js on the same Convex backend)

**Research date:** 2026-10-13. Every external claim below is cited. Local repo claims cite `file:line`.

**Scope:** what stack to use for a Next.js web app with full feature parity on the *same* Convex deployment, where CometChat is currently used for calls only.

---

## Recommendation

**Data / auth / realtime — keep Convex, unchanged.** Use the `convex` package you already have (^1.46.0). Hooks come from `convex/react` (`ConvexProvider`, `ConvexReactClient`, `useQuery`, `useMutation`, `useConvexAuth`). Server helpers come from `convex/nextjs` (`preloadQuery`, `fetchQuery`, `fetchMutation`, `fetchAction`). Do **not** introduce Convex Auth, Clerk, or Auth0 — this repo does not use Convex Auth at all; it uses a hand-rolled opaque session token in a `sessions` table, passed as an explicit `token` argument to every query/mutation (`convex/auth.ts:73-193`, `convex/lib/helpers.ts` `requireUser`). Plain `ConvexProvider` + the token-as-argument model is the parity-preserving choice. Store the token in an **httpOnly cookie** so Server Components and route handlers can read it.

**Calls — drop CometChat on web; use LiveKit.** `livekit-client` (Apache-2.0) + `@livekit/components-react` (Apache-2.0). Convex stays the source of truth for call state (`convex/calls.ts`), and a Convex action mints LiveKit access tokens with `livekit-server-sdk`'s `AccessToken`. That keeps your signalling in Convex — no second backend. Self-host a single `livekit-server` Docker container for dev, or LiveKit Cloud Build (free, no card) to avoid ops.

**Push — FCM Web, reusing the Firebase service account you already have.** `firebase` (Messaging JS SDK) in the browser + a service worker; `getToken(messaging, { vapidKey })` → store on the Convex user record; send from the existing `internalAction` in `convex/push.ts` with a `webpush` block. Plain Web Push/VAPID is unnecessary because FCM Web *is* Web Push under the hood.

**Call UI — design for "notification that is not a call screen".** A browser cannot show a full-screen incoming-call activity. You get an OS notification with at most 2 action buttons. Ongoing calls are held alive by a live `MediaStreamTrack` + open `RTCDataChannel` (which exempts the tab from Chrome's intensive timer throttling), a `navigator.wakeLock` reacquired on `visibilitychange`, and a floating in-app "call bar" that lives above your router.

---

## Convex + Next.js integration

### Which package?

There is no `@convex-dev/react`. Verified directly against the npm registry:

```
$ Invoke-RestMethod "https://registry.npmjs.org/@convex-dev%2Freact"
NOT FOUND: @convex-dev/react
```

`convex@1.46.0` (the version already in `package.json:34`) exports these subpaths — read from `node_modules/convex/package.json`:

```
., ./react, ./nextjs, ./server, ./values, ./browser, ./react-auth0, ./react-clerk, ./package.json
```

- `convex/react` — `ConvexProvider`, `ConvexReactClient`, `useConvex`, `useQuery`, `useMutation`, `useAction`, `useQueries`, `usePaginatedQuery`, `useSubscription`, `useConvexAuth`, `Authenticated` / `Unauthenticated` / `AuthLoading` / `AuthRefreshing`, `usePreloadedQuery` / `Preloaded`.
- `convex/nextjs` — `preloadQuery`, `fetchQuery`, `fetchMutation`, `fetchAction`.
- `convex/react-auth0`, `convex/react-clerk` — prebuilt providers for Auth0 / Clerk. **Do not use these** (see below).

Source: <https://docs.convex.dev/quickstart/nextjs>, <https://docs.convex.dev/api/modules/nextjs.md>, <https://docs.convex.dev/client/nextjs/app-router.md>

### `"use client"` and SSR rules

1. **Every component that calls `useQuery` / `useMutation` / `useConvex` must have `"use client"` at the top.** These hooks read a React context that only exists below `<ConvexProvider>`, which is itself a client component. This is not optional and not avoidable by nesting.

2. **Client Components do not wait for Convex data by default.** On first paint they render a loading state, then stream updates over the WebSocket. To server-render the first frame you use `preloadQuery` in a Server Component and `usePreloadedQuery` in a Client Component. Source: <https://docs.convex.dev/client/nextjs/app-router/server-rendering>

3. **`fetchQuery` in a Server Component / Route Handler is non-reactive.** It is a one-shot read. Fine for a first paint or a webhook handler; wrong for anything the user watches change.

4. **Consistency caveat — this bites people.** `preloadQuery` and `fetchQuery` are backed by `ConvexHTTPClient`, which is *stateless*. Two calls are **not** guaranteed to see the same database state. The reactive `ConvexReactClient` *is* consistent. So a `preloadQuery` + `useQuery` hybrid can briefly disagree. Source: <https://docs.convex.dev/client/nextjs/app-router/server-rendering>

5. **Share one `ConvexReactClient`.** Constructing it inside a component (or per-route) means a new WebSocket and a re-subscribe on every client-side navigation. Put it at module scope.

### App Router codegen pattern

There is no special Convex codegen for the App Router. `npx convex dev` generates `convex/_generated/api.d.ts`, which already exists in this repo (`convex/_generated/api.d.ts`). You import it by relative path from the web app:

```ts
// src/lib/convex-api.ts  — one place, so web never reaches into ../convex internals
export { api, internal } from "../../convex/_generated/api";
```

The official starter is `npx create convex@latest -t get-convex/convex-nextjs-app-router-demo` (repo: <https://github.com/get-convex/convex-nextjs-app-router-demo>). It is Next 14-era; the integration shape has not changed.

### Provider setup — recommended shape for *this* repo

This is the important bit, and it is different from the docs, because **this app is not using Convex Auth**.

`convex/auth.ts` implements registration/login by PBKDF2-hashing the password, inserting a row into `sessions`, and returning an opaque `genToken()` string. Every function then takes `token: v.string()` as an argument and resolves it via `requireUser(ctx, token)` (`convex/auth.ts:73-193`). There is no `convex/auth.config.ts` in this repo. Therefore:

- `ctx.auth` is always `null` server-side.
- `ConvexReactClient.setAuth(...)` / `ConvexProviderWithAuth` require a **real JWT**, not an opaque session token. `setAuth` takes an `AuthTokenFetcher` returning `Promise<string | null>` and Convex will try to verify it as an OIDC/custom-JWT token. An opaque token will be rejected.

So: **use the plain, unauthenticated `ConvexProvider`**, and keep passing the token as an argument. That is exactly what the existing functions expect, so the web app is byte-for-byte compatible with the mobile app. Zero schema migration, zero behaviour change, one source of truth.

#### `src/app/ConvexClientProvider.tsx`

```tsx
"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

// Module scope: ONE client instance, shared across all client-side navigations.
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
```

#### `src/app/layout.tsx`

```tsx
import type { Metadata } from "next";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./globals.css";

export const metadata: Metadata = { title: "synomiló" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
```

#### A client component using hooks

```tsx
"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex-api";
import { useSessionToken } from "@/components/session-provider";

export function ConversationList() {
  const token = useSessionToken();

  const conversations = useQuery(api.conversations.list, { token });
  const markRead = useMutation(api.conversations.markRead);

  if (conversations === undefined) return <ListSkeleton />;

  return (
    <ul>
      {conversations.map((c) => (
        <li key={c._id}>
          <button onClick={() => markRead({ token, conversationId: c._id })}>
            {c.name}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

#### Session token — cookie, not localStorage

Store the opaque token in an httpOnly cookie. The web app needs it in three places: client hooks (read via a Server Component → prop, or a `GET /api/session` route), Server Components, and route handlers. A cookie is the only one that serves all three without leaking to JS.

```ts
// src/lib/session.ts
import { cookies } from "next/headers";

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get("synomilo_session")?.value;
}
```

```tsx
// src/components/session-provider.tsx
"use client";
import { createContext, useContext, ReactNode } from "react";

const SessionTokenContext = createContext<string | null>(null);

export function SessionTokenProvider({
  token,
  children,
}: {
  token: string | null;
  children: ReactNode;
}) {
  return (
    <SessionTokenContext.Provider value={token}>
      {children}
    </SessionTokenContext.Provider>
  );
}

export const useSessionToken = () => {
  const t = useContext(SessionTokenContext);
  if (!t) throw new Error("useSessionToken used outside SessionTokenProvider");
  return t;
};
```

Login/logout as Next.js route handlers that call the existing Convex mutations and set the cookie:

```ts
// src/app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/lib/convex-api";

export async function POST(req: Request) {
  const { username, password } = await req.json();
  const { token, user } = await fetchMutation(api.auth.login, { username, password });

  const res = NextResponse.json({ user });
  res.cookies.set("synomilo_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
```

#### Optional: SSR preloading

```tsx
// src/app/(app)/chats/page.tsx  — Server Component
import { preloadQuery } from "convex/nextjs";
import { api } from "@/lib/convex-api";
import { readSessionToken } from "@/lib/session";
import { ConversationList } from "./ConversationList";

export default async function ChatsPage() {
  const token = await readSessionToken();
  const preloaded = await preloadQuery(api.conversations.list, token ? { token } : "skip");
  return <ConversationList preloaded={preloaded} />;
}
```

```tsx
// src/app/(app)/chats/ConversationList.tsx
"use client";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import { api } from "@/lib/convex-api";

export function ConversationList({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.conversations.list>;
}) {
  const conversations = usePreloadedQuery(preloaded); // reactive from here on
  /* ... */
}
```

Note: `preloadQuery` / `fetchQuery` / `fetchMutation` / `fetchAction` read the deployment URL from `NEXT_PUBLIC_CONVEX_URL` unless you pass `url` in the options. Source: <https://docs.convex.dev/api/modules/nextjs.md>

### Middleware and auth tokens — the gotcha you asked about

**Convex's token format is JWT-only, and only RS256/ES256.** From the official docs:

> "Custom JWTs are required only to have header fields `kid`, `alg` and `typ`, and payload fields `sub`, `iss`, and `exp`. An `iat` field is also expected by Convex clients to implement token refreshing."
> — <https://docs.convex.dev/auth/advanced/custom-jwt.md>

Configuration lives in `convex/auth.config.ts`:

```ts
import { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      type: "customJwt",
      applicationID: "your-application-id",     // must match JWT `aud` exactly
      issuer: "https://your.issuer.url.com",   // must match JWT `iss` exactly
      jwks: "https://your.issuer.url.com/.well-known/jwks.json",
      algorithm: "RS256",                     // only RS256 and ES256 are supported
    },
  ],
};
```

`issuer` must match `iss` **exactly**, `applicationID` must match `aud` exactly. Convex verifies against the JWKS it fetches from your `issuer`. Convex explicitly warns that omitting `applicationID` is usually insecure because a JWT minted for a sibling app would be accepted. Source: <https://docs.convex.dev/auth/advanced/custom-jwt.md>

**Middleware gotchas, in order of how likely you are to hit them:**

1. **Next.js middleware runs on the Edge runtime by default.** `jose` works there; `jsonwebtoken` and most Node crypto-heavy auth code does not. If you write a JWKS-backed token mint, keep it in a Node-runtime route handler, not `middleware.ts`.
2. **You cannot verify a JWT per-request in middleware against a remote JWKS without caching.** `jose`'s `createRemoteJWKSet` caches, but Convex Auth's own `convexAuthNextjsMiddleware` exists precisely to do this bookkeeping. See <https://labs.convex.dev/auth/authz/nextjs>.
3. **CSRF:** if you store auth state in cookies (Convex Auth does), you must not perform side effects from the Next.js server on GET requests. Only `fetchQuery` is safe from Server Components and GET Route Handlers. Same source.
4. **Don't gate on `useConvexAuth()` in a layout.** Auth helpers in a layout will not stop nested pages from rendering. Use `middleware.ts` for route gating. Same source.
5. **Convex Auth is beta** and its docs say "Support for Next.js is under active development." Source: <https://docs.convex.dev/auth.md>. Another reason not to adopt it here.

**For this repo none of that applies today**, because there is no JWT anywhere. But it is the migration path if you later want `ctx.auth`, so the shape above is what you'd implement.

### CometChat auth key — do not copy `AppConstants.tsx` to the web

`src/utils/AppConstants.tsx:6` holds `authKey: 'ee2fe34b0ca0817cdb650aa4f8b985fb07ed1245'` and `appId: '1683794f9fd14c574'` (region `IN`). The Auth Key is a **server-side master secret**. Bundling it into a Next.js client component leaks it to every visitor. The CometChat docs say so directly:

> "Auth Key is for development only. In production, generate Auth Tokens server-side via the REST API. Never ship auth keys in client code."
> — <https://www.cometchat.com/docs/ui-kit/react/integration-nextjs>

Correct shape: a Convex action mints a CometChat auth token (or, better, don't use CometChat at all — see below).

---

## Calls on web: options compared

### Candidates

| Option | Licence | Self-host? | Custom signalling? | React/Next SSR | Quality / effort |
|---|---|---|---|---|---|
| **LiveKit** (`livekit-client`, `@livekit/components-react`) | **Apache-2.0** (server, client, components) | Yes — one Docker container + redis + TLS + UDP 50000-60000 | **Yes, and you should.** Convex owns call state; a Convex action signs a LiveKit JWT. No second backend required. | `"use client"` + `dynamic(..., { ssr: false })`. Standard. | **Best.** `livekit-client` 2.22.x, `@livekit/components-react` 2.9.x, actively released. Complete React kit (grid, controls, screen share, PiP). Weeks, not months. |
| **mediasoup** (`mediasoup`, `mediasoup-client`) | ISC | Yes — but it is a **long-running Node.js process** holding UDP sockets. Cannot run inside Convex. | Yes, explicitly: "signaling agnostic: do not mandate any signaling protocol" | `mediasoup-client` is browser-safe; no React components exist | Low-level on purpose: "minimalist: just handle the media layer", "super low level API". You write transport negotiation, subscriptions, simulcast, reconnect, and all call UI yourself. Best media quality available, highest engineering cost. |
| **mediasoup-client alone** | ISC | n/a | Only useful against a mediasoup deployment you already operate. Not a product. | — | N/A without a server. |
| **Janus** | **GPL-3.0** | Yes — C, Linux only ("Windows is not supported") | Yes, but plugin-oriented and you write the signalling | `janus.js` is a WebSocket client; no React kit | **GPL-3.0 is a blocker for a closed-source app.** Multi-plugin architecture, docs assume you already understand Janus. |
| **Jitsi** (`jitsi-meet`, `lib-jitsi-meet`) | Apache-2.0 | Yes — but it is a full conferencing product (prosody + jicofo + jvb + web + turn), not a library | **No.** jicofo owns conference state. You cannot make Convex authoritative. | Only usable via iframe or the External API — which means you do not get your own call UI | Cheap to deploy, expensive to integrate. Wrong shape for a product with an existing calls backend. |
| **Daily.co** | Proprietary SaaS | No | One-way only. You may attach custom metadata and Daily calls *your* webhook, so you can mirror state into Convex — but Convex cannot be authoritative. | `"use client"`, dynamic import | Best DX of the commercial tier. 10,000 free participant-min/mo, then $0.004/participant-min (audio-only $0.00099). |
| **Agora** | Proprietary SaaS | No | One-way webhooks, same shape as Daily | `"use client"` | Audio $0.99 / 1k participant-min; HD video $3.99 / 1k; Full HD $8.99 / 1k. 10,000 std min/mo free. **Cloud Proxy has a $500/mo floor.** |
| **Twilio Video** | Proprietary SaaS | No | One-way webhooks; Twilio owns Room lifecycle | `"use client"` | $0.004 per participant-min, 50 participants per Group Room, unlimited TURN. Solid, unremarkable, most expensive per minute of the four. |

### Scoring (1 = bad, 5 = good; weighted toward "will this ship")

| Option | Licence fit | No 2nd paid backend | Time-to-ship | Call-quality ceiling | UI kit / DX | **Weighted** |
|---|---|---|---|---|---|---|
| **LiveKit** | 5 (Apache-2.0) | 5 | 5 | 5 | 5 | **4.95** |
| mediasoup | 4 (ISC) | 5 | 1 | 5 | 1 | 2.95 |
| Jitsi | 4 (Apache-2.0) | 5 | 2 | 4 | 2 | 3.15 |
| Daily.co | 2 (closed SaaS) | 1 | 5 | 4 | 5 | 3.20 |
| Agora | 2 (closed SaaS) | 1 | 4 | 4 | 4 | 2.85 |
| Twilio Video | 2 (closed SaaS) | 1 | 4 | 4 | 4 | 2.85 |
| Janus | **1 (GPL-3.0)** | 5 | 2 | 4 | 2 | 2.55 |

### Recommendation: LiveKit, self-hosted first

**Why it wins on the axis that matters.** Every commercial option makes LiveKit's SFU a *second backend* whose session lifecycle you do not control, whose per-minute cost scales linearly with your users, and whose only integration seam is a one-way webhook. LiveKit is the only candidate that is simultaneously Apache-2.0, self-hostable, and designed so that **you** own the signalling: the SFU just forwards media and publishes participant state; Convex owns "who is calling whom, ring, accept, decline, timeout, call log".

**Concretely, that means:** `convex/calls.ts` stays the call record and state machine. A new Convex action signs a LiveKit access token with `livekit-server-sdk`. The client connects with that token. No new persistent service, no new datastore, no per-minute billing, no webhook reconciliation.

```ts
// convex/calls.ts  (additive — does not change existing behaviour)
import { action } from "./_generated/server";
import { v } from "convex/values";
import { AccessToken } from "livekit-server-sdk";

export const mintLiveKitToken = action({
  args: { token: v.string(), roomName: v.string() },
  handler: async (ctx, { token, roomName }) => {
    const user = await requireUser(ctx, token);           // existing helper
    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
      { identity: user.username, name: user.displayName, ttl: "10m" },
    );
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    return { token: await at.toJwt(), serverUrl: process.env.LIVEKIT_URL! };
  },
});
```

```tsx
"use client";
import { LiveKitRoom, VideoConference, RoomAudioRenderer } from "@livekit/components-react";
import "@livekit/components-styles";

export function CallRoom({ serverUrl, token }: { serverUrl: string; token: string }) {
  return (
    <LiveKitRoom serverUrl={serverUrl} token={token} connect audio video>
      <VideoConference />
      <RoomAudioRenderer />          {/* keep this mounted; it owns the <audio> element */}
    </LiveKitRoom>
  );
}
```

```tsx
// src/app/call/[sessionId]/page.tsx  — App Router: never SSR the call surface
import dynamic from "next/dynamic";
const CallRoom = dynamic(() => import("./CallRoom"), { ssr: false });
export default function Page() { return <CallRoom />; }
```

### Cost reality check

**Self-host (recommended to start).** One `livekit/server` container, redis (recommended for production), a real domain with a trusted TLS cert, and UDP 50000-60000 + TCP 7881 open. LiveKit ships an **embedded TURN server** whose auth is integrated with the signalling connection, so you do not need coturn. Docs recommend 10 Gbps ethernet and compute-optimised instances; host networking if containerised. Up to ~3,000 users per room. Source: <https://docs.livekit.io/transport/self-hosting/deployment>, <https://docs.livekit.io/home/self-hosting/ports-firewall>, <https://docs.livekit.io/transport/self-hosting>

**LiveKit Cloud (escape hatch).** Build plan **$0/mo, no credit card**, includes 5,000 WebRTC minutes / month and 100 concurrent connections. Ship $50/mo includes 150,000 WebRTC minutes then $0.0005/min. Scale $500/mo includes 1.5M minutes then $0.0004/min. Managed single-server deployment ("LiveKit Deploy") is $109.99/mo. Source: <https://livekit.com/pricing.md>, <https://livekit.blog/pricing>

**Compare:** Agora HD video is $3.99 / 1k participant-min (~$0.004/min); Daily video is $0.004/participant-min; Twilio is $0.004/participant-min. A 10-user group call lasting 10 minutes = 100 participant-minutes ≈ **$0.40** on any of them. LiveKit Cloud Scale is ~$0.0004/min → **$0.04**. Self-hosted is bandwidth only.

---

## Push + call UI on web

### What actually works: FCM Web

**CometChat does support web push**, so this is a solved path if you stay on CometChat. The mechanism is FCM Web with a Provider ID:

```js
import { initializeApp } from "firebase/app";
import { getMessaging, getToken } from "firebase/messaging";
import { CometChatNotifications } from "@cometchat/chat-sdk-javascript";

const token = await getToken(messaging, { vapidKey: FIREBASE_VAPID_KEY });

await CometChatNotifications.registerPushToken(
  token,
  CometChatNotifications.PushPlatforms.FCM_WEB,
  COMETCHAT_CONSTANTS.FCM_PROVIDER_ID,   // from the CometChat dashboard
);
```
Source: <https://www.cometchat.com/docs/notifications/web-push-notifications>

**But you don't need CometChat to send your push.** Your repo already has the whole Firebase server side: `convex/push.ts` is a `"use node"` internal action holding `FCM_SERVICE_ACCOUNT` and calling `messaging.sendEachForMulticast`. FCM Web tokens are ordinary registration tokens; you send them with the same service account, adding a `webpush` block:

```ts
// convex/push.ts  — additive
export const sendWebPush = internalAction({
  args: { tokens: v.array(v.string()), payload: v.any() },
  handler: async (_ctx, { tokens, payload }) => {
    const messaging = await getMessaging();
    return messaging.sendEachForMulticast({
      tokens,
      webpush: {
        notification: payload.notification,   // title, body, icon, tag, requireInteraction
        data: payload.data,
        fcmOptions: { link: "/call/abc123" },  // click-through URL
        headers: { TTL: "60" },
      },
    });
  },
});
```

FCM HTTP v1 `WebpushConfig` accepts `headers`, `data`, `notification`, `fcm_options` — and `notification` is "a JSON object. Supports Notification instance properties as defined in the Web Notification API." So anything the browser supports is expressible. Source: <https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages>, <https://firebase.google.com/docs/cloud-messaging/send/v1-api>

**Recommendation:** skip CometChat's push pipeline for web, and drive the web push from your own Convex action. You already own the call record in `convex/calls.ts`; you should own the notification too.

### Browser support, honestly

| Browser | Web Push | Caveat |
|---|---|---|
| **Chrome desktop / Android** | Yes | Push API Baseline "widely available" since March 2023. No delivery quota. |
| **Edge** | Yes | Same engine. |
| **Firefox desktop** | Yes | **Quota on push messages**, refreshed each site visit. Messages that produce a notification are **exempt** from the quota. Source: <https://developer.mozilla.org/en-US/docs/Web/API/Push_API> |
| **Safari macOS 16+ / Ventura+** | Yes | Standard VAPID path — **no Apple Developer account needed** if you already use VAPID. |
| **Safari iOS / iPadOS 16.4+** | **Home Screen web apps only** | The site **must be added to the Home Screen** and launched from there. A normal Safari tab gets nothing. Because all iOS browsers are WebKit, this applies to Chrome/Edge on iOS too. Permission must come from a user gesture inside the installed app. Source: <https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers>, <https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/> |
| **Safari iOS < 16.4** | No | — |

Two Safari-specific constraints that will bite you:

1. **Safari revokes notification permission if you do not show the notification immediately.** Apple's docs: *"Safari doesn't support invisible push notifications. Present push notifications to the user immediately after your service worker receives them. If you don't, Safari revokes the push notification permission for your site."* So a silent background fetch is not an option on Safari — you must call `showNotification` from the service worker's `push` handler every time. Source: same Apple doc.
2. **Offline delivery is finite and lossy.** *"If the push service can't deliver the notification, the push service removes the notification from storage permanently. The number of notifications the push services stores while the device is offline is limited."* Source: same Apple doc. Design for a missed push, not as the only path.

### To receive a push with the tab CLOSED

Four things, all required:

1. **HTTPS** (localhost excepted).
2. **A registered, activated service worker** with a `push` event listener.
3. **Notification permission = `granted`**, requested from a **user gesture**. (Mandatory on iOS; good hygiene everywhere. `Notification.requestPermission()` called outside a gesture is ignored/rejected in several browsers.)
4. **An active `PushSubscription`** whose endpoint is stored server-side, keyed per user *and per browser* — a user can have many.

```ts
// public/sw.js  (Next.js App Router: files in /public are served at the root)
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "synomiló", {
      body: data.body ?? "Incoming call",
      icon: "/icons/caller-192.png",
      badge: "/badge.png",
      tag: data.sessionId,          // replaces the same call's notification
      renotify: true,               // only legal because tag is set
      requireInteraction: true,     // stay until dismissed — Limited availability
      silent: false,
      vibrate: [200, 100, 200, 100, 200],
      data,                         // survive the click
      actions: [
        { action: "accept", title: "Accept" },
        { action: "decline", title: "Decline" },
      ],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (event.action === "decline") {
      // fire-and-forget to your backend, do not focus the page
      await fetch("/api/calls/decline", { method: "POST", body: JSON.stringify(d), credentials: "include" });
      return;
    }
    // accept (or plain click): focus or open the call route
    const url = `/call/${d.sessionId}`;
    for (const c of all) {
      if ("focus" in c) { await c.focus(); c.postMessage({ type: "call-ringing", data: d }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
```

Constraints on that code, stated plainly:

- **`actions` is capped.** Chrome renders **at most two** buttons. Check `Notification.maxActions` at runtime; Safari support for `actions` on iOS is limited. Source: <https://developer.mozilla.org/en-US/docs/Web/API/Notification/actions>, <https://developer.chrome.com/blog/notification-actions>
- **`renotify: true` requires a non-empty `tag`**, else the constructor throws. Source: <https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification>
- **`requireInteraction` is "Limited availability"** — it is *not* Baseline, and Chrome on Android **ignores** it. Source: <https://developer.mozilla.org/en-US/docs/Web/API/Notification/requireInteraction>, <https://developer.chrome.com/blog/notification-requireInteraction>

### The hard limitation: you cannot show an incoming-call activity

**Be explicit about this, because the mobile app has it and the web app will not.**

Android's `USE_FULL_SCREEN_INTENT` and iOS CallKit/PushKit both launch an **Activity / system call UI that takes over the screen**. The web platform has no equivalent, and this is a known, acknowledged, unresolved gap — not something you can work around.

Microsoft's Edge team says it plainly:

> "the API doesn't currently let you customize the buttons that appear inside of a notification, or make the notification higher priority than others, or associate a ringtone with it. You might even have needed to implement your own custom incoming call notification mechanism."
> — <https://blogs.windows.com/msedgedev/2025/02/04/request-for-feedback-incoming-call-notifications-api>

They filed an **explainer** proposing `options.scenario = "incoming-call"`, which would add visually-distinguished styling, custom answer/reject buttons, an associated ringtone, and higher priority. They prototyped it in Chromium. **It is behind a feature flag and has not shipped:**

```
msedge.exe --enable-features=IncomingCallNotifications
```

Explainer: <https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/Notifications/notifications_actions_customization.md>

What this means concretely, and what you must design around:

| You want | Web reality |
|---|---|
| Full-screen ringing UI | **Impossible.** You get an OS-rendered notification toast/banner. |
| Custom ringtone looping until answered | **Impossible.** Notifications may play a system-selected sound; you cannot attach a looping custom ringtone. |
| Notification that persists until acted on | `requireInteraction`, "Limited availability", ignored on Chrome Android. Do not depend on it. |
| Custom Accept / Decline buttons | At most 2, and only where `Notification.maxActions > 0`. Safari coverage is patchy. |
| "Critical"/priority alerts that bypass Focus or DND | **Impossible.** OS focus modes suppress it and you cannot override. |
| Surviving OS truncation | **You cannot.** The OS renders and truncates title/body. There is no `title` size guarantee. Keep title ≤ ~40 chars and put nothing load-bearing in it. |
| Knowing whether it was shown | `notificationclose` fires only on **active user dismissal**; auto-dismiss does not fire it. |
| Ring a call when the tab is closed and the browser is *quit* | Works while the browser process runs. Not when the browser is fully exited — no browser does this. |

**What you *can* do — the recommended UX pattern.**

1. **Foreground / tab open.** Do **not** use an OS notification. Render your own full incoming-call overlay (`z-index` over the router). This is the one case where you get a real call screen. Keep a looping ringtone via a short `<audio loop>` — autoplay is permitted because the user clicked the call button earlier in the same tab.
2. **Tab backgrounded or hidden.** Show a persistent OS notification with `tag: sessionId`, `renotify: true`, `requireInteraction: true`, and two actions. Play your own ringtone through an `AudioContext` from the page — background tabs are *not* audio-muted if they are actively playing, and that also earns the timer-throttling exemption below. Note: **the page must still be alive**; if the user closed the tab, step 3 is what runs.
3. **Tab closed, browser running.** The service worker `push` handler fires and shows the same notification. The page is gone, so no ringtone you control — the OS sound is all you get. Clicking Accept opens `/call/[sessionId]`, which then needs mic/camera permission from that click (a user gesture, so it works).
4. **iOS.** Only reachable if the user installed the PWA. Add an explicit "Add to Home Screen for call notifications" prompt at an appropriate moment, then request permission from a gesture inside the installed app.
5. **Never make the notification the only channel.** Show an in-app missed-call entry in `convex/calls.ts` (you already have `CALL_LOGS` in `SCREEN_CONSTANTS`), and treat push as an accelerant. Push is lossy by design — finite offline queues, revoked permissions, Focus modes, user dismissal.

### Keeping a call alive: tab switching, minimising, wake lock

**Chrome's timer throttling is the actual threat, and WebRTC is the exemption.** The ladder from <https://developer.chrome.com/blog/timer-throttling-in-chrome-88/>:

1. **Minimal** — page visible, *or* "the page has made noises in the past 30 seconds" (from any sound-making API; a *silent* audio track does not count). Timers unthrottled.
2. **Throttling** — chain count < 5, **or** page hidden < 5 minutes, **or "WebRTC is in use. Specifically, there's an `RTCPeerConnection` with an 'open' `RTCDataChannel` or a 'live' `MediaStreamTrack`."** → checked **once per second**.
3. **Intensive** — hidden > 5 min **AND** chain ≥ 5 **AND** silent ≥ 30 s **AND WebRTC not in use** → checked **once per minute**.

The practical reading: a live call with a live `MediaStreamTrack` and an open `RTCDataChannel` **never reaches tier 3**. You drop to ~1 Hz, which is plenty for UI timers. This is why you must keep a `LiveDataChannel` open — `@livekit/components-react`'s data channel or `room.localParticipant.publishData()` does it for you.

**Chromium also refuses to discard pages that are "Playing audio / Using WebRTC / Updating the table title or favicon / Showing alerts / Sending push notifications."** So a live call survives background tabbing, including under memory pressure. Source: <https://developer.chrome.com/docs/web-platform/page-lifecycle-api>

**`AudioContext`.** Use it for two things:

- The in-app ringtone, routed through a `GainNode` so you can duck it. Firefox explicitly exempts background tabs that have an `AudioContext` with an active node from background `setTimeout` throttling. Source: <https://bugzilla.mozilla.org/show_bug.cgi?id=1181073>
- **As a fallback wake signal on non-Chromium.** On Chrome a *silent* AudioContext does **not** buy you anything — the spec text says "a silent audio track doesn't count". Do not design around it; rely on the WebRTC exemption above.

**`navigator.wakeLock`.** Baseline newly available since March 2025. Chrome 84+, Edge 84+, Firefox 126+, Safari 16.4+ (iOS Safari full support only from 18.4). ~95% global. Source: <https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API>, <https://caniuse.com/mdn-api_wakelock>, <https://web.dev/blog/screen-wake-lock-supported-in-all-browsers>

The lock is **released automatically when the tab becomes invisible**, so you must re-acquire on `visibilitychange`:

```ts
let sentinel: WakeLockSentinel | null = null;

async function acquire() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try {
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => { sentinel = null; });
  } catch {
    // Rejected for low battery / power-save. Non-fatal.
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !sentinel) void acquire();
});
```

Treat wake lock as a nicety, never a requirement. It is gated by the `screen-wake-lock` permissions policy and can be refused for battery reasons at any time.

**Ongoing-call indicator — render it yourself, above the router.** Put a persistent `<CallBar />` in your authenticated layout (inside `ConvexClientProvider`, outside the routed children) so it survives navigation:

- **Visible:** docked bottom-right card with avatar, elapsed timer, mute, camera, hang-up.
- **Hidden:** also re-issue the OS notification on a timer (say every 25 s) with `tag: sessionId` so the user can get back in. Not `renotify: true` — that would sound the OS every 25 s.
- **Unload:** `navigator.sendBeacon("/api/calls/leave", ...)` on `pagehide`. Do not rely on `beforeunload`.
- **Tab discarded:** `document.wasDiscarded` (Chrome desktop) tells you on next load that you were killed. Reconcile from `convex/calls.ts` and show a "Rejoin call?" prompt rather than assuming the call ended. Source: same Page Lifecycle doc.

### Screen share and picture-in-picture

**`getDisplayMedia` always requires a user gesture.** There is no auto-start. The user picks the surface every single time, and `displaySurface` may be `browser` rather than `window`/`monitor` depending on browser and user choice. Never attempt to trigger it from a push handler or an effect.

**`documentPictureInPicture`** — an always-on-top floating window containing *arbitrary HTML*, which is exactly what a mini call UI needs. `window.documentPictureInPicture.requestWindow({ width, height })` returns a `Window` you can mount React into.

Support is thin and **excludes Safari entirely**:

| Browser | `documentPictureInPicture` |
|---|---|
| Chrome 130+ | Yes |
| Edge 130+ | Yes |
| Firefox 151+ | Yes |
| **Safari (incl. 26.5 / TP)** | **No** |
| Chrome for Android | Yes |
| Firefox for Android | No |
| Safari iOS | No |

Global usage ≈ **24.6%**. Source: <https://caniuse.com/wf-document-picture-in-picture>, <https://developer.mozilla.org/en-US/docs/Web/API/DocumentPictureInPicture>, <https://developer.chrome.com/blog/document-pip-use-case>

`HTMLVideoElement.requestPictureInPicture()` (video-only) is far wider: Chrome 69+, Edge 79+, Safari 13.1+ / iOS 13.4+, Firefox only from 153. Use the video-element form as the baseline and the Document PiP form as progressive enhancement. Source: <https://caniuse.com/mdn-api_document_pictureinpictureenabled>, <https://developer.mozilla.org/en-US/docs/Web/API/Picture-in-Picture_API>

Other PiP limits worth knowing: the PiP title bar cannot be hidden, fullscreen is blocked inside the PiP window, and only one PiP window is allowed at a time.

### Outgoing call "outlined" via the Notification API — no

**You cannot render a persistent call bar from a notification.** The `Notification` interface has no concept of a live, updating, user-interactive surface. What you actually get:

- `new Notification(title, options)` **throws a `TypeError` in nearly all mobile browsers** — you must go through `ServiceWorkerRegistration.showNotification()`. Source: <https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification>
- The title is rendered and truncated by the **OS**, not by you. There is no length guarantee.
- A notification is a snapshot at a moment. It cannot be updated to show a live duration or to change buttons.
- On Android, `requireInteraction` is ignored, and Chrome's Notification Center is gone on desktop — "minimized notifications are considered to be dismissed." Source: <https://developer.chrome.com/blog/notification-requireInteraction>

So the answer is no. Design a real in-app indicator.

---

## Licencing risks

### 1. CometChat is proprietary, and this is the blocker

Every CometChat JS package — `@cometchat/chat-sdk-javascript` (4.1.8), `@cometchat/calls-sdk-javascript` (5.0.7), `@cometchat/push-notifications-react-native` (1.0.0) — is published under **"SEE LICENSE IN LICENSE.md"** (the Calls SDK's npm metadata literally reads `License: none`), and every `LICENSE.md` is the same two lines:

> ```
> Copyright (c) 2023 CometChat Inc.
> License agreement: https://www.cometchat.com/legal-terms-of-service
> ```
> Sources: <https://raw.githubusercontent.com/cometchat/chat-sdk-javascript/v4/LICENSE.md>, <https://raw.githubusercontent.com/cometchat/calls-sdk-javascript/v5/LICENSE>

There is **no OSS / MIT / Apache grant**. What the ToS actually grants (last revised 2026-02-03):

- **§1.01** — "a limited, non-exclusive, revocable, non-assignable, non-transferable right to view and use the Services for your personal or commercial use."
- **§5.03** — "we grant you a non-exclusive, limited, revocable right to access and use the CometChat Technology... subject to... the payment of all incurred Fees (if applicable)."
- **§3.01** — "Certain features of the Software are limited to paying users."
- **§4.04(e)** — you may not "use the Services in the development, directly or indirectly, of any product, software, or service that offers any functionality substantially similar to, or competitive with, the Software." **If this web app is ever positioned as a competitor to CometChat's own chat product, that is a direct ToS breach.**
- **§9** — liability capped at fees paid in the prior 12 months, **or $10 if you never subscribed**.

Source: <https://www.cometchat.com/legal-terms-of-service>

**The free "Build" plan is development-only.** Pricing page (verified 2026-05-20):

- **Build** — $0, "Free for development", 100 users, 25 concurrent connections, no credit card.
- **Basic** — $298.75/mo at 1k MAU ($239/mo on annual billing).
- **Advanced** — $448.75/mo at 1k MAU.
- **Enterprise** — from $1,248.75/mo at 1k MAU.
- Calls are a **separate usage-priced product family**, metered in voice/video minutes.

Source: <https://www.cometchat.com/pricing>

**Verdict: do not put CometChat in the web app.** The free tier is explicitly scoped to development, the SDK is revocably licensed rather than permissively licensed, and the competitive-use clause plus a $10 liability cap are unacceptable for something you intend to ship. Use LiveKit (Apache-2.0) and your own Convex backend.

### 2. Janus is GPL-3.0 — a hard no for a closed-source app

`meetecho/janus-gateway` is GPL-3.0. Embedding or shipping its client in a proprietary app carries copyleft obligations. It also does not support Windows (WSL only), so you cannot develop against it natively on this machine. Source: <https://github.com/meetecho/janus-gateway>

### 3. Daily.co, Agora, Twilio Video are closed SaaS

No self-host, no source, per-minute billing, and vendor-controlled session lifecycle. Legal risk is nil, but the engineering and cost risk is real: you cannot make Convex authoritative over the call.

### 4. The CometChat Auth Key is a live secret in the repo

`src/utils/AppConstants.tsx:6` contains `authKey: 'ee2fe34b0ca0817cdb650aa4f8b985fb07ed1245'`. It is checked into git. If this web app ever needs CometChat at all (or if the RN app is ever reverse-engineered), that key is compromised and must be rotated. The CometChat docs are unambiguous: "Never ship auth keys in client code."

### 5. What is fine

- **Convex** — SaaS, standard terms; the client `convex` package is Apache-2.0.
- **LiveKit** — Apache-2.0 across `livekit/livekit`, `livekit/client-sdk-js` (`livekit-client`), and `livekit/components-js` (`@livekit/components-react`). Cloud is a paid service but the OSS server is genuinely OSS and the Cloud service is not required.
- **mediasoup / mediasoup-client** — ISC (permissive). Overkill for this project, but not a legal problem.
- **Jitsi** — Apache-2.0. No legal problem, just the wrong shape.
- **Firebase** — standard Google terms.

---

## Notes on CometChat specifics

**Can a browser drive calls against the existing CometChat app?** Yes, technically. `@cometchat/calls-sdk-javascript` v5 `init({ appId, region })` takes exactly the `appId` and `region` you already have (`1683794f9fd14c574`, `IN`), and the React UI Kit v7 wires it up via `.setCallingEnabled(true)` on `UIKitSettingsBuilder` — it passes the same credentials through automatically. Browser support is Chrome 72+, Firefox 68+, Safari 12.1+, Edge 79+; HTTPS required for camera/mic. The React UI Kit v7 is documented as "SSR-safe — no browser APIs at module scope. Next.js App Router compatible," though its own Next.js guide still instructs you to use `dynamic(() => import(...), { ssr: false })`. Sources: <https://www.cometchat.com/docs/calls/javascript/setup.md>, <https://www.cometchat.com/docs/ui-kit/react/calling-integration>, <https://www.cometchat.com/docs/ui-kit/react/overview>

So the answer is "yes, and it is well documented" — and the reason not to do it is entirely licence + price, not capability.

**CometChat's push service does support web.** Documented, with a dedicated guide, using `CometChatNotifications.PushPlatforms.FCM_WEB` and a dashboard `Provider ID`. Source: <https://www.cometchat.com/docs/notifications/web-push-notifications>, <https://www.cometchat.com/docs/notifications/push-overview>

**Does CometChat push carry call state to the web?** Partially. The payload includes `type: "call"`, `callAction` (`initiated` / `cancelled` / `unanswered` / `busy` / `ongoing`), `callType`, `senderAvatar`, and `tag`, and the reference service worker switches on those to build the notification body. But there is **no web equivalent of native call UI** — the reference code is an ordinary `showNotification`. That confirms the platform limit independently: CometChat's own web integration has nothing better to offer.

**`@cometchat/push-notifications-react-native`** (v1.0.0, published ~25 days before this research, 65 weekly downloads) is the mobile counterpart and is explicitly native-only. From its README:

> "A small native 'display engine' (our own Kotlin + Swift) shows the notification and rings the system call UI (FCM + notifications on Android; PushKit + CallKit on iOS) and captures push tokens."
> "The Android manifest adds... `USE_FULL_SCREEN_INTENT`, `FOREGROUND_SERVICE_PHONE_CALL`, `MANAGE_OWN_CALLS`... plus the incoming-call service and ringing screen."
> "For apps targeting Android 14+, Google Play requires two declarations... **Full-screen intent permission** — declare calling as core functionality. Without it Play revokes `USE_FULL_SCREEN_INTENT`, and calls ring only as a heads-up notification."

Source: <https://www.npmjs.com/package/@cometchat/push-notifications-react-native>

That is the clearest possible statement of the asymmetry: **the OS-level incoming-call surface is a native capability.** There is no web package, because there cannot be one. Your mobile app has `fullScreenIntent`; your web app does not. Design for that asymmetry rather than trying to close it.

---

## Sources

**Convex**
- <https://docs.convex.dev/quickstart/nextjs>
- <https://docs.convex.dev/client/nextjs/app-router.md>
- <https://docs.convex.dev/client/nextjs/app-router/server-rendering>
- <https://docs.convex.dev/client/nextjs/pages-router.md>
- <https://docs.convex.dev/api/modules/nextjs.md>
- <https://docs.convex.dev/auth.md>
- <https://docs.convex.dev/auth/advanced/custom-jwt.md>
- <https://docs.convex.dev/auth/functions-auth>
- <https://labs.convex.dev/auth/authz/nextjs>
- <https://labs.convex.dev/auth/api_reference/nextjs>
- <https://labs.convex.dev/auth/api_reference/nextjs/server>
- <https://github.com/get-convex/convex-nextjs-app-router-demo/blob/main/app/ConvexClientProvider.tsx>
- <https://github.com/get-convex/convex-auth/blob/main/src/nextjs/index.tsx>
- <https://github.com/get-convex/convex-js/blob/main/src/server/authentication.ts>
- <https://www.convex.dev/templates/nextjs-app-router>
- Local: `package.json`, `convex/auth.ts`, `convex/push.ts`, `src/utils/AppConstants.tsx`, `node_modules/convex/package.json`, `node_modules/convex/dist/esm-types/react/{index,ConvexAuthState}.d.ts`

**CometChat**
- <https://www.cometchat.com/legal-terms-of-service>
- <https://www.cometchat.com/pricing>
- <https://www.cometchat.com/docs/sdk/javascript/setup-sdk>
- <https://www.cometchat.com/docs/calls/javascript/setup.md>
- <https://www.cometchat.com/docs/ui-kit/react/overview>
- <https://www.cometchat.com/docs/ui-kit/react/overview.md>
- <https://www.cometchat.com/docs/ui-kit/react/integration-nextjs>
- <https://www.cometchat.com/docs/ui-kit/react/calling-integration.md>
- <https://www.cometchat.com/docs/ui-kit/react/next-tab-based-chat>
- <https://www.cometchat.com/docs/ui-kit/react/v6/overview>
- <https://www.cometchat.com/docs/notifications/web-push-notifications>
- <https://www.cometchat.com/docs/notifications/web-push-notifications.md>
- <https://www.cometchat.com/docs/notifications/push-overview>
- <https://www.cometchat.com/docs/notifications/react-native-push-notifications-ios>
- <https://www.cometchat.com/docs/rest-api/notifications-apis/push/register-push-token>
- <https://www.cometchat.com/tutorials/how-to-build-a-chat-app-with-nextjs>
- <https://www.cometchat.com/blog/cometchat-react-ui-kit-v7>
- <https://www.npmjs.com/package/@cometchat/chat-sdk-javascript>
- <https://www.npmjs.com/package/@cometchat/calls-sdk-javascript>
- <https://www.npmjs.com/package/@cometchat/push-notifications-react-native>
- <https://github.com/cometchat/chat-sdk-javascript>
- <https://github.com/cometchat/calls-sdk-javascript>
- <https://raw.githubusercontent.com/cometchat/chat-sdk-javascript/v4/LICENSE.md>
- <https://raw.githubusercontent.com/cometchat/calls-sdk-javascript/v5/LICENSE>
- <https://github.com/cometchat/chat-sdk-javascript/releases>
- <https://assets.cometchat.io/legacy-docs/notifications/push-notifications-extension-legacy.html>

**WebRTC / calls candidates**
- <https://github.com/livekit/livekit>
- <https://github.com/livekit/components-js>
- <https://github.com/livekit/node-sdks>
- <https://docs.livekit.io/transport/self-hosting>
- <https://docs.livekit.io/transport/self-hosting/deployment>
- <https://docs.livekit.io/home/self-hosting/ports-firewall>
- <https://docs.livekit.io/home/server/generating-tokens>
- <https://docs.livekit.io/frontends/build/authentication/>
- <https://docs.livekit.io/reference/server-sdk-js/>
- <https://docs.livekit.io/reference/components/agents-ui/component/nextjs-api-token-route>
- <https://docs.livekit.io/home/cloud/billing>
- <https://github.com/livekit/components-js/blob/main/examples/nextjs/pages/api/livekit/token.ts>
- <https://github.com/livekit/components-js/releases>
- <https://www.npmjs.com/package/livekit-client>
- <https://www.npmjs.com/package/@livekit/components-react>
- <https://livekit.com/pricing>
- <https://livekit.com/pricing.md>
- <https://livekit.blog/pricing>
- <https://livekit.com/blog/livekit-cloud-vs-self-host>
- <https://livekit.com/blog/announcing-livekit-cloud>
- <https://mediasoup.org/>
- <https://www.npmjs.com/package/mediasoup>
- <https://github.com/meetecho/janus-gateway>
- <https://github.com/jitsi/jitsi-meet>
- <https://github.com/jitsi>
- <https://www.daily.co/pricing/video-sdk>
- <https://www.agora.io/en/pricing/video-calling>
- <https://www.twilio.com/en-us/video/pricing>
- <https://www.forasoft.com/blog/article/livekit-vs-agora-cost-analysis>

**Push / notifications**
- <https://developer.mozilla.org/en-US/docs/Web/API/Push_API>
- <https://developer.mozilla.org/en-US/docs/Web/API/Notification>
- <https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification>
- <https://developer.mozilla.org/en-US/docs/Web/API/Notification/actions>
- <https://developer.mozilla.org/en-US/docs/Web/API/Notification/requireInteraction>
- <https://developer.mozilla.org/en-US/docs/Web/API/Notification/renotify>
- <https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers>
- <https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/>
- <https://firebase.google.com/docs/cloud-messaging/web/get-started>
- <https://firebase.google.com/docs/cloud-messaging/send/v1-api>
- <https://firebase.google.com/docs/cloud-messaging/customize-messages/cross-platform>
- <https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages>
- <https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.webpushconfig>
- <https://firebaseopensource.com/projects/firebase/quickstart-js/messaging/readme>
- <https://firebase.blog/posts/2018/05/web-notifications-api-support-now>
- <https://developer.chrome.com/blog/notification-actions>
- <https://developer.chrome.com/blog/notification-requireInteraction>
- <https://developer.chrome.com/blog/notifications>
- <https://blogs.windows.com/msedgedev/2025/02/04/request-for-feedback-incoming-call-notifications-api>
- <https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/Notifications/notifications_actions_customization.md>
- <https://help.pushwoosh.com/hc/en-us/articles/31253741121693-Which-browsers-support-web-push-notifications>
- <https://documentation.onesignal.com/docs/en/web-push-for-ios>

**In-call UX / platform APIs**
- <https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API>
- <https://developer.mozilla.org/en-US/docs/Web/API/WakeLock>
- <https://developer.mozilla.org/en-US/docs/Web/API/Navigator/wakeLock>
- <https://caniuse.com/mdn-api_wakelock>
- <https://web.dev/blog/screen-wake-lock-supported-in-all-browsers>
- <https://developer.chrome.com/docs/capabilities/web-apis/wake-lock>
- <https://developer.chrome.com/blog/timer-throttling-in-chrome-88/>
- <https://developer.chrome.com/docs/web-platform/page-lifecycle-api>
- <https://bugzilla.mozilla.org/show_bug.cgi?id=1181073>
- <https://www.w3.org/TR/2024/WD-screen-wake-lock-20240527>
- <https://developer.mozilla.org/en-US/docs/Web/API/DocumentPictureInPicture>
- <https://developer.mozilla.org/en-US/docs/Web/API/Picture-in-Picture_API>
- <https://developer.chrome.com/docs/web-platform/document-picture-in-picture/>
- <https://developer.chrome.com/blog/document-pip-use-case>
- <https://caniuse.com/wf-document-picture-in-picture>
- <https://caniuse.com/mdn-api_document_pictureinpictureenabled>