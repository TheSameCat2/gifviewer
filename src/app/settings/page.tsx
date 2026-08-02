"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeftIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  const [status, setStatus] = useState<{
    type: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ type: "idle" });

  const handleClearThumbnails = async () => {
    if (
      !window.confirm(
        "This will delete all cached thumbnails and regenerate them in the background. Continue?"
      )
    ) {
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
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-card/80 px-6 py-4 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <h1 className="font-heading text-2xl font-bold tracking-tight">Settings</h1>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/" />}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Back to Gallery
          </Button>
        </div>
      </header>

      <main className="flex-1 p-6">
        <motion.div
          className="mx-auto max-w-2xl"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <section className="rounded-xl border bg-card/80 p-6 shadow-sm backdrop-blur-sm">
            <h2 className="mb-4 font-heading text-lg font-semibold">Thumbnail Cache</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Static and short motion-preview WebPs are generated during scan (and on
              demand). Clearing the cache deletes all cached thumbs — including motion
              previews — and queues regeneration in the background. The grid keeps using
              static placeholders until rebuild finishes.
            </p>

            <Button
              onClick={handleClearThumbnails}
              disabled={status.type === "loading"}
              variant="destructive"
            >
              {status.type === "loading" ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              {status.type === "loading" ? "Clearing…" : "Clear & Regenerate Thumbnails"}
            </Button>

            <AnimatePresence mode="wait">
              {status.type === "success" && status.message && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-4"
                >
                  <Alert>
                    <AlertDescription>{status.message}</AlertDescription>
                  </Alert>
                </motion.div>
              )}
              {status.type === "error" && status.message && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-4"
                >
                  <Alert variant="destructive">
                    <AlertDescription>{status.message}</AlertDescription>
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </motion.div>
      </main>
    </div>
  );
}
