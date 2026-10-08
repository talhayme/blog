/**
 * Canonical location of the blog — the single place to change when a custom
 * domain arrives. A canonical URL pointing at a domain the page is not served
 * from tells crawlers the real copy lives elsewhere, so this must stay true.
 */
const FALLBACK_ORIGIN = "https://talhayme.github.io";

export const siteOrigin = (process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_ORIGIN).replace(/\/$/, "");
export const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
export const siteUrl = `${siteOrigin}${basePath}`;

export const site = {
  name: "Vitalii Bogachev",
  title: "Notes on shipping LLM systems",
  description:
    "Field notes from running LLM products in production: evaluation gates, provider fallback, retrieval that refuses to guess, and the incidents that taught me each one.",
  author: "Vitalii Bogachev",
  portfolio: "https://talhayme.github.io/portfolio-vitalii",
  github: "https://github.com/talhayme",
  telegram: "https://t.me/tenkuioo",
  email: "bogachev.vitaliy91test@gmail.com",
};

export function absoluteUrl(path = "/"): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${siteUrl}${suffix === "/" ? "/" : suffix}`;
}
