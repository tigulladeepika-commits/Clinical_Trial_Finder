import type { NextConfig } from "next";

const rawApiUrl =
  process.env.API_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_URL?.trim() ||
  (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "");

const apiUrl = rawApiUrl ? rawApiUrl.replace(/\/+$/, "") : "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  async rewrites() {
    if (!apiUrl) {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
      {
        source: "/health",
        destination: `${apiUrl}/health`,
      },
    ];
  },
};

export default nextConfig;
