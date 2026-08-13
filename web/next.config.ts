import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The variant matrix is read at runtime, so it is not traced automatically.
  outputFileTracingIncludes: {
    "/api/**": ["./config/*.yaml", "../config/*.yaml"],
    "/api/audio/**": ["./demo/*"],
  },
};

export default nextConfig;
