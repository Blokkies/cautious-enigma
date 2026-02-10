/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for better-sqlite3 native module
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },

  // Allow local network access
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
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
