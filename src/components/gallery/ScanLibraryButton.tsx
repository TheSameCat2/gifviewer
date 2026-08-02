"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2Icon, PauseIcon, PlayIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";

interface ScanLibraryButtonProps {
  currentFolder?: string;
}

interface ActiveScan {
  id: number;
  status: string;
  phase: string | null;
  progress_current: number;
  progress_total: number;
  progress_message: string | null;
  files_found: number;
  files_added: number;
  files_updated: number;
  files_removed: number;
  thumbnails_generated: number;
  blurhashes_generated: number;
  error_message: string | null;
}

function phaseLabel(phase: string | null): string {
  switch (phase) {
    case "walking":
      return "Walking library";
    case "indexing":
      return "Indexing files";
    case "cleanup":
      return "Cleanup";
    case "assets":
      return "Thumbnails";
    case "starting":
      return "Starting";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "Scanning";
  }
}

export function ScanLibraryButton({ currentFolder }: ScanLibraryButtonProps) {
  const [active, setActive] = useState<ActiveScan | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [seenJobId, setSeenJobId] = useState<number | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/scan");
      const data = await res.json();
      const next = (data.active as ActiveScan | null) ?? null;
      setActive(next);

      // Detect completion of a job we started / were watching
      if (!next && seenJobId !== null) {
        const job = (data.jobs as Array<ActiveScan & { status: string }>)?.find(
          (j) => j.id === seenJobId
        );
        if (job?.status === "completed") {
          setResult(
            `Scanned: ${job.files_found} files. Added: ${job.files_added}. ` +
              `Updated: ${job.files_updated}. Removed: ${job.files_removed}.`
          );
          setSeenJobId(null);
          window.location.href =
            window.location.pathname + (currentFolder ? `?folder=${currentFolder}` : "");
        } else if (job?.status === "failed") {
          setResult(`Scan failed: ${job.error_message ?? "unknown error"}`);
          setSeenJobId(null);
        }
      }
    } catch {
      // ignore transient poll errors
    }
  }, [currentFolder, seenJobId]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      void refreshStatus();
    }, 800);
    return () => window.clearInterval(id);
  }, [active, refreshStatus]);

  async function handleScan() {
    setStarting(true);
    setResult(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      if (!data.success) {
        setResult(`Scan failed: ${data.error ?? "unknown error"}`);
      } else if (data.jobId) {
        setSeenJobId(data.jobId);
      }
      await refreshStatus();
    } catch (e) {
      setResult(`Scan failed: ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      setStarting(false);
    }
  }

  async function handlePause() {
    await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause" }),
    });
    await refreshStatus();
  }

  async function handleResume() {
    await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    });
    await refreshStatus();
  }

  const isBusy = Boolean(active) || starting;
  const isPaused = active?.status === "paused";
  const progressValue =
    active && active.progress_total > 0
      ? Math.min(100, Math.round((active.progress_current / active.progress_total) * 100))
      : null;

  return (
    <div className="flex min-w-[14rem] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleScan} disabled={isBusy} size="lg">
          {isBusy && !isPaused ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          {isBusy ? (isPaused ? "Paused" : "Scanning…") : "Scan library"}
        </Button>

        {active && !isPaused && (
          <Button variant="outline" size="sm" onClick={handlePause}>
            <PauseIcon data-icon="inline-start" />
            Pause
          </Button>
        )}
        {isPaused && (
          <Button variant="secondary" size="sm" onClick={handleResume}>
            <PlayIcon data-icon="inline-start" />
            Resume
          </Button>
        )}
      </div>

      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="rounded-lg border bg-card/80 p-2 shadow-sm"
          >
            <Progress value={progressValue} className="w-full">
              <ProgressLabel>{phaseLabel(active.phase)}</ProgressLabel>
              <ProgressValue>
                {() =>
                  active.progress_total > 0
                    ? `${active.progress_current}/${active.progress_total}`
                    : active.progress_current > 0
                      ? String(active.progress_current)
                      : isPaused
                        ? "paused"
                        : "…"
                }
              </ProgressValue>
            </Progress>
            {active.progress_message && (
              <p className="mt-1.5 text-xs text-muted-foreground">{active.progress_message}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {result && !active && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="text-xs text-muted-foreground"
          >
            {result}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
