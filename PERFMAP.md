# Performance Improvement Plan (PERFMAP)

This document tracks known performance issues and the work required to fix them.
Mark items as you go; open a PR only when a section is fully complete.

---

## 1. Grid Loading (Frontend + API)

### MediaGrid.tsx — React-level inefficiencies

| # | Issue | Impact | Status | Notes |
|---|-------|--------|--------|-------|
| 1.1 | Per-thumbnail state updates cause full-grid re-renders. `loadedThumbs` is a `Set` recreated on every change. | **High** | `done` | Replaced React state with direct DOM `classList` toggle in `onLoad` — zero state commits. |
| 1.2 | IntersectionObserver is torn down and recreated on every `loadedThumbs` change, re-observing all DOM nodes. | **Medium** | `done` | Preloading observer removed entirely; browser native lazy-loading handles it. |
| 1.3 | Manual `new window.Image()` preload logic duplicates browser work and doubles network requests before `<Image>` mounts. | Low | `done` | Custom preload code removed. |
| 1.4 | `replaceState` runs on every infinite-scroll fetch. | Low | `done` | `updateUrl` callback removed from `fetchNextPage`. |

### page.tsx — Server-side over-fetching

| # | Issue | Impact | Status | Notes |
|---|-------|--------|--------|-------|
| 1.5 | SSR hydrates the *entire* scrolled history (`finalLoadedPages * PAGE_SIZE`). If user is on page 10, 1,200 rows ship in initial HTML. | **Very High** | `done` | `page.tsx` now caps server-side items to exactly `PAGE_SIZE`; client fetches additional pages. |
| 1.6 | Filter mode also loads `finalLoadedPages * PAGE_SIZE` rows server-side even though only the first page is visible. | **High** | `done` | Filter-mode `searchMedia` call uses `ssrLimit = PAGE_SIZE`. |
| 1.7 | `buildTree` + `sortTree` run on every SSR pass regardless of whether the folder tree changed. | Low | `pending` | Cache tree structure or memoize if possible. |
| 1.8 | `getAllTags()` and `getAllFolders()` are loaded unconditionally on every navigation. | Low | `pending` | Only fetch when needed (e.g., filter panel open or tree render). |

### Thumbnail API (`/api/thumbs/[id]`)

| # | Issue | Impact | Status | Notes |
|---|-------|--------|--------|-------|
| 1.9 | Thumbnail generation blocks the HTTP response. `ensureThumbnail` calls `generateThumbnail` synchronously before returning. | **High** | `done` | `/api/thumbs` now streams the original immediately and fires `generateThumbnail` in the background with an in-flight deduplication map. |
| 1.10 | No early stream / background generation pattern. | Medium | `done` | Implemented in `/api/thumbs/[id]/route.ts`. |

---

## 2. Backend GIF Processing

### Thumbnail generation (`thumbnails.ts`)

| # | Issue | Impact | Status | Notes |
|---|-------|--------|--------|-------|
| 2.1 | GIFs stay as GIF format in thumbnails. `getThumbCachePath` forces `.gif` for `mediaType === "animated"`. | **High** | `done` | Thumbnails now always use `.webp`; `generateGifThumb` removed. |
| 2.2 | No frame limit on GIF thumbnailing. Sharp processes **all frames** of the source GIF. | **High** | `done` | Unified `generateImageThumb` uses `{ animated: true, pages: 1 }` for GIFs — only first frame decoded. |
| 2.3 | Blurhash reads the entire GIF into memory via `fs.promises.readFile`, then resizes to 32×32. | Medium | `done` | `generateBlurhash` now streams GIFs through `sharp(srcPath, { pages: 1 })` without a full buffer read. |
| 2.4 | `probeImage` calls `sharp(filePath).metadata()` which parses the full GIF structure just for width/height. | Low | `done` | `probeImage` now passes `{ animated: true, pages: 1 }` for GIF sources. |

### Scanner asset generation (`scanner.ts`)

| # | Issue | Impact | Status | Notes |
|---|-------|--------|--------|-------|
| 2.5 | Inline thumbnail generation blocks the scan HTTP request. `generateMediaAssets` runs inside the scan handler. | **High** | `pending` | Still runs inside scan handler. Consider moving to a background worker. |
| 2.6 | GIF processing is CPU-bound and 4 concurrent sharp encodes can saturate cores. | Medium | `pending` | CONCURRENCY still 4 for all types. |

---

## 3. Scanning System

### `scanner.ts` — Walk & ingest

| # | Issue | Impact | Status | Notes |
|---|-------|--------|--------|-------|
| 3.1 | File upserts are fully sequential. `for (const relativePath of validFiles) { await upsertMedia(...) }` is one-by-one. | **High** | `done` | Replaced per-file `upsertMedia` with `batchUpsertFiles`: preload existing rows, probe in parallel batches, write in one SQLite transaction. |
| 3.2 | No bulk insert / transaction boundary around the file loop. | Medium | `done` | Covered by `batchUpsertFiles` implementation. |
| 3.3 | Metadata probing (`probeMedia`) is interleaved with DB writes. | Medium | `done` | `batchUpsertFiles` probes with `CONCURRENCY = 8` before the DB transaction. |
| 3.4 | Stale removal loads entire tables into memory. `removeStaleFolders` and `removeStaleMedia` `SELECT *` then diff in JS. | Medium | `pending` | Use `DELETE ... WHERE path NOT IN (...)` or `NOT IN` subqueries and keep the work in SQL. |
| 3.5 | No incremental / watch-mode scan. Every scan walks the full tree from disk. | Low | `pending` | Out of scope for a quick pass, but a long-term win. Consider `fs.watch` or a polling delta scan. |

### `walkDir`

| # | Issue | Impact | Status | Notes |
|---|-------|--------|--------|-------|
| 3.6 | Files within a single directory are not processed in parallel. Only subdirectories recurse in parallel. | Low | `pending` | Minor compared to 3.1, but parallel file stat/probing within a dir would help flat folders. |

---

## 4. Database / Schema

| # | Issue | Impact | Status | Notes |
|---|-------|--------|--------|-------|
| 4.1 | Missing composite index on `media(folder_id, manual_order, filename, id)`. | **High** | `done` | Added `idx_media_folder_order` on `(folder_id, manual_order, filename, id)`. |
| 4.2 | `SELECT *` fetches `thumb_blurhash` in every grid query even though it is only needed for SSR placeholders. | Low | `pending` | Select only needed columns to shrink result sets and reduce serialization cost. |
| 4.3 | `scan_jobs` tracks `status = 'running'` but has no true worker queue. | Medium | `pending` | Still a synchronous scan in the POST handler. |

---

## Legend

- `pending` — Not started.
- `in-progress` — Someone is working on it.
- `review` — PR open or awaiting review.
- `done` — Merged and verified.

---

*Last updated: after implementing all high-impact fixes (DB index, SSR pagination, React grid rendering, non-blocking thumbs, GIF WebP conversion + frame limiting, scanner batch upserts).
