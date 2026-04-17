"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { FilterBar } from "./FilterBar";

interface FilterModeClientProps {
  folderId: number;
  allTags: Array<{ id: number; name: string }>;
  activeTags: number[];
  activeRating: number;
  isFilterMode: boolean;
}

export function FilterModeClient({
  folderId,
  allTags,
  activeTags,
  activeRating,
  isFilterMode,
}: FilterModeClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleFilterChange = useCallback(
    (tags: number[], rating: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tags.length > 0) {
        params.set("tags", tags.join(","));
      } else {
        params.delete("tags");
      }
      if (rating > 0) {
        params.set("rating", String(rating));
      } else {
        params.delete("rating");
      }
      // Stay in filter mode
      if (!params.has("filter")) {
        params.set("filter", "1");
      }
      router.push(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const handleExitFilterMode = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("filter");
    params.delete("tags");
    params.delete("rating");
    router.push(`?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  if (!isFilterMode) {
    return null;
  }

  return (
    <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-blue-700 dark:text-blue-300">
          Filter Mode
        </h3>
        <button
          onClick={handleExitFilterMode}
          className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
        >
          Exit Filter Mode
        </button>
      </div>
      <FilterBar
        folderId={folderId}
        allTags={allTags}
        activeTags={activeTags}
        activeRating={activeRating}
        onFilterChange={handleFilterChange}
      />
    </div>
  );
}
