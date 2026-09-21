import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The worker project one directory up also has its own package-lock.json;
  // without this Next.js guesses at a monorepo root instead of using this
  // folder, which is the only actual Next.js app here.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
