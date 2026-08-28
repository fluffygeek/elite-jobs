import type { ReactNode } from "react";
import { SerwistProvider } from "@serwist/turbopack/react";

// Registers the service worker (served from /serwist/sw.js — see
// src/app/serwist/[path]/route.ts) for the Technician intake surface only.
// This is what makes issue #6's "installable as a PWA" acceptance criterion
// work: once registered, the browser's own "Add to Home Screen" affordance
// picks it up alongside the manifest (src/app/manifest.ts).
export default function IntakeLayout({ children }: { children: ReactNode }) {
  return <SerwistProvider swUrl="/serwist/sw.js">{children}</SerwistProvider>;
}
