import { getAllPosts } from "@/lib/posts";
import { absoluteUrl, site } from "@/lib/site";

export const dynamic = "force-static";

/** Escape the five XML entities; an unescaped & breaks the whole feed. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const posts = getAllPosts();

  const items = posts
    .map((post) => `    <item>
      <title>${xmlEscape(post.title)}</title>
      <link>${absoluteUrl(`/${post.slug}`)}</link>
      <guid isPermaLink="true">${absoluteUrl(`/${post.slug}`)}</guid>
      <description>${xmlEscape(post.description)}</description>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
    </item>`)
    .join("\n");

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(`${site.title} — ${site.name}`)}</title>
    <link>${absoluteUrl("/")}</link>
    <description>${xmlEscape(site.description)}</description>
    <language>en</language>
    <atom:link href="${absoluteUrl("/rss.xml")}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(feed, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
