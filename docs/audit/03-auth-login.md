# 03 - Auth & Login Audit (synomilo)

Scope: Convex auth (`convex/auth.ts`, `convex/schema.ts`, `convex/lib/helpers.ts`),
client session (`src/auth/SessionProvider.tsx`, `src/auth/cometchatSession.ts`,
`src/navigation/AuthContext.tsx`) and the credential UI (`Login.tsx`, `SignUp.tsx`,
`SampleUser.tsx`, `AppCredentials.tsx`, `Skeleton.tsx`).
Read-only audit. No source file was modified.
## Root cause summary

Ranked, most user-visible first.

### R1 - [CRITICAL UX] The Login screen is unreachable in debug builds and is a one-way door in release builds

`navigate(SCREEN_CONSTANTS.LOGIN)` **does not exist anywhere in the codebase.**
`SCREEN_CONSTANTS.LOGIN` appears in exactly two places, both inside the navigator:

- `src/navigation/RootStackNavigator.tsx:90` - `initialRouteName` fallback
- `src/navigation/RootStackNavigator.tsx:100` - `<Stack.Screen name={SCREEN_CONSTANTS.LOGIN} ...>`

React Navigation reads `initialRouteName` **once**, when the navigator mounts.
`src/navigation/RootStackNavigator.tsx:83-91`:

```tsx
initialRouteName={
  isLoggedIn
    ? SCREEN_CONSTANTS.BOTTOM_TAB_NAVIGATOR
    : __DEV__
    ? _hasValidAppCredentials
      ? SCREEN_CONSTANTS.SAMPLE_USER
      : SCREEN_CONSTANTS.APP_CRED
    : SCREEN_CONSTANTS.LOGIN
}
```

Two consequences:

**(a) Debug builds never show the login screen.** `App.tsx:118-126` reads
`appCredentials` from AsyncStorage and falls back to `AppConstants.appId` /
`AppConstants.authKey` / `AppConstants.region` (`src/utils/AppConstants.tsx:6-8`),
which are **hardcoded, non-empty**. So `hasValidAppCredentials` is *always* `true`,
`initialRouteName` is always `SAMPLE_USER`, and `Login`/`SignUp` are registered but
unreachable. The dev lands on `SampleUser`, which performs a **CometChat-only** login:

- `src/components/login/SampleUser.tsx:103` - `await CometChatUIKit.login({ uid })`
- `src/components/login/SampleUser.tsx:104-108` - resets to `BottomTabNavigator`

No Convex session is ever created. `App.tsx:92` `isLoggedIn = !!sessionUser` stays
`false`, so every Convex call in the app throws
`"Your session has expired. Please log in again."` (`convex/lib/helpers.ts:18`)
while most call sites swallow the error.

**(b) Release builds strand the user after logout.** `signOut`
(`src/auth/SessionProvider.tsx:81-92`) clears the token, but because
`initialRouteName` is not reactive and nothing ever navigates to `Login`, the
navigation stack stays exactly where it was - inside the authenticated UI, now
with no session. The only escape is a cold start. This is the same class of
stranding that hits a user whose session is revoked server-side while the app is
running (`SessionProvider.tsx:69-74` nulls the token; the navigator does not react).

**Fix:** stop encoding auth state in `initialRouteName`. Render an explicit gate:

```tsx
{!isLoggedIn
  ? <Stack.Navigator><Stack.Screen name="Login" component={Login} /></Stack.Navigator>
  : <Stack.Navigator><Stack.Screen name="BottomTabNavigator" ... /></Stack.Navigator>}
```

and call `navigationRef.reset(...)` from inside `signOut`.
### R2 - [HIGH] CometChat session is created unawaited and races the Convex session; failure is swallowed

`src/components/login/Login.tsx:78-88`:

```tsx
const result = await loginMutation({ username: uid, password });
await signIn(result.token);
ensureCometChatSession(
  result.user.username,
  result.user.displayName,
).catch(() => {});                                   // <-- not awaited
navigate(SCREEN_CONSTANTS.BOTTOM_TAB_NAVIGATOR);
navigationRef.reset({ index: 0, routes: [{ name: SCREEN_CONSTANTS.BOTTOM_TAB_NAVIGATOR }] });
```

Navigation proceeds immediately, so the app renders `BottomTabNavigator` while the
CometChat session is still being established. `App.tsx:148-152` then fires
`ensureCometChatSession` a **second** time for the same `sessionUser`
(`Login.tsx:80` and `App.tsx:150` are the same call), producing two concurrent
`CometChatUIKit.login()` calls.

Worse, `src/auth/cometchatSession.ts:14-16` discards the user-creation failure:

```ts
await CometChatUIKit.createUser(
  new CometChat.User({ uid, name: displayName }),
).catch(() => {});          // user may never be created
await CometChatUIKit.login({ uid });
```

and `src/auth/cometchatSession.ts:20-22` swallows the resulting login error too.
Net effect: the user is fully "logged in" to Convex with **no** CometChat session,
`activeUid` stays `null`, and voice/video calls are silently dead - the log line
`"[CometChat] background session failed (calls unavailable)"` is the only signal.
`index.js:51-55` installs a global `unhandledRejection` handler that only
`console.log`s, so even an un-awaited rejection is invisible to the user.

**Fix:** `await ensureCometChatSession(...)` before navigating; drop the duplicate
call site in `App.tsx:148-152`; surface a "Calls unavailable" banner instead of
swallowing.

### R3 - [HIGH] The login error toast renders **behind** the keyboard on iOS

`src/components/login/Login.tsx:254-262` renders the toast as a *sibling* of
`<KeyboardAvoidingView>`, inside the full-height root `<View>`
(`Login.tsx:102-104`, `styles.container = { flex: 1 }` at `Login.tsx:269-272`),
positioned absolutely at `bottom: '8%'` (`Login.tsx:307-315`).

- **Android** survives: `android/app/src/main/AndroidManifest.xml:33`
  `android:windowSoftInputMode="adjustResize"` resizes the whole window, so
  `bottom: '8%'` resolves above the keyboard.
- **iOS has no `adjustResize`.** The window never resizes; `behavior='padding'`
  (`Login.tsx:41-43`) only pads the `KeyboardAvoidingView`, *not* its parent. The
  toast therefore anchors to the bottom of the full screen and is occluded by the
  keyboard.

The user submits with `returnKeyType="go"` / the Continue button - i.e. the
keyboard is always up - and the "Incorrect password. Try again." message is
invisible. This reads to the user as **the login silently failing.**

Same defect in `src/components/login/SignUp.tsx:313-321` (`styles.toastContainer`
`bottom: '8%'` at `SignUp.tsx:366-374`).

**Fix:** move the toast inside the `KeyboardAvoidingView`, or use
`useAnimatedKeyboard` + an `Animated` translate. Or, better, replace the toast with
inline error text under the inputs.
### R4 - [MEDIUM] Double-submit on the password field creates orphaned, never-expiring sessions

`src/components/login/Login.tsx:199` wires `onSubmitEditing={handleLogin}`. The
keyboard "Go" action is **not** gated by `isLoading`, and the in-handler guard
`if (!uid || !password || isLoading) return;` (`Login.tsx:73`) reads `isLoading`
from the render closure, not a ref. Two fast "Go" presses therefore issue two
`convex/auth.ts:117 login` mutations.

Each successful login calls `createSession` (`convex/auth.ts:58-71`), which
`ctx.db.insert`s a **new** row into `sessions`. The `sessions` table
(`convex/schema.ts:15-22`) has no TTL, so the orphaned token remains valid
**forever** and the user has no way to revoke it. The `TouchableOpacity` button
*is* correctly disabled (`Login.tsx:212`), so this is a keyboard-path-only bug -
and the same defect exists at `SignUp.tsx:260`.

**Fix:** `const inFlight = useRef(false)` checked and synchronously set at the top
of `handleLogin`, plus `blurOnSubmit` and `editable={!isLoading}` on the inputs.

### R5 - [MEDIUM] Login navigates twice; the second call is un-awaited

`src/components/login/Login.tsx:84-88` calls `navigate(...)` and then
`navigationRef.reset(...)` back-to-back. `navigate` is redundant. `reset` returns a
Promise that is neither awaited nor `.catch()`ed. If `navigationRef` is not ready,
`navigate` **queues** the intent (`src/navigation/NavigationService.ts:33`) and
`processPendingNavigation()` replays it on `onReady`
(`src/navigation/RootStackNavigator.tsx:76-78`) - on top of the already-reset
stack, so the hardware back button walks into a duplicate tab screen. If `reset`
rejects, `index.js:51-55` swallows it. Same pattern at `SignUp.tsx:110-114` and
`SampleUser.tsx:104-108`.

**Fix:** keep only the `reset`, and `await` it inside the `try` so a failure
surfaces in the existing `catch`.

## Security findings

### [CRITICAL] CometChat admin authKey + appId hardcoded in the shipped bundle

`src/utils/AppConstants.tsx:6-8`

```tsx
authKey: 'ee2fe34b0ca0817cdb650aa4f8b985fb07ed1245',
appId:   '1683794f9fd14c574',
region:  'IN',
```

A CometChat **authKey** is a bearer credential for the app's entire REST API -
create/update/delete users, groups and messages. Hardcoding it in `src/` ships it
inside every release APK/IPA; extracting it is a one-line `strings` on the bundle.
It is consumed at `App.tsx:118-129` and `AppCredentials.tsx:163-169`.

Compounding: `src/components/login/AppCredentials.tsx:159` does
`console.log('Saving credentials:', credentials)` - the auth key goes to logcat /
the device console in plaintext - and it is persisted unencrypted at
`AppCredentials.tsx:160` (`AsyncStorage.setItem('appCredentials', ...)`). The key
field `AppCredentials.tsx:374-387` is a plain `TextInput` with **no
`secureTextEntry`**, so it renders in cleartext on screen.

**Fix:** revoke and rotate this key immediately. Terminate CometChat traffic
through a Convex server-side proxy that holds the key. Remove
`authKey`/`appId` from `AppConstants.tsx`. Add `secureTextEntry` to the auth-key
input and delete the `console.log`.

### [CRITICAL] No brute-force protection anywhere on `login` or `register`

`convex/auth.ts:117` (`login`) and `convex/auth.ts:73` (`register`) are public
`mutation`s callable by anyone with the deployment URL. There is **no** rate
limiting, no per-IP throttle, no per-account attempt counter, no lockout, no CAPTCHA
and no backoff - and `convex/schema.ts` has no table in which such a counter could
live. The password floor is 6 characters (`convex/auth.ts:86`).

This is directly online-crackable, and the hash is weak (next finding).

**Fix:** add a `loginAttempts` table (`username`, `ip`, `count`, `lockedUntil`) with
an index; reject when locked; move hashing into a Convex `action` with a
per-account cooldown so the PBKDF2 cost cannot be amplified.
### [CRITICAL] Password hashing actually runs at 20,000 iterations, not 210,000

`convex/auth.ts:28-56`:

```ts
const WEB_CRYPTO_ITERATIONS = 210000;   // auth.ts:18
const FALLBACK_ITERATIONS    = 20000;    // auth.ts:19
...
const subtle = (globalThis as any).crypto?.subtle;   // auth.ts:30
if (subtle?.importKey && subtle?.deriveBits) { /* 210k WebCrypto path */ }
const derived = pbkdf2(sha256, password, salt, {     // auth.ts:51-54  <-- live path
  c: FALLBACK_ITERATIONS, dkLen: KEYLEN,
});
```

Convex's V8 runtime does not expose WebCrypto (`crypto.subtle`); only
`crypto.getRandomValues` is available. The code itself betrays this: it has to
hand-declare the runtime globals at `convex/auth.ts:8`
(`declare const TextEncoder`) and `convex/lib/helpers.ts:5-7`
(`declare const crypto: { getRandomValues(...) }`). So the 210k WebCrypto branch
at `auth.ts:31-50` is **dead code in production** and every password hash is
produced with **20,000** PBKDF2-HMAC-SHA256 iterations.

For reference, the OWASP Password Storage Cheat Sheet floor for PBKDF2-HMAC-SHA256
is 600,000 iterations. 20k is roughly 30x under.

**`@noble/hashes` is genuinely present and genuinely used** - `package.json:17`
declares `"@noble/hashes": "^2.4.0"` (resolved 2.4.0), imported at
`convex/auth.ts:3-4` as `pbkdf2` from `@noble/hashes/pbkdf2.js` and `sha256` from
`@noble/hashes/sha2.js`, and there is no `convex/package.json` so the Convex CLI
resolves server deps from the root manifest. **The library choice is correct; only
the work factor is wrong.** Prefer Argon2id, or at minimum 600k PBKDF2 with a
`version`/`algorithm` field so you can migrate.

### [HIGH] Non-constant-time password comparison

`convex/auth.ts:131-134`

```ts
const hash = await hashPassword(password, user.salt);
if (hash !== user.passwordHash) {
  throw new ConvexError("Incorrect password. Try again.");
}
```

JS string `!==` compares by code unit and short-circuits on the first difference,
making it a timing oracle on the digest.

**Fix:** hex-decode both to bytes and compare with a fixed-length XOR accumulator:

```ts
function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Uint8Array.from(hexToBytes(a));
  const bb = Uint8Array.from(hexToBytes(b));
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
```

### [HIGH] Session tokens have no TTL and no expiry of any kind

`convex/schema.ts:15-22`

```ts
sessions: defineTable({
  token: v.string(), userId: v.id("users"),
  createdAt: v.number(), lastSeenAt: v.number(),
}).index("by_token", ["token"]).index("by_user", ["userId"]),
```

No `expiresAt`. `convex/auth.ts:154-170` (`me`) and
`convex/lib/helpers.ts:13-19` (`requireUser`) check only that a row exists.
`convex/lib/helpers.ts:24-29` merely *touches* `lastSeenAt` every 30 s. Nothing
ever expires, sweeps or garbage-collects the table - `sessions` grows without bound.
A leaked token is valid forever, and it is a **bearer** credential: it is passed as
a plain string argument on every single call (`requireUser(ctx, token)`), so it
appears in Convex request bodies and in any proxy/analytics that logs them.

Token entropy itself is fine: `convex/lib/helpers.ts:43-49` uses 24 CSPRNG bytes =
192 bits.

**Fix:** add `expiresAt`, enforce it in `requireUser` and `me`, rotate on use
(refresh token), and add a scheduled sweep for dead sessions.

### [HIGH] Session token stored in plaintext AsyncStorage

`src/auth/SessionProvider.tsx:15` (`const TOKEN_KEY = "synomilo.convex.token"`) and
`src/auth/SessionProvider.tsx:77` (`AsyncStorage.setItem(TOKEN_KEY, nextToken)`).

AsyncStorage is an **unencrypted** SQLite DB on Android and an unencrypted backing
store on iOS. Mitigating factor:
`android/app/src/main/AndroidManifest.xml:21` sets `android:allowBackup="false"`, so
it is excluded from ADB/cloud backup. Still readable on a rooted/jailbroken device or
via any local file-read primitive.

**Fix:** `react-native-keychain` or `expo-secure-store` for the token; store only a
short-lived access token plus a rotating refresh token.

### [HIGH] Logout does not reliably invalidate the server-side token

`src/auth/SessionProvider.tsx:81-92`

```ts
const signOut = useCallback(async () => {
  const currentToken = token;
  if (currentToken) {
    logoutMutation({ token: currentToken }).catch(() => {});   // <-- NOT awaited
  }
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  setToken(null);
  ...
  await clearCometChatSession();
}, [token, logoutMutation]);
```

If the device is offline or the mutation fails, `convex/auth.ts:140-152` never runs,
the row survives in `sessions`, and - because there is no TTL - the token stays valid
forever. The local wipe proceeds regardless. Both call sites
(`src/components/convex/SettingsScreen.tsx:41`,
`src/components/convex/ProfileScreen.tsx:176`) fire-and-forget with
`.catch(() => {})` on top.

**Fix:** `await logoutMutation({ token })` before removing local state, with a retry
queue, and/or enforce a server-side session TTL as a backstop.
### [HIGH] `AppCredentials.tsx` - reachability and bundle exposure

The **route is correctly `__DEV__`-gated**: `src/navigation/RootStackNavigator.tsx:107-118`
wraps both `APP_CRED` and `SAMPLE_USER` screens in `{__DEV__ && (...)}`, so neither is
registered in a release build, and `initialRouteName` can never select them
(`RootStackNavigator.tsx:86-90`). **The auth key is not reachable through this screen
in release.**

But the component is **statically imported** at `RootStackNavigator.tsx:15`, so it is
still bundled into the release JS - and `App.tsx:118-119` reads the very same
`appCredentials` AsyncStorage key and falls back to the hardcoded
`AppConstants.authKey`. The secret ships either way. Two secondary issues:

- `src/components/login/AppCredentials.tsx:374-387` - the Auth Key `TextInput` has no
  `secureTextEntry`.
- `src/components/login/AppCredentials.tsx:174-179` calls `navigate('BottomTabNavigator')`
  (hardcoded string) and then resets to `SAMPLE_USER` - in a release build that route
  does not exist, so `reset` throws.

**Fix:** delete `AppCredentials.tsx` and `SampleUser.tsx` from the release graph
(gate the import too, e.g. `const AppCredentials = __DEV__ ? require(...) : null`), add
`secureTextEntry`, and remove the hardcoded `console.log` at line 159.

### [MEDIUM] Username enumeration + a fully public user directory

`convex/auth.ts:128-133` returns two distinguishable messages:

```ts
if (!user) throw new ConvexError("No account found with that username.");              // auth.ts:129
...
if (hash !== user.passwordHash) throw new ConvexError("Incorrect password. Try again."); // auth.ts:133
```

That is a username-enumeration oracle on an unthrottled endpoint (see the
`[CRITICAL]` brute-force finding). It is also redundant with `convex/users.ts:9-13`,
which `collect()`s **the entire `users` table** for any caller holding any valid token
and returns every other account's id, username, display name and avatar.

**Fix:** return a single generic error ("Invalid username or password") and
deliberately burn a comparable amount of CPU when the user does not exist.

### [MEDIUM] No password length ceiling -> PBKDF2 CPU-exhaustion DoS

`convex/auth.ts:76` and `convex/auth.ts:120` accept `v.string()` with no maximum.
`register` only enforces `password.length < 6` (`convex/auth.ts:86`). A multi-megabyte
password string is fed straight into `hashPassword` (`convex/auth.ts:103`, `:131`), so
each request costs a full 20k-iteration PBKDF2 *plus* the megabyte of HMAC setup.
With zero rate limiting this is a cheap, repeatable CPU-exhaustion vector against the
Convex deployment.

**Fix:** cap at 256 bytes (`v.bytes` or an explicit length check) and reject early
before hashing.

### [LOW] `cometchat_team_messanger.jks` committed to git - key recoverable

Tracked files (`git ls-files`):

- `cometchat_team_messanger.jks` (repo root, 2702 bytes)
- `android/app/cometchat_team_messanger.jks`
- `android/app/debug.keystore`

I decrypted the root keystore with the password **`cometchat`** - alias
`cometchat`, `PrivateKeyEntry` created 2024-10-16. This is the widely published
CometChat sample-app keystore.

**Impact is LOW, not high**, and I verified why: nothing references it.
`android/app/build.gradle:102-108` reads `keystoreProperties['storeFile']`, which
locally is `synomilo-release.keystore` (gitignored via `.gitignore:34`), and CI injects
a real keystore from GitHub Secrets
(`.github/workflows/android-release.yml:52-58`). `.gitignore:35` explicitly un-ignores
`debug.keystore` but nothing covers `*.jks`, which is why these were committed.

**Fix:** `git rm --cached` both `.jks` files, add `*.jks` / `*.p12` to `.gitignore`,
and rotate the key since it lives in git history.

### [LOW] `android/app/debug.keystore` committed

Standard React Native template behaviour, explicitly un-ignored at `.gitignore:35`;
password `android`, alias `androiddebugkey`, published. Only permits forging an update
to a **debug** install. Rotate if you care.

### [INFO] `android/keystore.properties` holds the real release password in plaintext

Local-only, **correctly gitignored** (`.gitignore:78`) and confirmed untracked
(`git check-ignore -v android/keystore.properties`). CI uses GitHub Secrets, not this
file. Acceptable; consider moving to an env var or OS keychain.

### [INFO] The JWK / signing-key story - there isn't one, and that is fine

There is **no JWT and no JWK anywhere** in this app. Auth is a hand-rolled opaque
bearer token:

- `convex/lib/helpers.ts:43-49` - `genToken()` = 24 CSPRNG bytes hex-encoded (192 bits).
- `convex/lib/helpers.ts:51-57` - `genSalt()` = 16 CSPRNG bytes hex (128 bits).
- `convex/auth.ts:58-71` - `createSession` persists the raw token in a DB row.

I checked every place a signing secret could hide:

| Checked | Result |
| --- | --- |
| `convex.json` | **Absent** (`Test-Path convex.json` -> False) |
| `convex.config.ts` | Absent |
| `convex/_generated/server.d.ts:30-33` | `Env` declares only `CONVEX_CLOUD_URL` + `CONVEX_SITE_URL` - no secret |
| `.env.local` | Present on disk but **gitignored** (`.gitignore:81`) and **untracked** (`git ls-files --error-unmatch .env.local` -> "did not match any file(s)") |
| `.env.local` contents | Only `CONVEX_DEPLOYMENT` / `CONVEX_URL` / `CONVEX_SITE_URL` - no secret |
| `google-services.json` | Present on disk, **gitignored** (`.gitignore:80`) and untracked; commit `f01025d` already scrubbed the leaked service-account key |
| `android/keystore.properties` | Gitignored + untracked |

**There is no private key in the repo and no hardcoded signing secret.** If
`globalThis.crypto` were ever missing in the runtime, `convex/lib/helpers.ts:45`
`crypto.getRandomValues(bytes)` would **throw** rather than silently degrade to
`Math.random` - fail-closed, which is the correct posture.
## Findings

1. **[CRITICAL]** Login is unreachable in debug and a one-way door in release - `RootStackNavigator.tsx:83-91`; no `navigate(SCREEN_CONSTANTS.LOGIN)` anywhere. See R1.
2. **[CRITICAL]** CometChat admin authKey/appId hardcoded - `AppConstants.tsx:6-8`, consumed at `App.tsx:118-129` and `AppCredentials.tsx:163-169`. Rotated key needed.
3. **[CRITICAL]** No rate limiting / lockout on `login` or `register` - `auth.ts:117`, `:73`; nothing in `schema.ts`.
4. **[CRITICAL]** Password hashing runs at **20,000** PBKDF2 iterations, not the 210,000 the code implies - `auth.ts:18-19`, `:31` (dead WebCrypto branch), `:51-54` (live path). `@noble/hashes@2.4.0` (`package.json:17`) *is* used correctly; only the work factor is wrong.
5. **[HIGH]** Non-constant-time comparison - `auth.ts:132`.
6. **[HIGH]** Session tokens never expire; no TTL field in `schema.ts:15-22`, no enforcement in `auth.ts:154-170` or `helpers.ts:13-19`, no GC of dead rows.
7. **[HIGH]** Token in plaintext AsyncStorage - `SessionProvider.tsx:15,77`. Mitigated by `AndroidManifest.xml:21 allowBackup="false"`.
8. **[HIGH]** Logout fire-and-forget -> token valid forever on failure - `SessionProvider.tsx:84`.
9. **[HIGH]** CometChat session race: un-awaited `ensureCometChatSession` at `Login.tsx:80-83` racing `App.tsx:150`; `createUser(...).catch(() => {})` at `cometchatSession.ts:14-16`; error swallowed at `:20-22`. See R2.
10. **[HIGH]** iOS-only: login error toast renders behind the keyboard - `Login.tsx:254-262` + `:307-315` vs `:41-43`. See R3.
11. **[MEDIUM]** Keyboard-path double-submit creates orphan sessions - `Login.tsx:199` vs the closure guard at `:73`.
12. **[MEDIUM]** `navigate()` + un-awaited `reset()` on login - `Login.tsx:84-88`; queue replay at `NavigationService.ts:33` + `RootStackNavigator.tsx:76-78`.
13. **[MEDIUM]** Username enumeration - `auth.ts:129` vs `:133`; full user directory at `users.ts:9-13`.
14. **[MEDIUM]** No password length cap -> PBKDF2 CPU-exhaustion - `auth.ts:76`, `:86`, `:120`.
15. **[MEDIUM]** `AuthContext` is dead **and** broken. `src/components/conversations/screens/Conversations.tsx:13,41` consumes `useContext(AuthContext)`, but **no `<AuthContext.Provider>` is mounted anywhere in the app** - so `setIsLoggedIn` is permanently the default no-op at `AuthContext.tsx:10`. Consequently `Conversations.tsx:147` `setLogout(false)` does nothing, and `Conversations.tsx:148-153` resets the stack to the literal route `'SampleUser'`, which **is not registered in release builds** (`RootStackNavigator.tsx:107-118`) - that logout button will throw on a release build. `App.tsx:92` computes `isLoggedIn` from `sessionUser` instead, so this whole module is vestigial.
16. **[MEDIUM]** Signup has no reconciliation for partial failure. `convex/auth.ts:104-113` inserts the Convex user and returns; the CometChat user is created **lazily and fire-and-forget** by `cometchatSession.ts:14-16`. If CometChat is down, the account exists in Convex but has no CometChat identity, and `createUser` is never retried (it is skipped once `activeUid === uid`, `cometchatSession.ts:10`). Fix: create the CometChat user in the signup path and surface a retry.
17. **[MEDIUM]** CometChat UID is the **mutable username**, not the immutable `_id`. `Login.tsx:81`, `SignUp.tsx:107` and `App.tsx:150` all pass `user.username`. But `convex/users.ts:49-64` lets a user change their username, and `cometchatSession.ts:14-16` will then `createUser` a brand-new CometChat identity under the new name - orphaning the old one along with its call history and contacts. Fix: key CometChat on an immutable identifier (e.g. the Convex `_id`).
18. **[MEDIUM]** `SampleUser.tsx:109-110` swallows CometChat login errors into `console.log` with no user-visible feedback; `SampleUser.tsx:162` (`showSkeleton = loadingUsers || users.length === 0`) combined with `Skeleton.tsx:111` returning `null` after its hardcoded 3s timer means a network failure yielding zero users leaves a **permanent skeleton**.
19. **[LOW]** `showToast` never clears its timer - `Login.tsx:66-69`, `SignUp.tsx:74-77`. Overlapping failures truncate later messages, and `setToastMessage` fires on an unmounted component after successful navigation.
20. **[LOW]** Whitespace-only passwords satisfy `isFormValid` - `Login.tsx:64` tests `password.length > 0` - and then fail server-side.
21. **[LOW]** No autofill hints and no password-visibility toggle on either credential form - `Login.tsx:157-200`, `SignUp.tsx:183-261`. No `textContentType="username"/"password"`, no `autoComplete`, no eye toggle, no `autoFocus`, no inline error text under the inputs.
22. **[LOW]** `App.tsx:469-478` shows a bare empty `<View>` (no spinner) during init and session restore.
23. **[LOW]** `Skeleton.tsx` has a hardcoded 3-second artificial delay (`:99-101`) and is reachable only from the `__DEV__`-gated `SampleUser` screen - dead weight in release bundles.

**Severity counts:** CRITICAL 4 - HIGH 6 - MEDIUM 7 - LOW 6 - INFO 2

## Auth flow trace

### Cold start (returning user, token on disk)

| # | System | What happens |
| --- | --- | --- |
| 1 | React Native | `index.js:57-63` mounts `AppErrorBoundary` -> `ActiveChatProvider` -> `App`; `index.js:18-34` registers FCM/notifee background handlers |
| 2 | Convex | `App.tsx:550` `ConvexProvider` with `src/convex/client.ts:4-7` (`skipConvexDeploymentUrlCheck: true` - no URL pinning) |
| 3 | Session | `App.tsx:552` `SessionProvider` mounts; `SessionProvider.tsx:48-65` reads `synomilo.convex.token` from AsyncStorage into `token`, sets `storedTokenLoaded` |
| 4 | Session | `SessionProvider.tsx:67` `useQuery(api.auth.me, token ? {token} : "skip")` -> `convex/auth.ts:154-170` looks up the `sessions` row, returns `publicUser(user)` or `null` |
| 5 | App | `App.tsx:469` renders **blank `<View>`** while `isInitializing \|\| sessionLoading`. `SessionProvider.tsx:95-96` keeps `isLoading` true until `storedTokenLoaded` **and** `me !== undefined` - **this correctly prevents a login-screen flash for an already-logged-in user.** |
| 6 | CometChat | `App.tsx:112-142` reads `appCredentials`, falls back to `AppConstants` (`AppConstants.tsx:6-8`), and `await CometChatUIKit.init(...)` |
| 7 | Session | If the token was revoked, `me` returns `null`; `SessionProvider.tsx:69-74` wipes AsyncStorage and sets `token = null`; `isLoading` becomes false |
| 8 | App | `isLoggedIn = !!sessionUser` (`App.tsx:92`) is now correct at navigator mount -> `RootStackNavigator.tsx:83-91` picks the right `initialRouteName` |
| 9 | CometChat | `App.tsx:148-152` -> `ensureCometChatSession(username, displayName)` -> `cometchatSession.ts:14-17` `createUser` (errors swallowed) then `CometChatUIKit.login({uid})` |
| 10 | FCM | `App.tsx:158-214` requests permission, writes the token via `setPushToken` (`users.ts:17-24`) |

**Verdict on the cold-start flash (Q7): correctly handled.** `App.tsx:469` +
`SessionProvider.tsx:95-96` gate rendering on Convex validation, so an
already-logged-in user never sees Login flash. The flash the prompt asks about does
not happen on cold start - it happens on **logout** (R1b), where the navigator is
already mounted and therefore immune to `initialRouteName`.

### Login

| # | System | What happens |
| --- | --- | --- |
| 1 | Login UI | User types; `Login.tsx:64` computes `isFormValid`; button enabled at `:212` |
| 2 | Login UI | `Login.tsx:71-76` guard + `setIsLoading(true)`. **Keyboard "Go" (`:199`) bypasses the button's `disabled`.** |
| 3 | Convex | `Login.tsx:78` -> `convex/auth.ts:117-138`: normalize, index lookup on `by_username`, `hashPassword`, `hash !== user.passwordHash` (non-constant-time) |
| 4 | Convex | `convex/auth.ts:135` -> `createSession` (`:58-71`) inserts a **new** `sessions` row with a fresh 192-bit token |
| 5 | Session | `Login.tsx:79` -> `SessionProvider.tsx:76-79` persists the token to **AsyncStorage** and sets state |
| 6 | CometChat | `Login.tsx:80-83` -> `cometchatSession.ts:14-17` `createUser` + `login` - **not awaited, error swallowed** |
| 7 | Navigation | `Login.tsx:84-88` `navigate()` **then** un-awaited `navigationRef.reset()` |
| 8 | App | `App.tsx:91-92` `sessionUser` resolves via `me`; `App.tsx:150` fires `ensureCometChatSession` a **second time** -> concurrent `CometChatUIKit.login` |
| 9 | FCM | `App.tsx:158-214` registers push; `users.ts:21` overwrites `users.pushToken` |

### Logout

| # | System | What happens |
| --- | --- | --- |
| 1 | UI | `SettingsScreen.tsx:34-45` or `ProfileScreen.tsx:174-177` - both `.catch(() => {})` |
| 2 | Convex | `SessionProvider.tsx:84` `logoutMutation({token})` **fire-and-forget**; on success `auth.ts:140-152` deletes the row; on failure the row survives forever |
| 3 | Session | `SessionProvider.tsx:86-87` AsyncStorage cleared, `token = null` |
| 4 | Push | `SessionProvider.tsx:88-90` `CometChatPushNotifications.unregister()` in a bare `catch {}` |
| 5 | CometChat | `SessionProvider.tsx:91` -> `clearCometChatSession()` -> `cometchatSession.ts:25-28` `activeUid = null` + `CometChatUIKit.logout()` (errors swallowed) |
| 6 | **Navigation** | **Nothing.** `isLoggedIn` flips to `false` (`App.tsx:92`), but `RootStackNavigator.tsx:83-91` `initialRouteName` is not reactive and nothing navigates to `Login`. The user is stranded inside the authenticated UI. **This is R1b.** |

**Answer to Q3 (does logout tear down CometChat?) - yes, it tries to, and it usually
succeeds.** `clearCometChatSession()` calls `CometChatUIKit.logout()`
(`cometchatSession.ts:27`) and the Convex token is revoked server-side when the
mutation lands. The two defects are (a) the revocation is un-awaited so it can be
silently lost offline, and (b) the user is never routed back to Login.
## Multi-device model

**Confirmed: a user can have multiple devices logged in, and the implementation is
accidental rather than designed.**

**How it works today**

- Each login inserts a *new* `sessions` row (`convex/auth.ts:64`) keyed by a fresh
  192-bit token (`convex/lib/helpers.ts:43-49`). Nothing reuses or caps sessions.
- `sessions` is indexed `by_token` and `by_user` (`convex/schema.ts:21-22`), so a
  multi-device lookup is *possible* - but nothing ever uses `by_user`.
- `signOut` deletes exactly one row, the one in hand (`SessionProvider.tsx:82-85`).
  There is **no** "log out everywhere", **no** device registry, **no** device
  label/model/created-at metadata, **no** session-count cap, and **no** way for a user
  to see or revoke their other sessions in the UI.
- `convex/auth.ts:140-152` is the only delete. No TTL, no sweep -> `sessions` grows
  monotonically forever.
- The CometChat UID is the **username** (`Login.tsx:81`, `App.tsx:150`,
  `SignUp.tsx:107`), so it *is* identical on every device - CometChat itself has no
  multi-session concept and simply re-issues a token for the same UID. But see the
  username-mutation hazard below.

**What breaks**

1. **Push token clobbering - the biggest one.** `convex/users.ts:17-24`
   `setPushToken` does `ctx.db.patch(me._id, { pushToken })` on a **single** column
   (`convex/schema.ts:11`). The last device to register wins. On a two-device setup,
   **only one device receives any pushes**; the other goes silent the moment the other
   one signs in. There is no `pushTokens` array and no device key. A user with a phone
   and a tablet silently loses notifications on one of them.
2. **No logout-everywhere.** A stolen or decommissioned device's token is valid
   forever (finding 6) and there is no way to revoke it - not even by the user, and
   not even by an admin, short of `ctx.db.delete` by hand.
3. **Rename splits the CometChat identity.** `convex/users.ts:49-64` permits changing
   `username`. Because the CometChat UID *is* the username, renaming causes
   `cometchatSession.ts:14-16` to `createUser` a brand-new CometChat account under the
   new UID, orphaning the old one and its call history/contacts. Convex-side data
   survives (keyed on `_id`); CometChat-side identity does not.
4. **Orphaned sessions from double-submit.** R4's double "Go" leaves an extra
   un-revocable row per occurrence, compounding with every multi-device login.
5. **`lastSeenAt` is global, not per-device.** `convex/lib/helpers.ts:24-29` patches the
   session row of whichever token made the call - so with N devices the field reflects
   "last activity on any device", which is useless for per-device audit.
6. **`by_user` is dead index weight** - a write-amplifying index that no query reads.

**Fix direction**

Add a `devices` table (`userId`, `tokenHash`, `deviceId`, `label`, `platform`,
`pushToken`, `createdAt`, `lastSeenAt`). Store only a **hash** of the token, never the
token itself. Give `users` a `pushTokens: v.array(v.string())` keyed by device so
registration is additive. Add `expiresAt` plus a scheduled sweep. Add a "Sign out of
all other devices" mutation and an "Active sessions" settings screen.