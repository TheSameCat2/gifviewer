"use client";

import { useState, useEffect } from "react";

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;

    const toggle = () => {
      setVisible(main.scrollTop > 200);
    };

    main.addEventListener("scroll", toggle, { passive: true });
    toggle();

    return () => main.removeEventListener("scroll", toggle);
  }, []);

  if (!visible) return null;

  const handleClick = () => {
    const main = document.querySelector("main");
    main?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      onClick={handleClick}
      className="fixed bottom-6 right-6 z-40 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-zinc-800 text-white shadow-lg transition hover:bg-zinc-700 active:scale-95 dark:bg-zinc-200 dark:text-zinc-800 dark:hover:bg-zinc-300"
      aria-label="Return to top"
      title="Return to top"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m18 15-6-6-6 6" />
      </svg>
    </button>
  );
}
