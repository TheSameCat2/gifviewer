"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface ContextMenuItem {
  label: string;
  icon?: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: false;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const adjustPosition = () => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let ax = 0;
      let ay = 0;
      if (rect.width > 0 && x + rect.width > vw) {
        ax = vw - rect.width - 8;
      }
      if (rect.height > 0 && y + rect.height > vh) {
        ay = vh - rect.height - 8;
      }
      if (ax !== 0 || ay !== 0) {
        el.style.transform = `translate(${ax}px, ${ay}px)`;
      }
    };

    adjustPosition();

    const handleResize = () => adjustPosition();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [x, y]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKey);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      className="fixed z-[100] min-w-[168px] rounded-xl border bg-popover py-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => {
        if ("separator" in item && item.separator) {
          return <Separator key={`sep-${i}`} className="my-1" />;
        }
        const entry = item as ContextMenuItem;
        return (
          <button
            key={i}
            type="button"
            onClick={() => {
              if (!entry.disabled) {
                entry.action();
                onClose();
              }
            }}
            disabled={entry.disabled}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
              entry.danger
                ? "text-destructive hover:bg-destructive/10"
                : "hover:bg-muted",
              entry.disabled && "cursor-not-allowed opacity-40"
            )}
          >
            {entry.icon && <span className="w-4 text-center text-xs">{entry.icon}</span>}
            <span>{entry.label}</span>
          </button>
        );
      })}
    </motion.div>
  );
}
