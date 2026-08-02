"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ScanLibraryButtonProps {
  currentFolder?: string;
}

export function ScanLibraryButton({ currentFolder }: ScanLibraryButtonProps) {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleScan() {
    setScanning(true);
    setResult(null);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const s = data.summary;
        setResult(
          `Scanned: ${s.foldersFound} folders, ${s.filesFound} files. ` +
            `Added: ${s.foldersAdded} folders, ${s.filesAdded} files. ` +
            `Updated: ${s.filesUpdated}. Removed: ${s.filesRemoved}.`
        );
        window.location.href =
          window.location.pathname + (currentFolder ? `?folder=${currentFolder}` : "");
      } else {
        setResult(`Scan failed: ${data.error ?? "unknown error"}`);
      }
    } catch (e) {
      setResult(`Scan failed: ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={handleScan} disabled={scanning} size="lg">
        {scanning ? (
          <Loader2Icon className="animate-spin" data-icon="inline-start" />
        ) : (
          <RefreshCwIcon data-icon="inline-start" />
        )}
        {scanning ? "Scanning…" : "Scan library"}
      </Button>
      <AnimatePresence>
        {result && (
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
