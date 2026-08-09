import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "deadlock-counterlock";
const isUserSite = repositoryName.endsWith(".github.io");
const basePath = isGitHubPages && !isUserSite ? `/${repositoryName}` : "";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: isGitHubPages,
  images: { unoptimized: isGitHubPages },
  // GitHub Pages is static-only; exclude the Steam URL resolver route there.
  pageExtensions: isGitHubPages ? ["tsx"] : undefined,
};

export default nextConfig;
