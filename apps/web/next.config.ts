import type { NextConfig } from 'next';

// Web chỉ render và gọi REST /v1 (AD-11): không driver DB, không secret.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
