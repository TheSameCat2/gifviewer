"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { MediaRow } from "@/lib/db/media";

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



export function MediaGrid({
  initialItems,
  folderId,
  initialLoadedPages,
  totalCount,
  pageSize,
}: MediaGridProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const [items, setItems] = useState<MediaItem[]>(initialItems);
  const [loadedPages, setLoadedPages] = useState(initialLoadedPages);
  const [isLoading, setIsLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = loadedPages < totalPages;

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

  if (items.length === 0) return null;

  // Build href using current loadedPages state
  const buildHref = (itemId: number) => {
    const params = new URLSearchParams();
    params.set("folder", String(folderId));
    params.set("page", String(loadedPages));
    params.set("media", String(itemId));
    return `?${params.toString()}`;
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {items.map((item) => {
          const isVideo = isVideoMime(item.mime_type);
          const href = buildHref(item.id);
          const thumbSrc = `/api/thumbs/${item.id}`;
          const mediaSrc = `/api/media/${item.id}`;

          return (
            <Link
              key={item.id}
              href={href}
              className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800"
            >
              {isVideo ? (
                <video
                  src={mediaSrc}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="h-full w-full object-cover"
                  preload="metadata"
                />
              ) : (
                <Image
                  src={thumbSrc}
                  alt={item.filename}
                  fill
                  unoptimized
                  sizes="(min-width: 1280px) 16vw, (min-width: 1024px) 20vw, (min-width: 768px) 25vw, 50vw"
                  className="object-cover"
                />
              )}
              {/* Overlay with filename */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-2 opacity-0 transition-opacity group-hover:opacity-100">
                <p className="truncate text-xs text-white">{item.filename}</p>
              </div>
            </Link>
          );
        })}
      </div>

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
