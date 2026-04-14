"use client";

import { useState } from "react";

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
        // Force page reload to refresh data
        window.location.href = window.location.pathname + (currentFolder ? `?folder=${currentFolder}` : "");
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
      <button
        onClick={handleScan}
        disabled={scanning}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
      >
        {scanning ? "Scanning…" : "Scan library"}
      </button>
      {result && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">{result}</p>
      )}
    </div>
  );
}
