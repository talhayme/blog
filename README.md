# Notes on shipping LLM systems

Field notes from running LLM products in production. Built with Next.js
(static export), deployed to GitHub Pages.

## Writing a post

Add a markdown file to `posts/`:

```markdown
---
title: "Post title"
description: "One sentence shown in the list and in search results."
date: 2026-10-08
tags: [llm, production]
draft: false
---

Body in markdown. Code fences get syntax highlighting at build time.
```

`draft: true` keeps a post visible locally and out of the published build.
Reading time is computed from the word count; the table of contents is built
from the `##` and `###` headings.

## Local

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # static export into ./out
```

## Custom domain

Set `SITE_URL` and clear `PAGES_BASE_PATH` in the build environment —
canonical URLs, the sitemap and the RSS feed all follow `lib/site.ts`.
