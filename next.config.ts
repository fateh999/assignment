import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  serverExternalPackages: ["ffmpeg-static", "sharp"],
  partialPrefetching: true,
};

export default nextConfig;
