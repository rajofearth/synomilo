import { GoogleAuth } from "google-auth-library";
import fs from "node:fs";

const KEY_PATH = process.argv[2];
const COMMAND = process.argv[3] || "create";
const ARG = process.argv[4];

if (!KEY_PATH || !fs.existsSync(KEY_PATH)) {
  console.error("usage: node rotate-fcm.mjs <service-account.json> [create|list|delete <keyName>]");
  process.exit(1);
}

const key = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
const auth = new GoogleAuth({
  credentials: key,
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
const client = await auth.getClient();
const token = (await client.getAccessToken()).token;

const base = `https://iam.googleapis.com/v1/projects/${key.project_id}/serviceAccounts/${encodeURIComponent(
  key.client_email,
)}/keys`;

if (COMMAND === "create") {
  const response = await fetch(base, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      privateKeyType: "TYPE_GOOGLE_CREDENTIALS_FILE",
      keyAlgorithm: "KEY_ALG_RSA_2048",
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    console.error("create failed:", response.status, JSON.stringify(body).slice(0, 400));
    process.exit(1);
  }
  const json = Buffer.from(body.privateKeyData, "base64").toString("utf8");
  const outPath = `${KEY_PATH.replace(/\.json$/, "")}-REPLACEMENT.json`;
  fs.writeFileSync(outPath, json);
  console.log("created key:", body.name);
  console.log("saved:", outPath);
} else if (COMMAND === "list") {
  const response = await fetch(base, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!response.ok) {
    console.error("list failed:", response.status, JSON.stringify(body).slice(0, 400));
    process.exit(1);
  }
  for (const item of body.keys ?? []) {
    console.log(item.name, item.validAfterTime, item.disabled ? "DISABLED" : "active");
  }
} else if (COMMAND === "delete") {
  const response = await fetch(`https://iam.googleapis.com/v1/${ARG}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text();
    console.error("delete failed:", response.status, body.slice(0, 400));
    process.exit(1);
  }
  console.log("deleted:", ARG);
}
