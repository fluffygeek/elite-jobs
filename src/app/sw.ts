/// <reference lib="esnext" />
/// <reference lib="webworker" />
// Minimal Serwist service worker: precaching only. This is the "PWA shell"
// piece of offline support (installability, an asset cache) — the actual
// offline Job data lives in IndexedDB via Dexie (src/lib/offline/), never in
// this cache. Deliberately does NOT use the Background Sync API
// (`event.waitUntil(self.registration.sync...)`) as the sync mechanism: iOS
// Safari doesn't support it (see docs/architecture.md's "Spikes &
// experiments" / the offline-sync decision in Key decisions). Sync is
// instead driven from the page itself — src/lib/offline/sync.ts — on load,
// on the browser's `online` event, and on a foregrounded interval.
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined };

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
