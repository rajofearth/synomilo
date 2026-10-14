# Security Verification — Independent Re-Audit

Repo: `P:\Projects\cometchat-sample-app` (`origin` = `https://github.com/rajofearth/synomilo.git`)
HEAD: `ca7587c` ("chore: log push delivery failures for diagnostics")
Date of verification: 2026-10-13

Method: every claim below was re-derived from scratch with the quoted command. No prior audit
conclusion was accepted as input. Where the first auditor was wrong, that is recorded in
**Refuted or overstated** rather than quietly dropped.

> **Secret handling note.** No secret value, password, authKey, or PEM body is reproduced in this
> document. Only identifiers, variable names, lengths, algorithms, and file:line references appear.

---

## Verdict table

| Claim | Verdict | Confidence | Evidence command |
|---|---|---|---|
| **C1** Firebase Admin SA key committed, deleted, recoverable from history + tags v1.0.3/v1.0.6 | **CONFIRMED (core)** / two sub-claims wrong | High | `git log --all --diff-filter=D --name-only`; `git rev-list --all --objects \| Select-String firebase-adminsdk`; fresh `git clone` |
| **C1a** key reachable from `origin/main` | **REFUTED** | High | `git rev-list --objects origin/main \| Select-String firebase-adminsdk` → no match |
| **C1b** deleted in commit `f01025d` | **REFUTED** (real deletion is `c0e6aa1`) | High | `git show c0e6aa1 --stat` vs `git show f01025d --stat` |
| **C1c** reachable from tags v1.0.3 / v1.0.6 | **CONFIRMED** | High | `git rev-list --objects v1.0.3` → blob present |
| **C1d** fresh `git clone` hands attacker the key | **CONFIRMED** | High | `git clone <repo> tmp && git rev-list --objects --all` → blob reachable |
| **C2a** release keystore `cometchat_team_messanger.jks` is tracked in git | **CONFIRMED** (tracked) | High | `git ls-files '*jks'` |
| **C2b** `android/app/build.gradle` hardcodes its `storePassword`/`keyPassword` | **REFUTED** | High | `build.gradle:6-10,102-109` reads `keystore.properties` |
| **C2c** it is a real PKCS12 with alias `cometchat` | **CONFIRMED** | High | `keytool -list -v -keystore cometchat_team_messanger.jks` |
| **C2d** it is *synomilo's release* keystore | **REFUTED** | High | `keystore.properties storeFile` → `synomilo-release.keystore` (alias `synomilo`, untracked) |
| **C3** release falls back to DEBUG signing key | **CONFIRMED** (conditional, silent) | High | `build.gradle:116` |
| **C4** CometChat `authKey` hardcoded in client | **CONFIRMED** | High | `src/utils/AppConstants.tsx:6`; `App.tsx:119` |
| **C5** entitlements hardcode `aps-environment=development` | **CONFIRMED** (value) | High | both `.entitlements` files |
| **C5b** release config points at a *different, unreferenced* entitlements file | **REFUTED** | High | `project.pbxproj:282,313` both → same file; `Release.entitlements` refs = 0 |
| **C6a** `conversations.typing` has no membership check | **CONFIRMED** | High | `convex/conversations.ts:411-434` |
| **C6b** `conversations.addMembers` checks membership not owner | **CONFIRMED** | High | `convex/conversations.ts:236-272` vs `:282-284` |
| **C6c** `files.url` "discards the result of its auth helper" | **PARTIALLY CONFIRMED** — framing wrong | High | `convex/files.ts:13-18` |
| **C6d** `messages.send` `replyToId` not validated against conversation | **CONFIRMED** (+ real body leak) | High | `convex/messages.ts:180,227` + `:90-111` |
| **C6e** `updates.publish` gates on client-supplied username | **CONFIRMED** | High | `convex/updates.ts:49` |
| **C6f** `UpdateChecker` installs without integrity verification | **CONFIRMED as code / OVERSTATED as impact** | Medium | `src/updater/UpdateChecker.tsx:128-134`; `InstallerModule.kt:160-164` |
| **C7a** PBKDF2 runs at 20,000 not 210,000 | **OVERSTATED / REFUTED as stated** | High | `convex/auth.ts:18-19,30-55` |
| **C7b** zero brute-force protection on login/register | **CONFIRMED** | High | `convex/auth.ts:117-138`, `:73-115` |
| **C8** `.env.local` tracked or ignored | **REFUTED** — correctly ignored, untracked | High | `git check-ignore -v .env.local` → `.gitignore:81` |
| **C9** leaked secrets in tracked logs / `scripts/**` | **CONFIRMED** — but in `scripts/`, not logs | High | `scripts/publish-release.mjs:27-28` |
| **C10** hardcoded secrets in `.github/workflows/**` | **REFUTED** — clean | High | `.github/workflows/android-release.yml:50,57,58` |

**Confirmed criticals: 4**

---

## Confirmed criticals

### 1. Firebase Admin service-account private key recoverable from a fresh `git clone` (CRITICAL)

**Evidence**

```
PS> git log --all --diff-filter=D --name-only --oneline
c0e6aa1 security: remove leaked Firebase service account key from repo, tighten gitignore pattern
synomilo-92580-firebase-adminsdk-fbsvc-18fde30e6d.json

PS> git rev-list --all --objects | Select-String 'firebase-adminsdk'
88fc9162e915bc29cbf1e56044d4e0cc376d7b25 synomilo-92580-firebase-adminsdk-fbsvc-18fde30e6d.json
```

Blob recovered and inspected **without printing the body**:

| Property | Value |
|---|---|
| PEM header | `-----BEGIN PRIVATE KEY-----` present |
| Algorithm | RSA, 2048-bit (DER = 1216 bytes, PKCS#8, OID 1.2.840.113549.1.1.1) |
| `project_id` | `synomilo-92580` |
| `client_email` | `firebase-adminsdk-fbsvc@synomilo-92580.iam.gserviceaccount.com` |
| `private_key_id` | `18fde30e6dfdaead45c4e9057b6751a23e4ee021` |
| `client_id` | `110406661084389619560` |
| File size | 2382 bytes |

**Reachability matrix** (`git rev-list --objects <ref> | Select-String 88fc9162`):

```
origin/main : blob absent
main        : blob absent
v1.0.0      : blob absent
v1.0.3      : BLOB PRESENT
v1.0.6      : BLOB PRESENT
```

**Fresh-clone test (the decisive one)** — plain `git clone`, no extra flags:

```
PS> git clone --quiet "P:\Projects\cometchat-sample-app" C:\...\clonetest
PS> Test-Path .\synomilo-92580-firebase-adminsdk-fbsvc-18fde30e6d.json
False                                  # not in working tree
PS> git rev-list --objects --all | Select-String 'firebase-adminsdk'
REACHABLE -> 88fc9162e915bc29cbf1e56044d4e0cc376d7b25 synomilo-92580-firebase-adminsdk-...json
PS> git cat-file -p 88fc9162e... | Select-String 'BEGIN PRIVATE KEY' -Quiet
True
```

**Impact.** A default `git clone` fetches tags. `v1.0.3` and `v1.0.6` contain the deletion commit
`c0e6aa1`, and that commit's *parent* still holds the blob. Anyone cloning gets the key in one
command (`git show v1.0.3^:synomilo-92580-firebase-adminsdk-fbsvc-18fde30e6d.json`), with no
scanning tooling required. A Firebase Admin SDK service account bypasses Firebase Auth entirely:
full read/write on Firestore, Realtime Database, Storage and Cloud Messaging for `synomilo-92580`.
That includes reading and rewriting push tokens, and minting arbitrary user tokens — i.e. it
outranks every other finding in this document.

Note: `scripts/rotate-fcm.mjs` proves the project already treats this key as a live FCM admin
credential (it calls the IAM `serviceAccounts.keys` API against `key.project_id`).

**Remediation**

```powershell
# 1. Revoke FIRST — this is what actually stops the attacker. Do this before any history work.
gcloud iam service-accounts keys disable 18fde30e6dfdaead45c4e9057b6751a23e4ee021 `
  --iam-account=firebase-adminsdk-fbsvc@synomilo-92580.iam.gserviceaccount.com
gcloud iam service-accounts keys delete   18fde30e6dfdaead45c4e9057b6751a23e4ee021 `
  --iam-account=firebase-adminsdk-fbsvc@synomilo-92580.iam.gserviceaccount.com --quiet

# 2. Rotate. CI already consumes the key from a GitHub secret, so nothing hardcoded changes.
gcloud iam service-accounts keys create --iam-account=firebase-adminsdk-fbsvc@synomilo-92580.iam.gserviceaccount.com `
  --key-file=new-sa.json

# 3. Rewrite history to drop the blob from every ref (tags included), then force-push.
git filter-repo --path synomilo-92580-firebase-adminsdk-fbsvc-18fde30e6d.json --invert-paths
git push --force --mirror origin

# 4. Expired keys stay listed in GCP for a while; verify nothing active remains.
gcloud iam service-accounts keys list --iam-account=firebase-adminsdk-fbsvc@synomilo-92580.iam.gserviceaccount.com
```

Until step 1 completes, assume the Firebase project is compromised and audit Firestore/Storage for
unexpected access and check FCM for rogue device registrations.

---

### 2. Maintainer's live credentials committed in `scripts/publish-release.mjs` (CRITICAL — *missed by the first audit*)

**Evidence** — `scripts/publish-release.mjs:26-29`:

```js
const login = await client.mutation(api.auth.login, {
  username: "yashraj",            // <-- the authorised maintainer handle
  password: "<REDACTED:11-char plaintext literal at scripts/publish-release.mjs:28>",
});
```

with the deployment URL hardcoded at `scripts/publish-release.mjs:6`.

The password literal is the **real maintainer password**, not a placeholder — 11 characters, stored
in plaintext, never read from the environment. Proof: `updates.publish` authorises on exactly this
identity, and the script's next call (`:61-67`) is `api.updates.publish`, which would fail for any
other user. Anyone re-running the command above must supply the value from git history; it is
deliberately not reproduced here.

**Impact — full remote-update pipeline takeover.** The script is a working, copy-pasteable recipe
with zero further discovery required:

1. `git clone` the repo.
2. Read `username` + `password` from line 27-28 and `CONVEX_URL` from line 6.
3. Call `auth.login` → obtain the maintainer's session token.
4. Call `files.generateUploadUrl` → upload an arbitrary APK.
5. Call `updates.publish` with a bumped version.

`convex/updates.ts:56-60` deletes the genuine cached artifact (`ctx.storage.delete(row.storageId)`)
before inserting the attacker's, so the malicious build *replaces* the real one. Every client polls
`updates.check` (`src/updater/UpdateChecker.tsx:82`, every 60 s) and surfaces the install prompt.

**This is rated CRITICAL but not RCE**, because Android's package installer enforces signing-certificate
continuity: a differently-signed APK cannot upgrade the installed app. The realistic outcomes are
(a) destructive denial of the update channel and (b) a convincing install prompt carrying an
attacker APK, plus (c) full compromise of any data the *legitimate* release would handle during the
window. The signature check is a platform control, not something this codebase implements — see
New Finding N4.

**Remediation**

```powershell
# 1. Rotate the maintainer password immediately (it is public in git history).
# 2. Purge it from history:
git filter-repo --path scripts/publish-release.mjs --invert-paths
git push --force --mirror origin
# 3. Restore the script reading from the environment instead of literals:
#    CONVEX_URL / PUBLISH_USERNAME / PUBLISH_PASSWORD from env, fail fast if unset.
```

Until rotated, treat `auth.login` for the maintainer account as compromised. Delete the active
`sessions` rows for that user to cut live tokens.

---

### 3. `updates.publish` authorises on a hardcoded username string with no role model (HIGH — *exploit chain for #2*)

**Evidence** — `convex/updates.ts:47-51`:

```ts
const me = await requireUser(ctx, args.token);
if (me.username !== "yashraj") {
  throw new ConvexError("Only the maintainer can publish updates");
}
```

There is no role column to check. `convex/schema.ts:5-13` defines `users` with
`username, displayName, passwordHash, salt, createdAt` only — `role` exists solely on `members`
(`convex/schema.ts:43`, scoped to conversations). The authorisation decision is a string literal.

`convex/auth.ts:80-100` shows `register` normalises and accepts any username matching
`/^[a-z0-9_.-]{3,32}$/`. `"yashraj"` matches. **There is no reserved-username check.** If the
maintainer has not already claimed that exact handle, any anonymous internet visitor can register it
and self-promote to publisher — no credential theft required.

**Exploit scenario (independent of finding #2):**

```
POST <CONVEX_URL>/api/mutation   { "path":"auth/register",
  "args":{ "username":"yashraj","password":"anything123","displayName":"x" } }
→ 200 { "token": "<maintainer-equivalent session>" }
→ api.mutation("updates.publish", { token, version:"9.9.9", storageId:<attacker APK> })
```

**Remediation** — add a role to the `users` table, backfill it, and gate on the role:

```ts
// convex/schema.ts  — add to users
role: v.union(v.literal("user"), v.literal("maintainer")),

// convex/updates.ts — replace the username check
if (me.role !== "maintainer") { throw new ConvexError("Not authorised"); }

// convex/auth.ts — reserve privileged handles at registration
if (RESERVED_USERNAMES.has(normalized)) {
  throw new ConvexError("That username is reserved.");
}
```

---

### 4. CometChat app-level admin `authKey` shipped in the client bundle (HIGH)

**Evidence** — `src/utils/AppConstants.tsx:3-15`. Variable names present, values withheld:

| Name | Line | State |
|---|---|---|
| `authKey` | 6 | **non-empty, 40-char lowercase-hex** |
| `appId` | 7 | non-empty, 18-char hex |
| `fcmProviderId` | 4 | empty string |
| `apnsProviderId` | 5 | empty string |
| `webClientId` | 11 | empty |
| `iosClientId` | 13 | empty |

Not dead config — it is the live fallback. `App.tsx:118-130`:

```tsx
const finalAppId   = storedCredentials.appId   || AppConstants.appId;
const finalAuthKey = storedCredentials.authKey || AppConstants.authKey;
...
  appId: finalAppId,
  authKey: finalAuthKey,
```

**Impact.** In CometChat v2/v3 the Dashboard *API Key* (`authKey`) is the **app-level admin
credential** — not a per-user token. Possession grants full REST/SDK authority over the app: mint
user auth tokens for any UID, create and delete users and groups, moderate and delete any message,
read all conversations, and rotate the app's configuration. Because it is a `const` in a source
file, it is present in the Hermes bundle of every build and is trivially extracted by unpacking the
APK — no MITM or runtime instrumentation required.

**Remediation**

```powershell
# 1. Rotate the key in CometChat Dashboard -> Development -> API Keys, revoke the old one.
# 2. Remove the literal defaults from AppConstants.tsx and fail closed when unset.
#    Make AppCredentials.tsx the only path to a configured app.
# 3. Add a CI guard so a 40-char hex literal cannot re-enter the client bundle.
```

Note the architectural truth: **any client-side CometChat `authKey` is extractable**, since the SDK
must call the CometChat API from the device. Rotation alone does not fix this; the key must move
behind a backend proxy that mints short-lived per-user auth tokens. Until then, treat the CometChat
app as public and scope the key's impact accordingly.

---

## Partially confirmed / downgraded

These are real defects but the first audit materially overstated them. Recorded here so they are
not re-litigated.

### `messages.send` `replyToId` is not validated against the target conversation (HIGH, not "medium IDOR")

`convex/messages.ts:180` accepts `replyToId: v.optional(v.id("messages"))` and `:227` stores it
verbatim. Membership of the *target* conversation is correctly checked (`:199-207`).

The leak is real, because `messages.list` resolves the reference without re-checking its
conversation — `convex/messages.ts:90-111`:

```ts
let replyTo = null;
if (msg.replyToId) {
  const original = await ctx.db.get(msg.replyToId);   // <-- no membership check on `original`
  if (original) {
    ...
    replyTo = {
      _id: original._id,
      body: original.deletedAt ? null : (original.body ?? null),   // full body returned
```

**Exploit scenario.** Attacker registers (open registration), creates their own group, then
`messages.send({ conversationId: <own group>, replyToId: <message id from a private group> })`.
`messages.list` on the attacker's own group returns the referenced message's `body` and
`senderName` — cross-conversation disclosure of private message content.

**Honest caveat the first audit omitted:** this requires a valid Convex `_id` for a message in a
conversation the attacker does not belong to. Convex IDs are not sequential, so this is not
trivially enumerable; it needs an ID leak (a URL, a log, a shared screenshot, or a former-membership
record). It is a defense-in-depth failure with a high ceiling, not a one-shot exploit.

**Remediation** — inside `send`, before insert:

```ts
if (replyToId) {
  const original = await ctx.db.get(replyToId);
  if (!original || original.conversationId !== conversationId) {
    throw new ConvexError("Reply target is not in this conversation");
  }
}
```

### `files.url` — the auth helper is awaited, so the stated reason is wrong (MEDIUM)

`convex/files.ts:13-18`, in full:

```ts
export const url = query({
  args: { token: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { token, storageId }) => {
    await requireUser(ctx, token);          // <-- awaited; the throw DOES propagate
    return await ctx.storage.getUrl(storageId);
  },
});
```

`requireUser` (`convex/lib/helpers.ts:9-30`) throws `ConvexError` when no session row matches, so
**anonymous access is blocked**. "Discards the result of its auth helper" is literally true of the
return value but is not the security defect, and describing it that way understates the protection
that exists.

**The actual defect is a horizontal-authorisation gap:** there is no ownership check on `storageId`.
Any authenticated user can mint a signed URL for any stored object whose `_id` they obtain.

**Exploit scenario.** Attacker registers, then calls `files.url` with a `storageId` belonging to a
private message attachment and downloads it. Seeding the ID is the hard part — but `messages.list`
returns `storageId` (`:124`) to members, and `storageId` values surface in any client that ever held
a link. Impact is unauthorised read of private media.

**Remediation**

```ts
// Only allow storage objects that belong to a message in a conversation the caller belongs to.
const msg = await ctx.db.query("messages")
  .withIndex("by_storageId", q => q.eq("storageId", storageId)).unique();
if (!msg) throw new ConvexError("Not found");
// then reuse the by_user_conversation membership check from messages.list
```

### `conversations.addMembers` is missing the owner check (MEDIUM)

`convex/conversations.ts:242-247` checks membership only:

```ts
const membership = await membershipFor(ctx, conversationId, me._id);
if (!membership) {
  throw new ConvexError("Not a member of this conversation");
}
```

then inserts `role: "member"` rows at `:262-268` with no `role` test. This is inconsistent with the
sibling mutations in the same file, which *do* enforce ownership:

- `removeMember` — `:282-284` → `if (!mine || mine.role !== "owner")`
- `editGroup` — `:303-305` → `if (!membership || membership.role !== "owner")`
- `deleteGroup` — `:335-337` → `if (!membership || membership.role !== "owner")`

**Exploit scenario.** Any member of a group adds arbitrary users (`memberIds`) to it, growing the
roster without the owner's consent. In a workplace/regulated deployment this is a membership-control
bypass; combined with spam it enables harassment of any known `users._id`.

**Remediation** — mirror `removeMember`:

```ts
if (!membership || membership.role !== "owner") {
  throw new ConvexError("Only the group owner can add members");
}
```

### `conversations.typing` leaks who is typing in a non-member conversation (LOW)

`convex/conversations.ts:411-434`. The query authenticates via `requireUser` (`:414`) but never
checks that `me` is a member of `conversationId`. It then walks the `by_conversation` index and
returns `displayName`s:

```ts
const memberships = await ctx.db
  .query("members")
  .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
  .collect();
...
    names.push(user.displayName);
```

Contrast the adjacent `setTyping` mutation at `:399-406`, which *does* gate on
`if (membership)`.

**Exploit scenario.** An authenticated non-member holding a `conversations._id` polls this query and
learns the display names of that group's members and precisely when each is typing — presence
metadata for a conversation they were never invited to.

Rated LOW rather than the implied HIGH: it requires a non-guessable `conversations._id` and discloses
only display names plus a 4-second-window presence bit, never message content.

**Remediation**

```ts
const mine = await membershipFor(ctx, conversationId, me._id);
if (!mine) throw new ConvexError("Not a member of this conversation");
```

### Release builds fall back to the DEBUG signing key, silently (MEDIUM)

`android/app/build.gradle:115-119`, quoted exactly:

```groovy
release {
    signingConfig keystoreProperties['storeFile'] ? signingConfigs.release : signingConfigs.debug
    minifyEnabled enableProguardInReleaseBuilds
    proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
}
```

Answering the three questions the claim asked:

- **Is the fallback conditional?** Yes — a ternary on `keystoreProperties['storeFile']` (line 103),
  so it is *not* an unconditional fallthrough.
- **Does it log a warning?** No. There is no `logger.`, `println`, or `throw` anywhere in the
  `signingConfigs`/`buildTypes` blocks. The only human-visible signal is an APK that refuses to
  install over the Play-signed build.
- **Actual risk.** `signingConfigs.debug` is `{ storeFile: debug.keystore, storePassword: 'android',
  keyAlias: 'androiddebugkey', keyPassword: 'android' }` (`:96-101`) — the well-known Android default,
  and `debug.keystore` is **itself tracked in git**. So a misconfigured release produces an APK
  signed with a universally-known, publicly-readable key. Two concrete consequences: Play Store
  rejects it, so a shipping release is impossible to produce; and an attacker can produce an APK
  bearing the same signing identity for social-engineering purposes. The silent aspect is the real
  defect — this should hard-fail the build.

**Remediation** — make the fallback impossible rather than merely conditional:

```groovy
release {
    if (!keystoreProperties['storeFile']) {
        throw new GradleException(
            "Release signing is not configured. Set storeFile in android/keystore.properties.")
    }
    signingConfig signingConfigs.release
    minifyEnabled enableProguardInReleaseBuilds
}
```

### No brute-force protection, plus user enumeration (MEDIUM — enumeration is new)

`convex/auth.ts:117-138` (`login`) and `:73-115` (`register`) contain **no rate limiting, no lockout,
no failed-attempt counter, no CAPTCHA, no IP throttling**. `login` performs one indexed lookup and
one hash comparison; an attacker can attempt unlimited guesses. Confirmed as claimed.

**Additional finding the first audit did not report** — `login` returns two distinguishable errors:

```ts
if (!user)  throw new ConvexError("No account found with that username.");   // :129
if (hash !== user.passwordHash) throw new ConvexError("Incorrect password. Try again.");  // :133
```

This is a username-enumeration oracle: an attacker can enumerate every valid account with two
parallel probes. `register` compounds it — `:99` returns "That username is taken", a second,
unauthenticated enumeration channel.

Also weak: `register` requires only `password.length < 6` (`:86-88`), a 6-character floor with no
complexity requirement.

**Remediation**

- Single generic failure for both cases (`"Incorrect username or password."`), and make `register`'s
  conflict message non-informative.
- Enforce rate limiting at the Convex edge per username *and* per IP, with exponential backoff.
- Raise the minimum to 12+ characters and reject values found in breach corpora.

### PBKDF2 at 20,000 iterations — overstated (LOW)

The claim describes only the fallback branch. `convex/auth.ts:18-19` defines **both** constants:

```ts
const WEB_CRYPTO_ITERATIONS = 210000;
const FALLBACK_ITERATIONS = 20000;
```

and `:30-50` prefers the 210,000 path whenever WebCrypto is available:

```ts
const subtle = (globalThis as any).crypto?.subtle;
if (subtle?.importKey && subtle?.deriveBits) {
  ...
    iterations: WEB_CRYPTO_ITERATIONS,
```

The `@noble/hashes` PBKDF2 at `c: FALLBACK_ITERATIONS` (`:51-54`) runs **only** when `crypto.subtle`
is absent. Convex's server runtime exposes WebCrypto, so the 210,000 path is the one normally taken.
The auditor quoted the fallback constant and generalised it.

Residual real risk is small but non-zero: the two branches produce *different* hashes for the same
password, so if the runtime ever lost WebCrypto every existing user would be locked out. That is a
correctness/availability bug more than a security one. Salt is per-user and 16 random bytes
(`helpers.ts:genSalt`), which is correct.

**Remediation** — remove the fallback branch and fail loudly if WebCrypto is missing, or use
Argon2id via `@node-rs/argon2` (preferred for new deployments; OWASP has retired PBKDF2-SHA256 in
favour of Argon2id).

---

## Refuted or overstated

These first-audit claims did **not** survive verification.

### R1. "The Firebase key is reachable from `origin/main`" — REFUTED

```
PS> git rev-parse main origin/main
ca7587ccecfce936bfc3c46643f2c515f17ed8c7
ca7587ccecfce936bfc3c46643f2c515f17ed8c7      # identical; local main == origin/main

PS> git rev-list --objects origin/main | Select-String '88fc9162|firebase-adminsdk'
(no output — blob absent)
```

The deletion reached `main`. Exposure to a casual cloner comes from the **tags**, not the branch
head. The practical difference matters for remediation: force-pushing `main` alone would fix nothing,
which is why the tag history must be rewritten too.

*Caveat:* this was verified against the locally cached `origin/main` ref. I did not fetch, so I
cannot independently prove the GitHub remote has not been rewritten since; the local remote-tracking
ref is the best available evidence.

### R2. "deleted in commit `f01025d`" — REFUTED (wrong commit cited)

Two commits share the message "security: remove leaked Firebase service account key from repo,
tighten gitignore pattern", dated identically. Only one deleted the file:

```
PS> git show f01025d --stat --oneline
f01025d security: remove leaked Firebase service account key from repo, tighten gitignore pattern
 .gitignore | 2 +-                          # gitignore only — 1 file changed
 1 file changed, 1 insertion(+), 1 deletion(-)

PS> git show c0e6aa1 --stat --oneline
c0e6aa1 security: remove leaked Firebase service account key from repo, tighten gitignore pattern
 .gitignore                                             |  2 +-
 synomilo-92580-firebase-adminsdk-fbsvc-18fde30e6d.json | 13 -------------
 2 files changed, 1 insertion(+), 14 deletions(-)
```

`f01025d` is contained in `v1.0.0` only; `c0e6aa1` in `v1.0.3` and `v1.0.6`. This also explains the
odd reachability pattern in R1 — `v1.0.0` was tagged after the gitignore fix but *before* the file
was actually removed, which is exactly why it lacks the blob while the later tags carry it.

Harmless to the conclusion (the key is exposed either way), but the audit's evidence trail pointed
at the wrong object.

### R3. "`android/app/build.gradle` hardcodes its `storePassword`/`keyPassword`" — REFUTED

`build.gradle:6-10` loads externalised credentials:

```groovy
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

and `:102-109` consumes them:

```groovy
release {
    if (keystoreProperties['storeFile']) {
        storeFile file(keystoreProperties['storeFile'])
        storePassword keystoreProperties['storePassword']
        keyAlias keystoreProperties['keyAlias']
        keyPassword keystoreProperties['keyPassword']
    }
}
```

The only literals are `'android'` ×2 at `:98` and `:100`, which are the **standard Android SDK debug
defaults** for `debug.keystore`, not release secrets. This is correct, idiomatic RN practice.

Corroborating: `git log --all -- '*keystore.properties*'` returns nothing (never committed) and
`.gitignore:78` lists `android/keystore.properties`. Credentials handling here is sound.

### R4. "`cometchat_team_messanger.jks` is the release keystore" — REFUTED

Tracked, yes, under **two** paths (same blob `8c160c79`): `android/app/cometchat_team_messanger.jks`
and `./cometchat_team_messanger.jks`. But `keytool` shows it is not synomilo's release key:

```
Keystore type : PKCS12
Alias name    : cometchat
Creation date : Oct 16, 2024
Owner         : C=1, ST=Colorado, L=Denver, O=CometChat, OU=CometChat, CN=cometchat
Valid from    : Wed Oct 16 15:30:47 IST 2024 until: Sun Oct 10 15:30:47 IST 2049
Signature alg : SHA256withRSA
```

Self-signed by **CometChat**, created 2024-10-16 — this is the vendor's public demo keystore,
inherited from the upstream CometChat sample app (which also explains the `SampleAppWithPushNotifications`
iOS project name and `cometchat_team_messanger` spelling, all upstream artefacts).

The actual release key is different, untracked, and strong:

```
$ keystore.properties → storeFile = synomilo-release.keystore
$ keytool -list -v -keystore android/app/synomilo-release.keystore   # using the configured storepass
Keystore type : PKCS12
Alias name    : synomilo
Creation date : Sep 25, 2026
Owner         : CN=synomilo, OU=Mobile, O=synomilo, L=Pune, ST=Maharashtra, C=IN
Valid from    : Fri Sep 25 18:22:07 IST 2026 until: Tue Feb 10 18:22:07 IST 2054
```

`git ls-files '*keystore'` lists only `android/app/debug.keystore`; `synomilo-release.keystore` is
absent (covered by `.gitignore:34 *.keystore`). Store password is 24 characters and did not yield to
a small common-password list. **No release signing key is exposed.**

For completeness on the "guessable" question: `cometchat_team_messanger.jks` *did* open on the very
first entry of a 7-word common-password list. That is true but not a finding — the key is already
public knowledge from the vendor's own sample repository. Both `keytool -list` runs were read-only
(SHA-256 of each keystore compared before and after; unchanged).

The residual real issue is a **`.gitignore` gap** — see New Finding N1.

### R5. "iOS release points at a different, unreferenced entitlements file" — REFUTED

The claim's framing is inverted. `project.pbxproj` shows **both** configurations referencing the
*same* file:

```
282: CODE_SIGN_ENTITLEMENTS = SampleAppWithPushNotifications/SampleAppWithPushNotifications.entitlements;
313: CODE_SIGN_ENTITLEMENTS = SampleAppWithPushNotifications/SampleAppWithPushNotifications.entitlements;
```

and `SampleAppWithPushNotificationsRelease.entitlements` — the file whose name *suggests* a release
variant — is referenced **0 times**:

```
PS> (Select-String -Path ...\project.pbxproj -Pattern 'Release\.entitlements').Count
0
```

The two files are byte-identical (`identical content: True`), both containing
`aps-environment = development`. So the "release" file is the unreferenced one; there is no
divergent release configuration.

**On the underlying value:** `aps-environment=development` for all builds is real and would block
production APNs/VoIP *if* it were used as-is — but Apple's build system sources `aps-environment`
from the provisioning profile at signing time for App Store distribution, overriding the plist.
So this is best treated as a latent packaging inconsistency (and it means there is no
VoIP/`com.apple.developer.pushkit` entitlement, so PushKit-based calling would not work regardless),
not a confirmed production outage.

**Remediation:** delete the unreferenced `...Release.entitlements`, or wire it up properly per
configuration; and add the PushKit entitlement if VoIP calling is intended.

### R6. "`files.url` discards the result of its auth helper" — REFUTED as stated

Detailed under "Partially confirmed" above. The `await` means `requireUser`'s `ConvexError` does
propagate and unauthenticated callers *are* blocked. The real defect is the missing ownership check
on `storageId`. The original framing, if a reader took it literally, would suggest unauthenticated
access — which is not the case.

### R7. "`UpdateChecker` installs the artifact without integrity verification" — true of the code, overstated as impact

Confirmed that no verification exists in app code. `src/updater/UpdateChecker.tsx:128-134`:

```tsx
const path = await NativeModules.Installer.download(
  info.url,
  `synomilo-${info.version}.apk`,
);
setProgress(100);
setPhase('done');
await NativeModules.Installer.install(path);
```

and `InstallerModule.kt:160-164` hands the file straight to the system installer:

```kotlin
val intent = Intent(Intent.ACTION_VIEW)
intent.setDataAndType(uri, "application/vnd.android.package-archive")
```

A grep of `InstallerModule.kt` for `verify|signature|hash|sha|md5|digest|PackageInstaller` returns
**no** verification logic — the claim is accurate about the code.

But the auditor's implicit "attacker ships a backdoored APK and it installs" framing overlooks the
platform control: Android requires an upgrade APK to be signed by the **same certificate** as the
installed app, and rejects it otherwise. Since `synomilo-release.keystore` is not leaked (R4), an
attacker cannot silently substitute code. Correct characterisation: **destructive-update-channel
takeover and social engineering**, not RCE. Rated accordingly, and noted in New Finding N4 because
the app is relying on an implicit platform guarantee it never asserts itself.

### R8. "PBKDF2 runs at 20,000 iterations" — REFUTED as stated

Detailed above. 210,000 is the primary path; 20,000 is a fallback the auditor treated as the norm.

### R9. "`build.gradle` falls back when the keystore is absent" — imprecise

There is no filesystem existence check. The condition is `keystoreProperties['storeFile']` (line 116),
i.e. the *presence of the property in the properties file*, not the presence of the keystore file on
disk. If `keystore.properties` names a path that does not exist, the release config is still selected
and the build fails at signing rather than falling back to debug. The fallback fires when
`keystore.properties` is absent or lacks `storeFile` — which is exactly the local-dev case and the
CI-with-missing-secret case.

### R10. "Hardcoded secrets in `.github/workflows/**`" — REFUTED, the workflow is clean

The only workflow, `.github/workflows/android-release.yml`, is the best-practice pattern throughout.
All three secrets come from GitHub:

```yaml
env:
  GOOGLE_SERVICES_JSON: ${{ secrets.GOOGLE_SERVICES_JSON }}   # :50
env:
  KEYSTORE_BASE64:       ${{ secrets.KEYSTORE_BASE64 }}       # :57
  KEYSTORE_PROPERTIES:   ${{ secrets.KEYSTORE_PROPERTIES }}   # :58
```

There are **zero** hardcoded secret literals in the file. It also declares
`permissions: contents: write` explicitly (`:9-10`) and pins `timeout-minutes: 75`. Two minor,
non-blocking hardening notes in N6. The first audit's CI criticism is simply wrong — the actual
leaked credential was in `scripts/`, which this audit apparently never checked.

### R11. ".env.local tracked" — REFUTED, correctly handled

```
PS> git ls-files '.env.local' '.env*'
(empty — not tracked)

PS> git check-ignore -v .env.local
.gitignore:81:.env.local    .env.local
```

Correctly ignored at `.gitignore:81`, with `.env.*.local` at `:82` covering variants.

**Variable names present in the working-tree file** (values withheld, never printed):
`CONVEX_DEPLOYMENT`, `CONVEX_URL`, `CONVEX_SITE_URL`.

None are secrets — all three are Convex deployment identifiers, and the deployment URL is already
public in `src/config/convexConfig.ts:1` and `scripts/publish-release.mjs:6`. **No finding here.**

---

## New findings

These were not in the first audit.

### N1. `.gitignore` does not cover `.jks`, which is how the vendor keystore got committed (MEDIUM)

```
.gitignore:34:  *.keystore
.gitignore:35:  !debug.keystore
```

The release-signing patterns only match the `.keystore` extension. `*.jks` — a completely standard
Java keystore extension, and the one the vendored CometChat keystore uses — falls straight through:

```
PS> git check-ignore -v 'android/app/cometchat_team_messanger.jks'
exit=False          # not ignored
PS> git check-ignore -v 'cometchat_team_messanger.jks'
exit=False          # not ignored
```

Whatever the reason the vendor keystore is not needed, the gap remains, and it is precisely the
mechanism by which `cometchat_team_messanger.jks` and the Firebase service-account JSON both reached
git history. The Firebase file got its own rule (`*firebase-adminsdk*.json`, `:79`), but the
generic keystore hole was never closed.

**Remediation**

```gitignore
*.keystore
*.jks
*.p12
*.pfx
*.pem
*.key
!debug.keystore
```

### N2. `debug.keystore` is tracked, making the debug signing identity public (LOW, with a real edge)

`git ls-files` includes `android/app/debug.keystore` (deliberately, via the `!debug.keystore`
negation). Combined with the hardcoded default credentials at `build.gradle:96-101` (`android` /
`android` / `androiddebugkey`) and the silent release fallback at `:116`, a third party can mint an
APK bearing the **same signing identity** as any misconfigured release build. Android will not
install it over the real app, but it is usable for social engineering and for signature-spoofing
social proofs.

Also worth noting: the same `.gitignore` block would be the natural place to add the rule from N1.

### N3. `files.generateUploadUrl` has no per-user quota (LOW)

`convex/files.ts:5-11` lets any authenticated user request unlimited storage upload URLs:

```ts
export const generateUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireUser(ctx, token);
    return await ctx.storage.generateUploadUrl();
  },
});
```

Combined with the open `auth.register` (no email verification, no invite requirement, no rate limit),
this is a free unlimited storage-abuse primitive against the Convex deployment's quota, reachable by
anyone who can reach the public deployment URL. Cheap to bound.

### N4. The app relies on Android's signature-continuity check without ever asserting it (MEDIUM, architectural)

Findings #2 and #3 give an attacker the update channel; R7 shows the app performs no integrity check
of its own. The only thing standing between "compromised update channel" and "remote code execution
on every device" is a platform behaviour the codebase never verifies or documents.

A defence-in-depth fix — pin the release certificate's SHA-256 in-app and abort on mismatch before
invoking the installer — makes the guarantee explicit and fails loudly if it ever stops holding:

```ts
// Compare against the expected release cert fingerprint, not just the file.
const expected = 'F1:97:81:B0:62:2D:58:...';  // from N/A release cert, injected at build time
const actual = await NativeModules.Installer.certDigest(path);
if (actual !== expected) throw new Error('Update signature mismatch');
```

Better still, publish a SHA-256 of the artifact in `updateCache` and verify the digest after
download, before `install(path)`.

### N5. `updates.publish` deletes the existing artifact before inserting the new one (LOW, availability)

`convex/updates.ts:56-67` tears down the live update record and its storage object, then inserts the
replacement. There is no transaction, no version history, and no rollback. Any failed or malicious
publish leaves the channel empty with the previous artifact already deleted from storage — there is
no way to recover it. Prefer retaining the prior row (or a bounded history) so a bad publish is
recoverable.

### N6. CI supply-chain hardening (LOW)

`.github/workflows/android-release.yml` is secret-clean (R10), but actions are pinned to mutable
major tags rather than commit SHAs — `actions/checkout@v4` (`:19`), `actions/setup-java@v4` (`:22`),
`actions/setup-node@v4` (`:28`), `actions/upload-artifact@v4` (`:67`),
`softprops/action-gh-release@v2` (`:75`). A compromised tag would execute in a job holding
`KEYSTORE_BASE64`. Pin to full SHAs.

### N7. `updateCache` is publicly reachable through the `updates.check` action (LOW, informational)

`convex/updates.ts:90-110` is declared as an `action`, not a `query`. Convex actions are invoked over
the public HTTP API. It calls `internal.updates.getLatest`, which has no authoriser — correct use of
an internal function — but `check` itself takes no token and returns a signed download URL plus
release notes to any unauthenticated caller. That is presumably intended for a pre-login check, but
it should be a deliberate decision recorded in a comment, because it does publish the artifact URL
to anonymous callers.

---

## Remediation priority

Ordered by exploitability against the live deployment:

| # | Action | Effort |
|---|---|---|
| 1 | Disable + delete Firebase SA key `18fde30e…`; issue a new one; audit Firestore/Storage/FCM | minutes |
| 2 | Rotate the maintainer `yashraj` password; delete its live `sessions` rows | minutes |
| 3 | Rotate the CometChat `authKey` in the Dashboard; remove the literal from `AppConstants.tsx` | minutes |
| 4 | Add `role` to `users`; gate `updates.publish` on it; reserve privileged usernames | ~1 h |
| 5 | `git filter-repo --invert-paths` the SA JSON **and** `scripts/publish-release.mjs`; `--force --mirror`; re-tag | ~30 min |
| 6 | Validate `replyToId.conversationId === conversationId` in `messages.send` | ~15 min |
| 7 | Add an ownership check to `files.url` | ~30 min |
| 8 | Require `role === "owner"` in `conversations.addMembers` | ~10 min |
| 9 | Make `build.gradle` throw instead of falling back to the debug key | ~10 min |
| 10 | Generic login/register errors; rate limiting; raise the 6-char password floor | ~1 h |
| 11 | Add the `*.jks` / `*.p12` / `*.pem` rules from N1; `git rm --cached` the vendor keystore | ~10 min |
| 12 | Verify update APK cert digest before install (N4); pin CI actions to SHAs (N6) | ~2 h |
| 13 | Add membership check to `conversations.typing`; drop the PBKDF2 fallback branch | ~30 min |
| 14 | Reconcile the two `.entitlements` files (R5) | ~15 min |
