import type { NextConfig } from "next";

// On GitHub Pages the site lives at https://<username>.github.io/<repo-name>/, so every
// address needs a "/<repo-name>" prefix. The deploy workflow (.github/workflows/deploy.yml)
// sets PAGES_BASE_PATH; on your own computer it is empty and nothing changes.
const basePath = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export", // `npm run build` makes a plain static website in the `out` folder
  basePath,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath }, // lets our code find files in /public
};

export default nextConfig;
