import type { NextConfig } from "next";

const rawApiUrl =
  process.env.API_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_URL?.trim() ||
  (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "");

const apiUrl = rawApiUrl ? rawApiUrl.replace(/\/+$/, "") : "";

const cspDirectives = [
  "default-src 'self'",
  apiUrl
    ? `connect-src 'self' ${apiUrl} https://api.mqcdn.com https://www.mapquestapi.com wss: ws:`
    : "connect-src 'self' https://api.mqcdn.com https://www.mapquestapi.com wss: ws:",

  // ✅ MapQuest JS added
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://api.mqcdn.com",

  // ✅ MapQuest CSS + tile fonts added
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.mqcdn.com",
  "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.mqcdn.com",

  "font-src 'self' https://fonts.gstatic.com https://api.mqcdn.com",

  // ✅ MapQuest map tiles are served from mqcdn.com subdomains
  "img-src 'self' data: blob: https: https://*.mqcdn.com",

  "media-src 'self' data: blob: https:",
  "frame-src 'self' https://aquarient-agentforce.my.site.com",
  "frame-ancestors 'self' https://aquarient-agentforce.my.site.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // ✅ worker-src needed for MapQuest internal web workers
  "worker-src 'self' blob:",
];

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: cspDirectives.join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=()" },
  { key: "Cross-Origin-Embedder-Policy", value: "unsafe-none" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  async rewrites() {
    if (!apiUrl) return [];
    return [
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
      { source: "/health", destination: `${apiUrl}/health` },
    ];
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;