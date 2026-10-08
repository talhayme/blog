import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
// Served from https://<user>.github.io/blog until a custom domain exists.
// Override with PAGES_BASE_PATH="" once the domain is in place.
const basePath = process.env.PAGES_BASE_PATH ?? (isProd ? "/blog" : "");

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_SITE_URL: process.env.SITE_URL ?? "https://talhayme.github.io",
  },
};

export default nextConfig;
