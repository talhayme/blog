"use client";

import { useEffect } from "react";

/**
 * Adds a copy button to every code block in the rendered article.
 *
 * The HTML comes from markdown at build time, so there is no React tree to
 * attach a button to — this walks the DOM once after mount and wraps each
 * <pre>. Doing it here rather than in a rehype plugin keeps the generated
 * HTML clean and the behaviour out of the build.
 */
export default function CodeCopy() {
  useEffect(() => {
    const blocks = document.querySelectorAll<HTMLPreElement>(".prose pre");
    const cleanups: (() => void)[] = [];

    blocks.forEach((pre) => {
      if (pre.parentElement?.classList.contains("code-wrap")) return;

      const wrap = document.createElement("div");
      wrap.className = "code-wrap";
      pre.parentNode?.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "code-copy";
      button.textContent = "copy";
      button.setAttribute("aria-label", "Copy code to clipboard");

      let resetTimer: ReturnType<typeof setTimeout> | undefined;

      const onClick = async () => {
        const code = pre.innerText;
        try {
          await navigator.clipboard.writeText(code);
          button.textContent = "copied";
          button.dataset.copied = "true";
        } catch {
          // Clipboard access can be denied (insecure context, permissions).
          // Say so instead of silently appearing to succeed.
          button.textContent = "press ⌘C";
        }
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          button.textContent = "copy";
          delete button.dataset.copied;
        }, 1800);
      };

      button.addEventListener("click", onClick);
      wrap.appendChild(button);

      cleanups.push(() => {
        clearTimeout(resetTimer);
        button.removeEventListener("click", onClick);
      });
    });

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
