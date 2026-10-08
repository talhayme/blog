import Link from "next/link";
import { site } from "@/lib/site";

export default function Header() {
  return (
    <header
      className="sticky top-0 z-40 backdrop-blur"
      style={{ background: "color-mix(in srgb, var(--bg) 85%, transparent)", borderBottom: "1px solid var(--border)" }}
    >
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="font-semibold tracking-tight">
          {site.name}
          <span style={{ color: "var(--fg-subtle)" }} className="font-normal"> / notes</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm" style={{ color: "var(--fg-muted)" }}>
          <Link href="/" className="hover:underline">Writing</Link>
          <a href={site.portfolio} className="hover:underline">Portfolio</a>
          <a href={site.github} className="hover:underline">GitHub</a>
        </nav>
      </div>
    </header>
  );
}
