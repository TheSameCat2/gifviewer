import Link from "next/link";
import { getConfig } from "@/lib/config";
import { getRootFolder, getFolderById, getFolderChildren, getMediaByFolderPaginated, getMediaCountByFolder, getAdjacentMediaIds, getMediaPageForFolderItem, getFolderBreadcrumbs, hasFolders, getAllFolders } from "@/lib/db/folders";
import { getMediaById, getTagsForMedia } from "@/lib/db/media";
import { FolderTree } from "@/components/gallery/FolderTree";
import { MediaGrid } from "@/components/gallery/MediaGrid";
import { FullscreenViewer } from "@/components/gallery/FullscreenViewer";
import { ScanLibraryButton } from "@/components/gallery/ScanLibraryButton";
import { PAGE_SIZE } from "@/lib/gallery";

// Force dynamic rendering to prevent build-time DB access and allow env vars
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ folder?: string; media?: string; page?: string }>;
}

export default async function GalleryPage({ searchParams }: PageProps) {
  const { folder: folderParam, media: mediaParam, page: pageParam } = await searchParams;
  const config = getConfig();

  // Parse folder ID safely
  let selectedFolderId: number | null = null;
  if (folderParam !== undefined) {
    const parsed = parseInt(folderParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      selectedFolderId = parsed;
    }
  }

  // Determine selected folder
  const rootFolder = getRootFolder();
  let selectedFolder = selectedFolderId ? getFolderById(selectedFolderId) : null;

  // If folder param exists but folder not found, fall back to root
  if (selectedFolderId !== null && selectedFolder === null) {
    selectedFolderId = null;
  }

  // Fall back to root folder if no folder selected
  if (selectedFolder === null && rootFolder !== null) {
    selectedFolder = rootFolder;
    selectedFolderId = rootFolder.id;
  }

  // Parse media ID safely
  let selectedMediaId: number | null = null;
  if (mediaParam !== undefined) {
    const parsed = parseInt(mediaParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      selectedMediaId = parsed;
    }
  }

  // Load selected media first (needed for page derivation)
  const selectedMedia = selectedMediaId ? getMediaById(selectedMediaId) : null;
  const selectedMediaTags = selectedMedia ? getTagsForMedia(selectedMedia.id) : [];

  // Parse page param as "loaded page count" (1-based)
  let requestedLoadedPages = 1;
  if (pageParam !== undefined) {
    const parsed = parseInt(pageParam, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      requestedLoadedPages = parsed;
    }
  }

  // Load content for selected folder
  const childFolders = selectedFolder ? getFolderChildren(selectedFolder.id) : [];
  const totalMediaCount = selectedFolder ? getMediaCountByFolder(selectedFolder.id) : 0;
  const totalPages = Math.max(1, Math.ceil(totalMediaCount / PAGE_SIZE));

  // Clamp requested loaded pages to valid range
  const clampedRequestedPages = Math.min(requestedLoadedPages, totalPages);

  // If a selected media item belongs to the selected folder, derive its page
  const selectedMediaPage =
    selectedMedia && selectedFolderId !== null && selectedMedia.folder_id === selectedFolderId
      ? getMediaPageForFolderItem(selectedFolderId, selectedMediaId!, PAGE_SIZE) ?? clampedRequestedPages
      : null;

  // Effective loaded-page count: max of requested or selected media's page
  const effectiveLoadedPages = selectedMediaPage !== null
    ? Math.max(clampedRequestedPages, selectedMediaPage)
    : clampedRequestedPages;

  // Clamp to total pages
  const finalLoadedPages = Math.min(effectiveLoadedPages, totalPages);

  // Fetch initial media list: first `finalLoadedPages * PAGE_SIZE` items
  const initialMediaItems = selectedFolder
    ? getMediaByFolderPaginated(selectedFolder.id, finalLoadedPages * PAGE_SIZE, 0)
    : [];

  const breadcrumbs = selectedFolderId ? getFolderBreadcrumbs(selectedFolderId) : [];

  // Compute previousHref/nextHref for fullscreen navigation
  // Use max(effectiveLoadedPages, pageForAdjacentItem) to ensure loaded page count is preserved
  let previousHref: string | null = null;
  let nextHref: string | null = null;
  if (selectedMedia && selectedFolderId !== null) {
    const { previousId, nextId } = getAdjacentMediaIds(selectedFolderId, selectedMediaId!);
    const folderPart = `?folder=${selectedFolderId}`;

    if (previousId !== null) {
      const prevPage =
        getMediaPageForFolderItem(selectedFolderId, previousId, PAGE_SIZE) ?? finalLoadedPages;
      const hrefPage = Math.max(finalLoadedPages, prevPage);
      previousHref = `${folderPart}&page=${hrefPage}&media=${previousId}`;
    }

    if (nextId !== null) {
      const nextPage =
        getMediaPageForFolderItem(selectedFolderId, nextId, PAGE_SIZE) ?? finalLoadedPages;
      const hrefPage = Math.max(finalLoadedPages, nextPage);
      nextHref = `${folderPart}&page=${hrefPage}&media=${nextId}`;
    }
  }

  // backHref preserves the current loaded-page count when closing fullscreen
  const backHref = selectedFolderId !== null
    ? `/?folder=${selectedFolderId}&page=${finalLoadedPages}`
    : "/";

  const libraryExists = hasFolders();

  // Build folder options for move controls
  const folderOptions = getAllFolders().map((f) => ({
    id: f.id,
    name: f.name || "/",
    path: f.path,
  }));

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {config.appName}
          </h1>
          <div className="flex items-center gap-4">
            <ScanLibraryButton currentFolder={selectedFolderId?.toString()} />
          </div>
        </div>
      </header>

      {/* Fullscreen viewer overlay */}
      {selectedMedia && (
        <FullscreenViewer
          item={selectedMedia}
          backHref={backHref}
          previousHref={previousHref}
          nextHref={nextHref}
          initialTags={selectedMediaTags}
          folderOptions={folderOptions}
        />
      )}

      {/* Main content */}
      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <FolderTree selectedId={selectedFolderId ?? undefined} />
        </aside>

        {/* Main area */}
        <main className="flex-1 overflow-auto p-6">
          {/* Breadcrumbs */}
          {breadcrumbs.length > 0 && (
            <nav className="mb-6 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Link href="/" className="hover:text-zinc-700 dark:hover:text-zinc-200">
                /
              </Link>
              {breadcrumbs.map((crumb, i) => (
                <span key={crumb.id} className="flex items-center gap-2">
                  <span className="text-zinc-400">/</span>
                  {i === breadcrumbs.length - 1 ? (
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {crumb.name || "Root"}
                    </span>
                  ) : (
                    <Link
                      href={`/?folder=${crumb.id}`}
                      className="hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      {crumb.name || "Root"}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          )}

          {!libraryExists ? (
            /* Empty state: library not scanned */
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="mb-6 text-6xl">📁</div>
              <h2 className="mb-2 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                Library not scanned
              </h2>
              <p className="mb-8 max-w-md text-zinc-500 dark:text-zinc-400">
                Scan your media library to index folders and files. The folder tree will
                appear here once scanning is complete.
              </p>
              <ScanLibraryButton />
            </div>
          ) : selectedFolder === null ? (
            /* Empty state: no folder selected (shouldn't normally happen with root fallback) */
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-zinc-500 dark:text-zinc-400">Select a folder to view media.</p>
            </div>
          ) : childFolders.length === 0 && initialMediaItems.length === 0 ? (
            /* Empty state: folder is empty */
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="mb-6 text-6xl">🗂️</div>
              <h2 className="mb-2 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                This folder is empty
              </h2>
              <p className="max-w-md text-zinc-400 dark:text-zinc-400">
                No subfolders or media files were found in this location.
              </p>
            </div>
          ) : (
            <>
              {/* Subfolder cards */}
              {childFolders.length > 0 && (
                <section className="mb-8">
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Subfolders
                  </h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {childFolders.map((child) => (
                      <Link
                        key={child.id}
                        href={`/?folder=${child.id}`}
                        className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 transition hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-700 dark:hover:bg-blue-900/20"
                      >
                        <span className="text-2xl">📁</span>
                        <span className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">
                          {child.name || "Root"}
                        </span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {/* Media grid with infinite scroll */}
              {initialMediaItems.length > 0 && (
                <section>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Media ({totalMediaCount})
                    </h2>
                    {totalPages > 1 && (
                      <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                        <span>
                          Showing {finalLoadedPages * PAGE_SIZE >= totalMediaCount ? "all" : `${finalLoadedPages * PAGE_SIZE} of`} {totalMediaCount}
                        </span>
                      </div>
                    )}
                  </div>
                  <MediaGrid
                    initialItems={initialMediaItems}
                    folderId={selectedFolderId ?? 0}
                    initialLoadedPages={finalLoadedPages}
                    totalCount={totalMediaCount}
                    pageSize={PAGE_SIZE}
                  />
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
