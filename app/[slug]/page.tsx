import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllPosts, getPost } from "@/lib/posts";
import { renderMarkdown, extractToc } from "@/lib/markdown";
import { absoluteUrl, site } from "@/lib/site";
import Toc from "@/components/Toc";

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: absoluteUrl(`/${post.slug}`) },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: absoluteUrl(`/${post.slug}`),
      publishedTime: post.date,
      authors: [site.author],
      tags: post.tags,
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const html = await renderMarkdown(post.content);
  const toc = extractToc(post.content);

  // Article schema helps search engines show the date and author.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    author: { "@type": "Person", name: site.author, url: site.github },
    mainEntityOfPage: absoluteUrl(`/${post.slug}`),
  };

  return (
    <main className="max-w-5xl mx-auto px-6 pt-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="lg:grid lg:grid-cols-[1fr_15rem] lg:gap-12">
        <article>
          <header className="mb-10">
            <Link href="/" className="text-sm hover:underline" style={{ color: "var(--fg-subtle)" }}>
              ← All posts
            </Link>
            <h1 className="text-3xl sm:text-[2.1rem] font-semibold tracking-tight mt-4 mb-3"
                style={{ letterSpacing: "-0.025em", lineHeight: 1.2 }}>
              {post.title}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm" style={{ color: "var(--fg-subtle)" }}>
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span>·</span>
              <span>{post.readingMinutes} min read</span>
            </div>
          </header>

          <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />

          <div className="mt-16 pt-8 max-w-2xl" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              Written by <strong>{site.author}</strong> — AI engineer working on LLM products in
              production: RAG, MCP servers, evaluation and reliability.{" "}
              <a href={site.portfolio} className="underline" style={{ color: "var(--accent)" }}>Portfolio</a>
              {" · "}
              <a href={site.github} className="underline" style={{ color: "var(--accent)" }}>GitHub</a>
            </p>
          </div>
        </article>

        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <Toc entries={toc} />
          </div>
        </aside>
      </div>
    </main>
  );
}
