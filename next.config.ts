import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sean 統一技術棧 (saas-prototype-loop v1.1)
  // Next.js 15 + React 19 + TS + Tailwind 3 + lucide-react + Zustand
  reactStrictMode: true,

  // ptt-tracker 不需要 image domains (都本地 mock)
  images: {
    remotePatterns: [],
  },

  // 給 Vercel 部署用
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;