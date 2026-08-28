import { describe, expect, it, vi } from "vitest";

// The protected-route redirect itself (auth() wrapping a NextRequest) needs
// real Next.js middleware machinery to exercise meaningfully — what's worth
// unit-testing directly is the matcher: get this regex wrong and either a
// public route (like /login itself) gets gated, or a real route silently
// stays open. This proves both directions.
//
// "../auth" is mocked to a trivial passthrough purely so this module can
// load in Vitest at all — the real next-auth package fails to resolve under
// Vitest's Node ESM resolver (a next/server subpath mismatch unrelated to
// this file), and `config.matcher` (the only thing this test needs) doesn't
// depend on what auth() actually does.
vi.mock("../auth", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auth: (callback: any) => callback,
}));

const { config } = await import("./proxy");
function isMatched(pathname: string): boolean {
  const [pattern] = config.matcher;
  // Next.js's own matcher compiler anchors this pattern to the start of the
  // pathname; a plain `new RegExp(pattern)` doesn't, so without the `^` here
  // this could find a spurious match starting at some later "/" in the
  // path (e.g. the second slash in "/api/auth/session") — anchor to
  // reproduce how Next.js actually evaluates it.
  return new RegExp(`^${pattern}`).test(pathname);
}

describe("proxy route matcher", () => {
  it("does not gate public routes", () => {
    expect(isMatched("/login")).toBe(false);
    expect(isMatched("/api/auth/session")).toBe(false);
    expect(isMatched("/invite/some-token")).toBe(false);
    expect(isMatched("/manifest.webmanifest")).toBe(false);
    expect(isMatched("/serwist/sw.js")).toBe(false);
    expect(isMatched("/icon.svg")).toBe(false);
    expect(isMatched("/favicon.ico")).toBe(false);
    expect(isMatched("/_next/static/chunk.js")).toBe(false);
  });

  it("gates protected routes", () => {
    expect(isMatched("/")).toBe(true);
    expect(isMatched("/jobs")).toBe(true);
    expect(isMatched("/jobs/new")).toBe(true);
    expect(isMatched("/markets")).toBe(true);
  });
});
