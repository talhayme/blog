import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { absoluteUrl, site, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: `${site.title} — ${site.name}`, template: `%s · ${site.name}` },
  description: site.description,
  authors: [{ name: site.author, url: site.github }],
  openGraph: {
    type: "website",
    siteName: `${site.name} — notes`,
    title: site.title,
    description: site.description,
    url: siteUrl,
  },
  twitter: { card: "summary_large_image", title: site.title, description: site.description },
  alternates: {
    canonical: absoluteUrl("/"),
    types: { "application/rss+xml": absoluteUrl("/rss.xml") },
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
