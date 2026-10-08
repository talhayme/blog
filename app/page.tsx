import Link from "next/link";
import { getAllPosts } from "@/lib/posts";
import { site } from "@/lib/site";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default function HomePage() {
  const posts = getAllPosts();

  return (
    <main className="max-w-5xl mx-auto px-6 pt-16">
      <section className="max-w-2xl mb-16">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4" style={{ letterSpacing: "-0.025em" }}>
          {site.title}
        </h1>
        <p className="text-lg leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          {site.description}
        </p>
      </section>

      {posts.length === 0 ? (
        <p style={{ color: "var(--fg-subtle)" }}>No posts yet.</p>
      ) : (
        <ul className="space-y-10 max-w-2xl">
          {posts.map((post) => (
            <li key={post.slug}>
              <article>
                <div className="flex items-center gap-3 text-xs mb-1.5" style={{ color: "var(--fg-subtle)" }}>
                  <time dateTime={post.date}>{formatDate(post.date)}</time>
                  <span>·</span>
                  <span>{post.readingMinutes} min read</span>
                  {post.draft && (
                    <span className="px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                      draft
                    </span>
                  )}
                </div>
                <h2 className="text-xl font-semibold tracking-tight mb-1.5">
                  <Link href={`/${post.slug}`} className="hover:underline" style={{ textUnderlineOffset: "3px" }}>
                    {post.title}
                  </Link>
                </h2>
                <p className="leading-relaxed mb-2" style={{ color: "var(--fg-muted)" }}>
                  {post.description}
                </p>
                <div className="flex flex-wrap gap-2">
                  {post.tags.map((tag) => (
                    <span key={tag} className="text-xs px-2 py-0.5 rounded-full"
                      style={{ border: "1px solid var(--border)", color: "var(--fg-subtle)" }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
