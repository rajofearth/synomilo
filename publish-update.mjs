/**
 * Publish a tagged release into the Convex `updateCache` table so the in-app
 * updater offers it.
 *
 * Convex functions are invoked here through `npx convex run`, not through
 * `fetch` to `/api/<module>:<function>`. That route 404s against this
 * deployment even though the deployment is healthy: the CLI reports all 43
 * functions present and `npx convex run` answers them, while a direct HTTP POST
 * to the same URL returns an empty 404 from the usher. Rather than guess at
 * headers, use the path that is known to work.
 *
 * Only the storage upload uses HTTP, and that goes to the pre-signed URL
 * Convex hands back, which is a different origin entirely.
 *
 * Flow:
 *   auth:login              -> session token (must be on the maintainer allowlist)
 *   files:generateUploadUrl -> one-time upload URL
 *   POST the APK bytes      -> storageId
 *   updates:publish         -> clears the stale row and inserts the new one
 *   updates:check           -> verifies what a client on `fromVersion` will see
 *
 * Usage:
 *   node publish-update.mjs <version> <apk-path> [notes-file] [fromVersion]
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';

const [, , version, apkPath, notesFile, fromVersion = '1.1.1'] = process.argv;
if (!version || !apkPath) {
  console.error('usage: node publish-update.mjs <version> <apk-path> [notes] [fromVersion]');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL('./.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.trimStart().startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

// Resolve the Convex CLI entry once, rather than going through `npx`.
//
// Two Windows traps make `npx convex run fn '{"a":1}'` unusable from Node:
//   - `shell: true` strips the double quotes out of the JSON before the CLI
//     sees it, so the CLI reports `{username:yashraj}` and JSON5 parsing fails.
//   - `shell: false` with `npx.cmd` throws EINVAL, because Node 24 refuses to
//     spawn a `.cmd` without a shell.
// Running the CLI's own entry with the current Node binary sidesteps both:
// real argv, no shell, no quoting to lose.
const CLI = fileURLToPath(new URL('./node_modules/convex/bin/main.js', import.meta.url));

const convex = (fn, args) => {
  const out = execFileSync(
    process.execPath,
    [CLI, 'run', fn, JSON.stringify(args)],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: false },
  ).trim();
  if (!out) {
    // The CLI prints nothing at all for an action that returns null, which is
    // exactly what `updates:check` does for a client that is already current.
    return null;
  }
  return out === 'null' ? null : JSON.parse(out);
};

const { token } = convex('auth:login', {
  username: env.RELEASE_USERNAME,
  password: env.RELEASE_PASSWORD,
});
console.log('logged in as maintainer');

const apk = readFileSync(apkPath);
console.log(`apk: ${basename(apkPath)} ${(apk.length / 1048576).toFixed(1)} MB`);

const uploadUrl = await convex('files:generateUploadUrl', { token });
console.log(`got one-time upload URL (${new URL(uploadUrl).host})`);

const uploadRes = await fetch(uploadUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/octet-stream' },
  body: apk,
});
const uploadBody = await uploadRes.text();
if (!uploadRes.ok) {
  throw new Error(`storage upload failed: ${uploadRes.status} ${uploadBody.slice(0, 300)}`);
}
const { storageId } = JSON.parse(uploadBody);
console.log(`uploaded, storageId=${storageId}`);

const notes = notesFile ? readFileSync(notesFile, 'utf8') : '';
const published = convex('updates:publish', {
  token,
  version: version.replace(/^v/i, ''),
  notes,
  storageId,
  size: apk.length,
});
console.log(`published version ${published}`);

const seen = convex('updates:check', { currentVersion: fromVersion });
if (!seen) {
  throw new Error(`a client on ${fromVersion} is being offered nothing`);
}
console.log(`client on ${fromVersion} sees ${seen.version}, ${(seen.size / 1048576).toFixed(1)} MB`);
console.log(`  url: ${seen.url}`);
console.log(`  notes: ${seen.notes.length} chars`);

const same = convex('updates:check', { currentVersion: published });
console.log(
  same === null
    ? `client already on ${published} is offered nothing (correct)`
    : `BUG: a client on ${published} is still offered ${same.version}`,
);