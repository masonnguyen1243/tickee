import type { NextConfig } from 'next';

import { assertBuildEnv } from './lib/build-env';

// Web chỉ render và gọi REST /v1 (AD-11): không driver DB. Secret duy nhất là `REVALIDATE_SECRET` (server-only, route
// `/api/revalidate` cho worker).
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // `next dev` không tự sinh AGENTS.md khi phát hiện AI agent; ngữ cảnh agent của repo quản lý ở gốc.
  agentRules: false,
};

// `next build` thiếu NEXT_PUBLIC_API_BASE_URL thì dừng ngay, không bao giờ ra (và bị turbo cache) bản build hỏng.
export default function config(phase: string): NextConfig {
  assertBuildEnv(phase, process.argv, process.env);
  return nextConfig;
}
