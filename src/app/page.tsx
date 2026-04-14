import Link from "next/link";
import { getConfig } from "@/lib/config";
import { getRootFolder, getFolderById, getFolderChildren, getMediaByFolder, getFolderBreadcrumbs, hasFolders, getAllFolders } from "@/lib/db/folders";
import { getMediaById, getTagsForMedia } from "@/lib/db/media";
import { FolderTree } from "@/components/gallery/FolderTree";
import { MediaGrid } from "@/components/gallery/MediaGrid";
import { FullscreenViewer } from "@/components/gallery/FullscreenViewer";
import { ScanLibraryButton } from "@/components/gallery/ScanLibraryButton";

// Force dynamic rendering to prevent build-time DB access and allow env vars
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ folder?: string; media?: string }>;
}

export default async function GalleryPage({ searchParams }: PageProps) {
  const { folder: folderParam, media: mediaParam } = await searchParams;
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

  // Load content for selected folder
  const childFolders = selectedFolder ? getFolderChildren(selectedFolder.id) : [];
  const mediaItems = selectedFolder ? getMediaByFolder(selectedFolder.id) : [];
  const breadcrumbs = selectedFolderId ? getFolderBreadcrumbs(selectedFolderId) : [];

  // Parse media ID safely
  let selectedMediaId: number | null = null;
  if (mediaParam !== undefined) {
    const parsed = parseInt(mediaParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      selectedMediaId = parsed;
    }
  }

  // Load selected media
  const selectedMedia = selectedMediaId ? getMediaById(selectedMediaId) : null;
  const selectedMediaTags = selectedMedia ? getTagsForMedia(selectedMedia.id) : [];

  // Compute previous/next IDs for viewer navigation if media is in current folder
  let previousId: number | null = null;
  let nextId: number | null = null;
  if (selectedMedia && mediaItems.length > 0) {
    const currentIndex = mediaItems.findIndex((m) => m.id === selectedMediaId);
    if (currentIndex > 0) {
      previousId = mediaItems[currentIndex - 1].id;
    }
    if (currentIndex >= 0 && currentIndex < mediaItems.length - 1) {
      nextId = mediaItems[currentIndex + 1].id;
    }
  }

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
          folderId={selectedFolderId ?? undefined}
          previousId={previousId}
          nextId={nextId}
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
          ) : childFolders.length === 0 && mediaItems.length === 0 ? (
            /* Empty state: folder is empty */
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="mb-6 text-6xl">🗂️</div>
              <h2 className="mb-2 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                This folder is empty
              </h2>
              <p className="max-w-md text-zinc-500 dark:text-zinc-400">
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

              {/* Media grid */}
              {mediaItems.length > 0 && (
                <section>
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Media ({mediaItems.length})
                  </h2>
                  <MediaGrid items={mediaItems} folderId={selectedFolderId ?? undefined} />
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
