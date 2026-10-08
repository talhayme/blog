import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

/**
 * Posts are markdown files in /posts with YAML front matter. Keeping them as
 * files rather than a CMS means a post is a pull request: reviewable, diffable
 * and impossible to lose.
 */

export type PostMeta = {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  readingMinutes: number;
  draft: boolean;
};

export type Post = PostMeta & { content: string };

const POSTS_DIR = path.join(process.cwd(), "posts");

/** ~230 wpm is the usual estimate for technical prose. */
function estimateReadingMinutes(markdown: string): number {
  const words = markdown.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 230));
}

function parseFile(filename: string): Post {
  const slug = filename.replace(/\.md$/, "");
  const raw = fs.readFileSync(path.join(POSTS_DIR, filename), "utf8");
  const { data, content } = matter(raw);

  const missing = ["title", "description", "date"].filter((k) => !data[k]);
  if (missing.length) {
    // Fail the build rather than ship a post with an empty <title>.
    throw new Error(`${filename}: missing front matter field(s): ${missing.join(", ")}`);
  }

  return {
    slug,
    title: String(data.title),
    description: String(data.description),
    date: new Date(data.date).toISOString().slice(0, 10),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    readingMinutes: estimateReadingMinutes(content),
    draft: Boolean(data.draft),
    content,
  };
}

export function getAllPosts(): Post[] {
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map(parseFile)
    // Drafts are visible locally but never published.
    .filter((p) => !p.draft || process.env.NODE_ENV === "development")
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPost(slug: string): Post | undefined {
  return getAllPosts().find((p) => p.slug === slug);
}

export function getAllTags(): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const post of getAllPosts()) {
    for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
