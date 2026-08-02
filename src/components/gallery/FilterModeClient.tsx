"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { motion } from "motion/react";
import { FilterBar } from "./FilterBar";
import { Button } from "@/components/ui/button";

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
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mb-4 rounded-xl border border-primary/20 bg-accent/60 p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-accent-foreground">Filter Mode</h3>
        <Button variant="ghost" size="xs" onClick={handleExitFilterMode}>
          Exit Filter Mode
        </Button>
      </div>
      <FilterBar
        folderId={folderId}
        allTags={allTags}
        activeTags={activeTags}
        activeRating={activeRating}
        onFilterChange={handleFilterChange}
      />
    </motion.div>
  );
}
