import type { NextConfig } from 'next';

// Web chỉ render và gọi REST /v1 (AD-11): không driver DB. Secret duy nhất là `REVALIDATE_SECRET` (server-only, route
// `/api/revalidate` cho worker).
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // `next dev` không tự sinh AGENTS.md khi phát hiện AI agent; ngữ cảnh agent của repo quản lý ở gốc.
  agentRules: false,
};

export default nextConfig;
