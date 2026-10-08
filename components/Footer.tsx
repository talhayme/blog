import { site } from "@/lib/site";

export default function Footer() {
  return (
    <footer className="mt-24 py-10" style={{ borderTop: "1px solid var(--border)" }}>
      <div
        className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row gap-3 justify-between text-sm"
        style={{ color: "var(--fg-subtle)" }}
      >
        <span>© {new Date().getFullYear()} {site.name}</span>
        <span className="flex gap-4">
          <a href={site.portfolio} className="hover:underline">Portfolio</a>
          <a href={site.github} className="hover:underline">GitHub</a>
          <a href={site.telegram} className="hover:underline">Telegram</a>
          <a href="/rss.xml" className="hover:underline">RSS</a>
        </span>
      </div>
    </footer>
  );
}
