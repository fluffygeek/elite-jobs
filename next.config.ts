import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  /* config options here */
};

// Serwist's Turbopack integration (Next.js 16 defaults to Turbopack, which
// @serwist/next's webpack-based plugin doesn't support — see
// https://serwist.pages.dev/docs/next/turbo). The service worker itself is
// built and served by the Route Handler at src/app/serwist/[path]/route.ts;
// this wrapper just marks esbuild/esbuild-wasm as server-external packages
// so Next.js doesn't try to bundle them. See AGENTS.md's architecture map
// ("Serwist (maintained service-worker tooling) for the PWA/offline shell")
// and docs/architecture.md's Key decisions. The actual offline Job data
// lives in IndexedDB via Dexie (src/lib/offline/), not in the service
// worker's cache — this is only the installable-PWA shell.
export default withSerwist(nextConfig);
