import { createSerwistRoute } from "@serwist/turbopack";

// Serves the compiled service worker (src/app/sw.ts) at /serwist/sw.js.
// Required because @serwist/next's webpack-based build plugin doesn't
// support Turbopack, which Next.js 16 uses by default — see next.config.ts.
// Sets a `Service-Worker-Allowed: /` response header so a worker served from
// under /serwist/ can still control the whole app (in particular
// /jobs/new — see src/app/(intake)/layout.tsx, which registers it).
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
});
