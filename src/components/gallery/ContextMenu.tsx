"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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
  const [adjustedPos, setAdjustedPos] = useState({ x, y });

  // Adjust position to keep menu in viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let ax = x;
    let ay = y;
    if (rect.width > 0 && x + rect.width > vw) {
      ax = Math.max(0, vw - rect.width - 8);
    }
    if (rect.height > 0 && y + rect.height > vh) {
      ay = Math.max(0, vh - rect.height - 8);
    }
    setAdjustedPos({ x: ax, y: ay });
  }, [x, y]);

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Delay listener so the right-click that opened the menu doesn't immediately close it
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
    <div
      ref={ref}
      className="fixed z-[100] min-w-[160px] rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
    >
      {items.map((item, i) => {
        if ("separator" in item && item.separator) {
          return <hr key={`sep-${i}`} className="my-1 border-zinc-200 dark:border-zinc-700" />;
        }
        const entry = item as ContextMenuItem;
        return (
          <button
            key={i}
            onClick={() => {
              if (!entry.disabled) {
                entry.action();
                onClose();
              }
            }}
            disabled={entry.disabled}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
              entry.danger
                ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
            } ${entry.disabled ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {entry.icon && <span className="w-4 text-center">{entry.icon}</span>}
            <span>{entry.label}</span>
          </button>
        );
      })}
    </div>
  );
}
