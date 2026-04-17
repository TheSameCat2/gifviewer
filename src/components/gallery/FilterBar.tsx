"use client";

import { useState, useCallback } from "react";

interface FilterBarProps {
  folderId: number;
  allTags: Array<{ id: number; name: string }>;
  activeTags: number[];
  activeRating: number;
  onFilterChange: (tags: number[], rating: number) => void;
}

export function FilterBar({
  allTags,
  activeTags,
  activeRating,
  onFilterChange,
}: FilterBarProps) {
  const [localTags, setLocalTags] = useState<number[]>(activeTags);
  const [localRating, setLocalRating] = useState(activeRating);
  const [isOpen, setIsOpen] = useState(false);

  const handleTagToggle = useCallback((tagId: number) => {
    setLocalTags((prev) => {
      const next = prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId];
      return next;
    });
  }, []);

  const handleRatingChange = useCallback((rating: number) => {
    setLocalRating((prev) => (prev === rating ? 0 : rating));
  }, []);

  const handleApply = useCallback(() => {
    onFilterChange(localTags, localRating);
    setIsOpen(false);
  }, [localTags, localRating, onFilterChange]);

  const handleClearAll = useCallback(() => {
    setLocalTags([]);
    setLocalRating(0);
    onFilterChange([], 0);
    setIsOpen(false);
  }, [onFilterChange]);

  const handleRemoveTag = useCallback(
    (tagId: number, e: React.MouseEvent) => {
      e.stopPropagation();
      const newTags = localTags.filter((id) => id !== tagId);
      setLocalTags(newTags);
      onFilterChange(newTags, localRating);
    },
    [localTags, localRating, onFilterChange]
  );

  const handleRemoveRating = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setLocalRating(0);
      onFilterChange(localTags, 0);
    },
    [localTags, localRating, onFilterChange]
  );

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setLocalTags(activeTags);
    setLocalRating(activeRating);
  }, [activeTags, activeRating]);

  const handleOpen = useCallback(() => {
    setLocalTags(activeTags);
    setLocalRating(activeRating);
    setIsOpen(true);
  }, [activeTags, activeRating]);

  const activeTagObjects = allTags.filter((t) => activeTags.includes(t.id));
  const hasActiveFilters = activeTags.length > 0 || activeRating > 0;

  return (
    <>
      {/* Filter toggle button */}
      <button
        onClick={handleOpen}
        className={`relative flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
          hasActiveFilters
            ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
            : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        }`}
      >
        <span>⚙️</span>
        <span>Filter</span>
        {hasActiveFilters && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-xs text-white">
            {activeTags.length + (activeRating > 0 ? 1 : 0)}
          </span>
        )}
      </button>

      {/* Filter panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={handleClose}
          />

          {/* Panel */}
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Filter Media
              </h3>
              <button
                onClick={handleClose}
                className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            {/* Rating selector */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Minimum Rating
              </label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => handleRatingChange(star)}
                    className={`text-2xl transition ${
                      star <= localRating
                        ? "text-yellow-400"
                        : "text-zinc-300 dark:text-zinc-600 hover:text-yellow-200"
                    }`}
                    aria-label={`Minimum ${star} star${star !== 1 ? "s" : ""}`}
                  >
                    ★
                  </button>
                ))}
                {localRating > 0 && (
                  <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
                    ({localRating}+)
                  </span>
                )}
              </div>
            </div>

            {/* Tag checkboxes */}
            {allTags.length > 0 && (
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Tags
                </label>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
                  <div className="flex flex-wrap gap-2">
                    {allTags.map((tag) => (
                      <label
                        key={tag.id}
                        className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <input
                          type="checkbox"
                          checked={localTags.includes(tag.id)}
                          onChange={() => handleTagToggle(tag.id)}
                          className="h-4 w-4 rounded border-zinc-300 text-blue-500 focus:ring-blue-500 dark:border-zinc-600"
                        />
                        <span className="text-zinc-700 dark:text-zinc-300">
                          {tag.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between">
              <button
                onClick={handleClearAll}
                className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Clear All
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleClose}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Active filter pills */}
      {hasActiveFilters && !isOpen && (
        <div className="flex flex-wrap items-center gap-2">
          {activeTagObjects.map((tag) => (
            <span
              key={tag.id}
              className="flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            >
              {tag.name}
              <button
                onClick={(e) => handleRemoveTag(tag.id, e)}
                className="ml-0.5 hover:text-blue-900 dark:hover:text-blue-100"
                aria-label={`Remove ${tag.name} filter`}
              >
                ✕
              </button>
            </span>
          ))}
          {activeRating > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-yellow-100 px-3 py-1 text-sm text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300">
              <span>★ {activeRating}+</span>
              <button
                onClick={handleRemoveRating}
                className="ml-0.5 hover:text-yellow-900 dark:hover:text-yellow-100"
                aria-label="Remove rating filter"
              >
                ✕
              </button>
            </span>
          )}
          <button
            onClick={handleClearAll}
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Clear All
          </button>
        </div>
      )}
    </>
  );
}
