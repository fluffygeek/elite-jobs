import type { MetadataRoute } from "next";

// Next.js App Router's native manifest generator (serves /manifest.webmanifest).
// This is what makes the Technician intake surface installable via the
// browser's own "Add to Home Screen" — no app-store/IT step (issue #6's
// first acceptance criterion). Icons are a placeholder SVG (see
// public/icon.svg); custom artwork is explicitly out of scope for this
// ticket.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Elite Jobs — Technician Intake",
    short_name: "Elite Jobs",
    description: "Offline-capable Job intake for Elite Jobs field technicians",
    start_url: "/jobs/new",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1a5c2b",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
