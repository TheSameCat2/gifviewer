"use client";

import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ListFilterIcon, StarIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

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
    [localTags, onFilterChange]
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open) {
        setLocalTags(activeTags);
        setLocalRating(activeRating);
      } else {
        setLocalTags(activeTags);
        setLocalRating(activeRating);
      }
    },
    [activeTags, activeRating]
  );

  const activeTagObjects = allTags.filter((t) => activeTags.includes(t.id));
  const hasActiveFilters = activeTags.length > 0 || activeRating > 0;
  const filterCount = activeTags.length + (activeRating > 0 ? 1 : 0);

  return (
    <>
      <Button
        onClick={() => handleOpenChange(true)}
        variant={hasActiveFilters ? "secondary" : "outline"}
        size="sm"
      >
        <ListFilterIcon data-icon="inline-start" />
        Filter
        {hasActiveFilters && (
          <Badge variant="default" className="ml-0.5 h-5 min-w-5 px-1">
            {filterCount}
          </Badge>
        )}
      </Button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Filter Media</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">Minimum Rating</p>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => handleRatingChange(star)}
                    className={cn(
                      "rounded p-0.5 transition-colors",
                      star <= localRating
                        ? "text-amber-400"
                        : "text-muted-foreground/40 hover:text-amber-300"
                    )}
                    aria-label={`Minimum ${star} star${star !== 1 ? "s" : ""}`}
                  >
                    <StarIcon
                      className="size-6"
                      fill={star <= localRating ? "currentColor" : "none"}
                    />
                  </button>
                ))}
                {localRating > 0 && (
                  <span className="ml-2 text-sm text-muted-foreground">
                    ({localRating}+)
                  </span>
                )}
              </div>
            </div>

            {allTags.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">Tags</p>
                <ScrollArea className="h-48 rounded-lg border">
                  <div className="flex flex-wrap gap-2 p-2">
                    {allTags.map((tag) => {
                      const checked = localTags.includes(tag.id);
                      return (
                        <label
                          key={tag.id}
                          className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => handleTagToggle(tag.id)}
                          />
                          <span>{tag.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>

          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={handleClearAll}>
              Clear All
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleApply}>Apply</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
        {hasActiveFilters && !isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex flex-wrap items-center gap-2"
          >
            {activeTagObjects.map((tag) => (
              <Badge key={tag.id} variant="secondary" className="gap-1 pr-1">
                {tag.name}
                <button
                  type="button"
                  onClick={(e) => handleRemoveTag(tag.id, e)}
                  className="rounded-full p-0.5 hover:bg-foreground/10"
                  aria-label={`Remove ${tag.name} filter`}
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
            {activeRating > 0 && (
              <Badge variant="outline" className="gap-1 border-amber-300/50 pr-1 text-amber-700 dark:text-amber-300">
                <StarIcon className="size-3" fill="currentColor" />
                {activeRating}+
                <button
                  type="button"
                  onClick={handleRemoveRating}
                  className="rounded-full p-0.5 hover:bg-foreground/10"
                  aria-label="Remove rating filter"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            )}
            <Button variant="ghost" size="xs" onClick={handleClearAll}>
              Clear All
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
