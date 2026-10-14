import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import fs from "node:fs";
import path from "node:path";

// The release credential used to be hardcoded in this file and committed to
// git, which handed anyone who cloned the repo the ability to push an APK to
// every install. It now comes from the environment, with .env.local as a
// gitignored fallback.
function loadLocalEnv() {
  const envPath = path.resolve(".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].replace(/^["'](.*)["']$/, "$1");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadLocalEnv();

const CONVEX_URL =
  process.env.CONVEX_URL ?? "https://glad-capybara-533.convex.cloud";

const RELEASE_USERNAME = process.env.RELEASE_USERNAME;
const RELEASE_PASSWORD = process.env.RELEASE_PASSWORD;

const [version, apkPath, notes = ""] = process.argv.slice(2);
if (!version || !apkPath) {
  console.error(
    'usage: node scripts/publish-release.mjs <version> <apk-path> "<notes>"',
  );
  process.exit(1);
}

if (!RELEASE_USERNAME || !RELEASE_PASSWORD) {
  console.error(
    "RELEASE_USERNAME / RELEASE_PASSWORD are not set.\n" +
      "Put them in .env.local (gitignored) or export them before running.",
  );
  process.exit(1);
}

const resolved = path.resolve(apkPath);
if (!fs.existsSync(resolved)) {
  console.error("apk not found:", resolved);
  process.exit(1);
}

const client = new ConvexHttpClient(CONVEX_URL, {
  skipConvexDeploymentUrlCheck: true,
});

const login = await client.mutation(api.auth.login, {
  username: RELEASE_USERNAME,
  password: RELEASE_PASSWORD,
});
const token = login?.token;
if (!token) {
  console.error("login failed");
  process.exit(1);
}

const uploadUrl = await client.mutation(api.files.generateUploadUrl, {
  token,
});
if (!uploadUrl) {
  console.error("could not create upload url");
  process.exit(1);
}

const stat = fs.statSync(resolved);
console.log(
  `uploading ${version} (${(stat.size / 1024 / 1024).toFixed(1)} MB)...`,
);

const upload = await fetch(uploadUrl, {
  method: "POST",
  headers: { "Content-Type": "application/vnd.android.package-archive" },
  body: fs.createReadStream(resolved),
  duplex: "half",
});
if (!upload.ok) {
  console.error("upload failed:", upload.status, await upload.text());
  process.exit(1);
}
const { storageId } = await upload.json();

const published = await client.mutation(api.updates.publish, {
  token,
  version,
  storageId,
  size: stat.size,
  notes,
});

console.log(`published ${published} -> ${storageId}`);
process.exit(0);
