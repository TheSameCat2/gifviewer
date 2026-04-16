"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { MediaRow } from "@/lib/db/media";
import { ContextMenu, ContextMenuEntry } from "./ContextMenu";
import { blurhashToDataUrl } from "@/lib/media/blurhash";

interface MediaGridProps {
  initialItems: MediaRow[];
  folderId: number;
  initialLoadedPages: number;
  totalCount: number;
  pageSize: number;
}

function isVideoMime(mimeType: string | null): boolean {
  return mimeType === "video/webm";
}

type MediaItem = MediaRow;

interface ClipboardState {
  mediaId: number;
  operation: "copy" | "cut";
}

/**
 * Renders a blurhash as a background placeholder
 */
function BlurhashPlaceholder({ 
  hash, 
  width = 32, 
  height = 32,
  style 
}: { 
  hash: string; 
  width?: number; 
  height?: number;
  style?: React.CSSProperties;
}) {
  const dataUrl = useMemo(() => {
    try {
      return blurhashToDataUrl(hash, width, height);
    } catch {
      return null;
    }
  }, [hash, width, height]);

  if (!dataUrl) {
    return (
      <div 
        className="absolute inset-0 bg-zinc-200 dark:bg-zinc-700 animate-pulse" 
        style={style}
      />
    );
  }

  return (
    <div 
      className="absolute inset-0" 
      style={{ 
        backgroundImage: `url(${dataUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        ...style 
      }} 
    />
  );
}

export function MediaGrid({
  initialItems,
  folderId,
  initialLoadedPages,
  totalCount,
  pageSize,
}: MediaGridProps) {
  const router = useRouter();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const [items, setItems] = useState<MediaItem[]>(initialItems);
  const [loadedPages, setLoadedPages] = useState(initialLoadedPages);
  const [isLoading, setIsLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = loadedPages < totalPages;

  // Track loaded thumbnails for preload
  const [loadedThumbs, setLoadedThumbs] = useState<Set<number>>(new Set());
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Clipboard state
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; item: MediaItem } | null>(null);

  // Fetch clipboard state on mount and after folder changes
  useEffect(() => {
    fetch("/api/clipboard")
      .then((r) => r.json())
      .then((data) => {
        if (data.items && data.items.length > 0) {
          setClipboard({
            mediaId: data.items[0].media_id,
            operation: data.items[0].operation,
          });
        } else {
          setClipboard(null);
        }
      })
      .catch(() => {});
  }, [folderId]);

  // Preload thumbnails for items about to enter viewport
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = Number(entry.target.getAttribute("data-media-id"));
          if (entry.isIntersecting && !loadedThumbs.has(id)) {
            // Preload the thumbnail
            const img = new window.Image();
            img.src = `/api/thumbs/${id}?size=small`;
            img.onload = () => {
              setLoadedThumbs((prev) => new Set(prev).add(id));
            };
            // Mark as loaded even if it fails (to avoid retrying)
            img.onerror = () => {
              setLoadedThumbs((prev) => new Set(prev).add(id));
            };
          }
        });
      },
      { rootMargin: "200px" }
    );

    // Observe all item refs
    itemRefs.current.forEach((element) => {
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, [items, loadedThumbs]);

  // Update URL when loaded pages change
  const updateUrl = useCallback(
    (page: number) => {
      const url = new URL(window.location.href);
      url.searchParams.set("folder", String(folderId));
      url.searchParams.set("page", String(page));
      // Preserve media param if present but don't change it
      window.history.replaceState(null, "", url.toString());
    },
    [folderId]
  );

  // Fetch next page
  const fetchNextPage = useCallback(async () => {
    if (isLoading || !hasMore) return;

    setIsLoading(true);
    const nextPage = loadedPages + 1;

    try {
      const res = await fetch(`/api/folders/${folderId}/media?page=${nextPage}`);
      if (!res.ok) throw new Error("Failed to fetch");

      const data = await res.json();
      const newItems = data.items as MediaRow[];

      setItems((prev) => {
        // Dedupe by id defensively
        const existingIds = new Set(prev.map((i) => i.id));
        const filtered = newItems.filter((i) => !existingIds.has(i.id));
        return [...prev, ...filtered];
      });

      setLoadedPages(nextPage);
      updateUrl(nextPage);
    } catch (err) {
      console.error("Error fetching next page:", err);
    } finally {
      setIsLoading(false);
    }
  }, [folderId, hasMore, isLoading, loadedPages, updateUrl]);

  // Resync local state from server props when they change (e.g., navigation between folders)
  useEffect(() => {
    setItems(initialItems);
    setLoadedPages(initialLoadedPages);
    setIsLoading(false);
    setLoadedThumbs(new Set());
  }, [folderId, initialItems, initialLoadedPages]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          fetchNextPage();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasMore, isLoading]);

  // --- Clipboard operations ---

  const handleCut = useCallback(async (mediaId: number) => {
    await fetch("/api/clipboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId, operation: "cut" }),
    });
    setClipboard({ mediaId, operation: "cut" });
  }, []);

  const handleCopy = useCallback(async (mediaId: number) => {
    await fetch("/api/clipboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId, operation: "copy" }),
    });
    setClipboard({ mediaId, operation: "copy" });
  }, []);

  const handlePaste = useCallback(async () => {
    if (!clipboard) return;
    await fetch("/api/clipboard", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "paste", targetFolderId: folderId }),
    });
    setClipboard(null);
    router.refresh();
  }, [clipboard, folderId, router]);

  const handleDelete = useCallback(async (mediaId: number) => {
    const confirmed = window.confirm("Are you sure you want to delete this file?");
    if (!confirmed) return;
    await fetch(`/api/media/${mediaId}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== mediaId));
    // If the deleted item was on the clipboard, clear it
    if (clipboard?.mediaId === mediaId) {
      setClipboard(null);
    }
    router.refresh();
  }, [clipboard, router]);

  const handleUpload = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*,video/webm,.gif";
    input.onchange = async () => {
      if (!input.files) return;
      for (const file of Array.from(input.files)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("targetFolderId", String(folderId));
        await fetch("/api/upload", { method: "POST", body: fd });
      }
      router.refresh();
    };
    input.click();
  }, [folderId, router]);

  if (items.length === 0) return null;

  // Build href using current loadedPages state
  const buildHref = (itemId: number) => {
    const params = new URLSearchParams();
    params.set("folder", String(folderId));
    params.set("page", String(loadedPages));
    params.set("media", String(itemId));
    return `?${params.toString()}`;
  };

  const contextMenuItems = (mediaItem: MediaItem): ContextMenuEntry[] => {
    const entries: ContextMenuEntry[] = [
      { label: "Cut", icon: "✂", action: () => handleCut(mediaItem.id) },
      { label: "Copy", icon: "📋", action: () => handleCopy(mediaItem.id) },
    ];

    if (clipboard !== null) {
      entries.push({ separator: true });
      entries.push({
        label: `Paste ${clipboard.operation} here`,
        icon: "📌",
        action: handlePaste,
        disabled: clipboard.mediaId === mediaItem.id,
      });
    }

    entries.push({ separator: true });
    entries.push({
      label: "Delete",
      icon: "🗑",
      action: () => handleDelete(mediaItem.id),
      danger: true,
    });

    return entries;
  };

  return (
    <>
      {/* Toolbar: Upload + Paste */}
      <div className="mb-3 flex gap-2">
        <button
          onClick={handleUpload}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          + Upload
        </button>
        {clipboard !== null && (
          <button
            onClick={handlePaste}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            📌 Paste ({clipboard.operation})
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {items.map((item) => {
          const isVideo = isVideoMime(item.mime_type);
          const href = buildHref(item.id);
          const thumbSrc = `/api/thumbs/${item.id}?size=small`;
          const mediaSrc = `/api/media/${item.id}`;
          const isCutSource = clipboard?.operation === "cut" && clipboard?.mediaId === item.id;
          const isThumbLoaded = loadedThumbs.has(item.id);

          return (
            <div
              key={item.id}
              ref={(el) => {
                if (el) itemRefs.current.set(item.id, el);
                else itemRefs.current.delete(item.id);
              }}
              data-media-id={item.id}
              className={`group relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800 ${
                isCutSource ? "ring-2 ring-yellow-400 opacity-60" : ""
              }`}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY, item });
              }}
            >
              <Link
                href={href}
                className="absolute inset-0"
              >
                {isVideo ? (
                  <>
                    {/* Blurhash placeholder for video */}
                    {item.thumb_blurhash && (
                      <BlurhashPlaceholder hash={item.thumb_blurhash} />
                    )}
                    {/* Use thumbnail for grid, full video on click */}
                    <Image
                      src={thumbSrc}
                      alt={item.filename}
                      fill
                      unoptimized
                      sizes="(min-width: 1280px) 16vw, (min-width: 1024px) 20vw, (min-width: 768px) 25vw, 50vw"
                      className={`object-cover transition-opacity ${isThumbLoaded ? "opacity-100" : "opacity-0"}`}
                    />
                  </>
                ) : (
                  <>
                    {/* Blurhash placeholder for images */}
                    {item.thumb_blurhash && (
                      <BlurhashPlaceholder hash={item.thumb_blurhash} />
                    )}
                    <Image
                      src={thumbSrc}
                      alt={item.filename}
                      fill
                      unoptimized
                      sizes="(min-width: 1280px) 16vw, (min-width: 1024px) 20vw, (min-width: 768px) 25vw, 50vw"
                      className={`object-cover transition-opacity ${isThumbLoaded ? "opacity-100" : "opacity-0"}`}
                      onLoad={() => setLoadedThumbs((prev) => new Set(prev).add(item.id))}
                    />
                  </>
                )}
                {/* Overlay with filename */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <p className="truncate text-xs text-white">{item.filename}</p>
                </div>
              </Link>
            </div>
          );
        })}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={contextMenuItems(ctxMenu.item)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Sentinel element for IntersectionObserver */}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-4">
          {isLoading && (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">Loading more...</span>
          )}
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <p className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          All {totalCount} items loaded
        </p>
      )}
    </>
  );
}
