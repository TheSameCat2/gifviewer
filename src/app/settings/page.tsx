"use client";

import { useState } from "react";
import Link from "next/link";

export default function SettingsPage() {
  const [status, setStatus] = useState<{
    type: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ type: "idle" });

  const handleClearThumbnails = async () => {
    if (!window.confirm("This will delete all cached thumbnails and regenerate them in the background. Continue?")) {
      return;
    }

    setStatus({ type: "loading" });

    try {
      const res = await fetch("/api/settings/clear-thumbnails", {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Request failed");
      }

      setStatus({
        type: "success",
        message: data.message,
      });
    } catch (err) {
      setStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Settings
          </h1>
          <Link
            href="/"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            ← Back to Gallery
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 p-6">
        <div className="mx-auto max-w-2xl">
          <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Thumbnail Cache
            </h2>
            <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
              Thumbnails are generated automatically when media is first viewed.
              Clearing the cache deletes all existing thumbnails and queues them
              for regeneration in the background. Existing media will still display
              using the original files while thumbnails rebuild.
            </p>

            <button
              onClick={handleClearThumbnails}
              disabled={status.type === "loading"}
              className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/30"
            >
              {status.type === "loading" ? "Clearing…" : "Clear & Regenerate Thumbnails"}
            </button>

            {status.type === "success" && status.message && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
                {status.message}
              </div>
            )}

            {status.type === "error" && status.message && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {status.message}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
