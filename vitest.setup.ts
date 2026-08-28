// Global Vitest setup. Polyfills `indexedDB` in the Node test environment so
// Dexie (src/lib/offline/db.ts) works under test without a real browser —
// the standard, well-known way to test Dexie code outside a browser. Safe to
// import unconditionally: it only adds globals, it doesn't affect tests that
// never touch IndexedDB.
import "fake-indexeddb/auto";
