import Link from "next/link";
import { MediaRow } from "@/lib/db/media";

interface MediaGridProps {
  items: MediaRow[];
  folderId?: number;
}

function isVideoMime(mimeType: string | null): boolean {
  return mimeType === "video/webm";
}

export function MediaGrid({ items, folderId }: MediaGridProps) {
  if (items.length === 0) return null;

  const base = `?folder=${folderId ?? ""}`;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => {
        const isVideo = isVideoMime(item.mime_type);
        const href = `${base}&media=${item.id}`;
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
              <img
                src={thumbSrc}
                alt={item.filename}
                className="h-full w-full object-cover"
                loading="lazy"
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
  );
}
