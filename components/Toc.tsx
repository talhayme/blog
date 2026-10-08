"use client";

import { useEffect, useState } from "react";
import type { TocEntry } from "@/lib/markdown";

/**
 * Sidebar table of contents that highlights the section currently in view.
 *
 * Tracks headings with IntersectionObserver and degrades to a plain list of
 * links when the API is unavailable — the navigation still works, it just
 * stops following the scroll.
 */
export default function Toc({ entries }: { entries: TocEntry[] }) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((r) => r.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      // Focus on the upper third of the viewport: that is what the reader is on.
      { rootMargin: "-80px 0px -66% 0px", threshold: 0 }
    );

    for (const entry of entries) {
      const el = document.getElementById(entry.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [entries]);

  if (entries.length < 3) return null;

  return (
    <nav className="toc" aria-label="Table of contents">
      <div
        className="text-xs font-semibold uppercase tracking-wide mb-2 pl-3"
        style={{ color: "var(--fg-subtle)" }}
      >
        Contents
      </div>
      {entries.map((entry) => (
        <a
          key={entry.id}
          href={`#${entry.id}`}
          className={`${entry.depth === 3 ? "depth-3" : ""} ${activeId === entry.id ? "active" : ""}`}
        >
          {entry.text}
        </a>
      ))}
    </nav>
  );
}
