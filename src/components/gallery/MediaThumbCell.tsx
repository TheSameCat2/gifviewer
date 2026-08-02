"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { blurhashToDataUrl } from "@/lib/media/blurhash";

interface MediaThumbCellProps {
  id: number;
  filename: string;
  mimeType: string | null;
  blurhash: string | null;
  href: string;
  isCutSource?: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
  onNavigate?: () => void;
}

function canHaveMotion(mimeType: string | null): boolean {
  return mimeType === "image/gif" || mimeType === "video/webm";
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function BlurhashPlaceholder({ hash }: { hash: string }) {
  const dataUrl = (() => {
    try {
      return blurhashToDataUrl(hash, 32, 32);
    } catch {
      return null;
    }
  })();

  if (!dataUrl) {
    return <div className="absolute inset-0 animate-pulse bg-muted" />;
  }

  return (
    <div
      className="absolute inset-0"
      style={{
        backgroundImage: `url(${dataUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    />
  );
}

/**
 * Grid cell: static WebP first, optional short motion preview on hover/focus.
 * Motion never blocks first paint and never falls back to the original GIF/video.
 */
export function MediaThumbCell({
  id,
  filename,
  mimeType,
  blurhash,
  href,
  isCutSource = false,
  onContextMenu,
  onNavigate,
}: MediaThumbCellProps) {
  const motionCapable = canHaveMotion(mimeType);
  const [wantsMotion, setWantsMotion] = useState(false);
  const [motionSrc, setMotionSrc] = useState<string | null>(null);
  const [motionVisible, setMotionVisible] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  const staticSrc = `/api/thumbs/${id}?size=small`;

  useEffect(() => {
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!wantsMotion || !motionCapable || prefersReducedMotion()) return;
    if (motionSrc) return;

    let cancelled = false;
    attemptRef.current = 0;

    const tryLoad = () => {
      if (cancelled) return;
      const url = `/api/thumbs/${id}?variant=motion&t=${Date.now()}`;
      const img = new window.Image();
      img.onload = () => {
        if (cancelled) return;
        setMotionSrc(url);
        setMotionVisible(true);
      };
      img.onerror = () => {
        if (cancelled) return;
        // Preview may still be generating — retry a few times with backoff
        if (attemptRef.current < 4) {
          attemptRef.current += 1;
          retryTimer.current = setTimeout(tryLoad, 400 * attemptRef.current);
        }
      };
      img.src = url;
    };

    tryLoad();
    return () => {
      cancelled = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [wantsMotion, motionCapable, motionSrc, id]);

  const activateMotion = () => {
    if (!motionCapable || prefersReducedMotion()) return;
    setWantsMotion(true);
    if (motionSrc) setMotionVisible(true);
  };

  const deactivateMotion = () => {
    setMotionVisible(false);
  };

  return (
    <div
      data-media-id={id}
      className={`group relative flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-muted ${
        isCutSource ? "ring-2 ring-amber-400 opacity-60" : ""
      }`}
      onContextMenu={onContextMenu}
      onMouseEnter={activateMotion}
      onMouseLeave={deactivateMotion}
      onFocusCapture={activateMotion}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          deactivateMotion();
        }
      }}
    >
      <Link
        href={href}
        scroll={false}
        onClick={onNavigate}
        className="absolute inset-0"
      >
        {blurhash && <BlurhashPlaceholder hash={blurhash} />}

        <Image
          src={staticSrc}
          alt={filename}
          fill
          unoptimized
          sizes="(min-width: 1280px) 16vw, (min-width: 1024px) 20vw, (min-width: 768px) 25vw, 50vw"
          className="object-cover opacity-0 transition-opacity duration-300"
          onLoad={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.classList.remove("opacity-0");
            el.classList.add("opacity-100");
          }}
        />

        {motionSrc && motionVisible && (
          // eslint-disable-next-line @next/next/no-img-element -- animated webp preview; next/image not needed
          <img
            src={motionSrc}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-2 opacity-0 transition-opacity group-hover:opacity-100">
          <p className="truncate text-xs text-white">{filename}</p>
        </div>
      </Link>
    </div>
  );
}
