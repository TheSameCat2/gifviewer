"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { MediaRow, TagRow } from "@/lib/db/media";

interface FolderOption {
  id: number;
  name: string;
  path: string;
}

interface FullscreenViewerProps {
  item: MediaRow;
  folderId?: number;
  previousId: number | null;
  nextId: number | null;
  initialTags: TagRow[];
  folderOptions: FolderOption[];
}

function isVideoMime(mimeType: string | null): boolean {
  return mimeType === "video/webm";
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function patchMedia(id: number, body: Record<string, unknown>) {
  const res = await fetch(`/api/media/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function FullscreenViewer({
  item,
  folderId,
  previousId,
  nextId,
  initialTags,
  folderOptions,
}: FullscreenViewerProps) {
  const router = useRouter();
  const isVideo = isVideoMime(item.mime_type);
  const backHref = folderId ? `/?folder=${folderId}` : "/";
  const mediaSrc = `/api/media/${item.id}`;

  const [rating, setRating] = useState(item.rating);
  const [tags, setTags] = useState<TagRow[]>(initialTags);
  const [tagInput, setTagInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<number | "">(folderId ?? "");

  // Keyboard navigation: left/right arrows to navigate between media items
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      if (["input", "textarea", "select", "button", "a", "video"].includes(tagName) || target.isContentEditable) return;
      if (e.key === "ArrowLeft" && previousId !== null) {
        router.push(`/?folder=${folderId ?? ""}&media=${previousId}`);
      } else if (e.key === "ArrowRight" && nextId !== null) {
        router.push(`/?folder=${folderId ?? ""}&media=${nextId}`);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [folderId, previousId, nextId, router]);

  const currentFolderName = folderOptions.find((f) => f.id === item.folder_id)?.name ?? "/";

  const handleRating = useCallback(
    async (r: number) => {
      setPending(true);
      setError(null);
      try {
        const res = await patchMedia(item.id, { action: "setRating", rating: r });
        setRating(res.rating);
        setTags(res.tags);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update rating");
      } finally {
        setPending(false);
      }
    },
    [item.id]
  );

  const handleAddTag = useCallback(async () => {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    try {
      const res = await patchMedia(item.id, { action: "addTag", tag: trimmed });
      setTags(res.tags);
      setTagInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add tag");
    } finally {
      setPending(false);
    }
  }, [item.id, tagInput]);

  const handleRemoveTag = useCallback(
    async (tagId: number) => {
      setPending(true);
      setError(null);
      try {
        const res = await patchMedia(item.id, { action: "removeTag", tagId });
        setTags(res.tags);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to remove tag");
      } finally {
        setPending(false);
      }
    },
    [item.id]
  );

  const handleSort = useCallback(
    async (direction: "earlier" | "later") => {
      setPending(true);
      setError(null);
      try {
        await patchMedia(item.id, { action: "sortMedia", direction });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to sort");
      } finally {
        setPending(false);
      }
    },
    [item.id, router]
  );

  const handleMove = useCallback(async () => {
    const target = selectedFolderId === "" ? null : Number(selectedFolderId);
    if (target === null) return;
    if (target === item.folder_id) return;
    setPending(true);
    setError(null);
    try {
      const res = await patchMedia(item.id, { action: "moveMedia", targetFolderId: target });
      if (res.moved) {
        router.push(`/?folder=${target}&media=${item.id}`);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to move");
    } finally {
      setPending(false);
    }
  }, [item.id, item.folder_id, selectedFolderId, router]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
      {/* Close button */}
      <Link
        href={backHref}
        className="absolute left-4 top-4 z-10 rounded bg-black/50 px-3 py-2 text-sm text-white hover:bg-black/70"
      >
        ✕ Close
      </Link>

      {/* Navigation */}
      <div className="absolute inset-x-0 top-4 flex justify-center gap-4">
        {previousId !== undefined && previousId !== null && (
          <Link
            href={`/?folder=${folderId ?? ""}&media=${previousId}`}
            className="rounded bg-black/50 px-3 py-2 text-sm text-white hover:bg-black/70"
          >
            ← Previous
          </Link>
        )}
        {nextId !== undefined && nextId !== null && (
          <Link
            href={`/?folder=${folderId ?? ""}&media=${nextId}`}
            className="rounded bg-black/50 px-3 py-2 text-sm text-white hover:bg-black/70"
          >
            Next →
          </Link>
        )}
      </div>

      {/* Media */}
      <div className="relative h-[85vh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] p-4">
        {isVideo ? (
          <video
            src={mediaSrc}
            controls
            autoPlay
            loop
            playsInline
            className="h-full w-full object-contain"
          />
        ) : (
          <Image
            src={mediaSrc}
            alt={item.filename}
            fill
            unoptimized
            priority
            sizes="100vw"
            className="object-contain"
          />
        )}
      </div>

      {/* Metadata bar */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-4">
        <p className="text-center text-sm font-medium text-white">{item.filename}</p>
        <div className="mt-1 flex-center flex justify-center gap-4 text-xs text-zinc-300">
          {item.mime_type && <span>{item.mime_type}</span>}
          {item.file_size !== null && <span>{formatFileSize(item.file_size)}</span>}
          {item.width !== null && item.height !== null && (
            <span>
              {item.width}×{item.height}
            </span>
          )}
          {item.duration_secs !== null && (
            <span>{item.duration_secs.toFixed(1)}s</span>
          )}
        </div>

        {/* Star rating */}
        <div className="mt-2 flex items-center justify-center gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => handleRating(star === rating ? 0 : star)}
              disabled={pending}
              className={`text-lg ${star <= rating ? "text-yellow-400" : "text-zinc-500"} hover:text-yellow-300 disabled:opacity-50`}
              aria-label={`Rate ${star} star${star !== 1 ? "s" : ""}`}
            >
              ★
            </button>
          ))}
          {rating > 0 && (
            <button
              onClick={() => handleRating(0)}
              disabled={pending}
              className="ml-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
            >
              clear
            </button>
          )}
        </div>

        {/* Tags */}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="flex items-center gap-1 rounded bg-white/20 px-2 py-0.5 text-xs text-white"
            >
              {tag.name}
              <button
                onClick={() => handleRemoveTag(tag.id)}
                disabled={pending}
                className="text-zinc-300 hover:text-white disabled:opacity-50"
                aria-label={`Remove tag ${tag.name}`}
              >
                ✕
              </button>
            </span>
          ))}
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
              placeholder="add tag"
              disabled={pending}
              className="w-24 rounded bg-white/10 px-2 py-0.5 text-xs text-white placeholder-zinc-400 disabled:opacity-50"
            />
            <button
              onClick={handleAddTag}
              disabled={pending || !tagInput.trim()}
              className="rounded bg-white/20 px-2 py-0.5 text-xs text-white hover:bg-white/30 disabled:opacity-50"
            >
              +
            </button>
          </div>
        </div>

        {/* Move / Sort controls */}
        <div className="mt-2 flex items-center justify-center gap-2">
          <span className="text-xs text-zinc-400">Move:</span>
          <button
            onClick={() => handleSort("earlier")}
            disabled={pending}
            className="rounded bg-white/20 px-2 py-0.5 text-xs text-white hover:bg-white/30 disabled:opacity-50"
            aria-label="Move earlier"
          >
            ← Earlier
          </button>
          <button
            onClick={() => handleSort("later")}
            disabled={pending}
            className="rounded bg-white/20 px-2 py-0.5 text-xs text-white hover:bg-white/30 disabled:opacity-50"
            aria-label="Move later"
          >
            Later →
          </button>
          <span className="mx-1 text-zinc-500">|</span>
          <span className="text-xs text-zinc-400">
            Folder: <span className="text-zinc-300">{currentFolderName}</span>
          </span>
          <select
            value={selectedFolderId}
            onChange={(e) => setSelectedFolderId(e.target.value === "" ? "" : Number(e.target.value))}
            disabled={pending}
            className="rounded bg-white/10 px-2 py-0.5 text-xs text-white disabled:opacity-50"
          >
            <option value="">-- Select --</option>
            {folderOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name || "/"}
              </option>
            ))}
          </select>
          <button
            onClick={handleMove}
            disabled={pending || selectedFolderId === "" || selectedFolderId === item.folder_id}
            className="rounded bg-white/20 px-2 py-0.5 text-xs text-white hover:bg-white/30 disabled:opacity-50"
          >
            Move
          </button>
        </div>

        {error && <p className="mt-1 text-center text-xs text-red-400">{error}</p>}
        {pending && <p className="mt-1 text-center text-xs text-zinc-400">…</p>}
      </div>
    </div>
  );
}
