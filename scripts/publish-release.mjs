import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import fs from "node:fs";
import path from "node:path";

const CONVEX_URL = "https://glad-capybara-533.convex.cloud";

const [version, apkPath, notes = ""] = process.argv.slice(2);
if (!version || !apkPath) {
  console.error(
    'usage: node scripts/publish-release.mjs <version> <apk-path> "<notes>"',
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
  username: "yashraj",
  password: "testpass123",
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
