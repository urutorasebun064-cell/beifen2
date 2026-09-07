import { useEffect } from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  useEffect(() => {
    try {
      const n = Number(sessionStorage.getItem("jb-err") || "0");
      if (n < 2) {
        sessionStorage.setItem("jb-err", String(n + 1));
        window.location.reload();
      }
    } catch {
      /* */
    }
  }, []);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: "#7ea36c" }}>
      <h1 className="text-lg font-semibold text-[#1c241c]">J</h1>
      <p className="max-w-md text-sm break-words text-[#1c241c]/80">
        {error.message || "An unexpected error occurred. Try reloading the page."}
      </p>
    </main>
  );
}