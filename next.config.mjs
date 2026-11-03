/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    // Requests pass through src/proxy.ts, which buffers bodies up to this size (default
    // 10MB) and silently truncates the rest. Must be >= MAX_REQUEST_SIZE in
    // src/app/api/admin/import/limits.ts (50MB file + 5MB multipart overhead).
    proxyClientMaxBodySize: "55mb",
  },
  // CORS headers - restrict to same origin; override CORS_ORIGIN env var for local network access
  async headers() {
    const origin = process.env.CORS_ORIGIN || "";
    if (!origin) return []; // Same-origin only (no CORS headers needed)
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: origin },
          { key: "Access-Control-Allow-Credentials", value: "true" },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, PUT, DELETE, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
