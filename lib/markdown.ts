import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeStringify from "rehype-stringify";

export type TocEntry = { id: string; text: string; depth: 2 | 3 };

/**
 * Render markdown to HTML with syntax highlighting.
 *
 * Highlighting happens at build time via Shiki, so the published page ships
 * plain coloured HTML — no client-side highlighter, no flash of unstyled code.
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings as never, { behavior: "wrap", properties: { className: "heading-anchor" } })
    .use(rehypePrettyCode as never, {
      theme: { dark: "github-dark-dimmed", light: "github-light" },
      keepBackground: false,
    })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);

  return String(file);
}

/** Slug generation must match rehype-slug so the TOC links actually land. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Collect h2/h3 for the sidebar table of contents. */
export function extractToc(markdown: string): TocEntry[] {
  const toc: TocEntry[] = [];
  let inFence = false;

  for (const line of markdown.split("\n")) {
    // Headings inside code fences are code, not structure.
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;

    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;

    const text = match[2].replace(/[*_`]/g, "");
    toc.push({ id: slugify(text), text, depth: match[1].length as 2 | 3 });
  }
  return toc;
}
