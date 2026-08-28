import type { ReactNode } from "react";
import { AppBar } from "@/components/app-bar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppBar />
      {children}
    </>
  );
}
