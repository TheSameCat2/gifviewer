/**
 * Shared constants for the gallery.
 */
export const PAGE_SIZE = 120 as const;
export type { MediaRow } from "@/lib/db/media";

export interface GalleryHrefOptions {
  folderId: number | null;
  page?: number;
  mediaId?: number;
  /** When set, keep the viewer in filter mode with these criteria. */
  filter?: { tags: number[]; rating: number };
}

/** Build a gallery URL that preserves folder, page, media, and filter state. */
export function galleryHref(options: GalleryHrefOptions): string {
  const params = new URLSearchParams();
  if (options.folderId !== null) {
    params.set("folder", String(options.folderId));
  }
  if (options.page !== undefined) {
    params.set("page", String(options.page));
  }
  if (options.mediaId !== undefined) {
    params.set("media", String(options.mediaId));
  }
  if (options.filter) {
    params.set("filter", "1");
    if (options.filter.tags.length > 0) {
      params.set("tags", options.filter.tags.join(","));
    }
    if (options.filter.rating > 0) {
      params.set("rating", String(options.filter.rating));
    }
  }
  return `/?${params.toString()}`;
}
