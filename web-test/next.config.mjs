import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // StrictMode double-invokes effects in development, which would build a
  // second RTCPeerConnection and fire a second SDP offer for a call already
  // being set up. This is a debugging tool; double-setup is a bug here, not a
  // feature, so the mode is off.
  reactStrictMode: false,
  // The harness is its own npm project but sits inside a larger repository.
  // Without this, Next picks the outer package-lock.json as the workspace root
  // and warns about it on every build.
  outputFileTracingRoot: here,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
