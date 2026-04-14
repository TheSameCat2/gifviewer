import Link from "next/link";
import { MediaRow } from "@/lib/db/media";

interface FullscreenViewerProps {
  item: MediaRow;
  folderId?: number;
  previousId: number | null;
  nextId: number | null;
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

export function FullscreenViewer({ item, folderId, previousId, nextId }: FullscreenViewerProps) {
  const isVideo = isVideoMime(item.mime_type);
  const backHref = folderId ? `/?folder=${folderId}` : "/";
  const mediaSrc = `/api/media/${item.id}`;

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
      <div className="flex max-h-[85vh] max-w-full items-center justify-center p-4">
        {isVideo ? (
          <video
            src={mediaSrc}
            controls
            autoPlay
            loop
            playsInline
            className="max-h-[85vh] max-w-full object-contain"
          />
        ) : (
          <img
            src={mediaSrc}
            alt={item.filename}
            className="max-h-[85vh] max-w-full object-contain"
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
      </div>
    </div>
  );
}
