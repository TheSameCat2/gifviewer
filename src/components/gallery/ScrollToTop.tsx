"use client";

import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const toggle = () => {
      setVisible(window.scrollY > 200);
    };

    window.addEventListener("scroll", toggle, { passive: true });
    toggle();

    return () => window.removeEventListener("scroll", toggle);
  }, []);

  const handleClick = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed bottom-6 right-6 z-40"
          initial={{ opacity: 0, y: 12, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 420, damping: 28 }}
        >
          <Button
            onClick={handleClick}
            size="icon-lg"
            variant="secondary"
            className="shadow-md"
            aria-label="Return to top"
            title="Return to top"
          >
            <ChevronUpIcon />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
