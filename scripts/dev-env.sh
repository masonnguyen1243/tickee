#!/bin/sh
# Giá trị local cho biến build của web, chỉ dùng cho các lệnh dev ở gốc repo (`pnpm typecheck`, `pnpm test`,
# `pnpm test:e2e`). Đặt trước khi gọi turbo để turbo băm giá trị vào hash của `@tickee/web#build`: cache không bao giờ
# trả lại bản build thiếu biến. Biến đã có trong shell thì giữ nguyên.
#
# Build để deploy (`pnpm build`, `pnpm turbo build`) không đi qua script này, nên phải tự đặt NEXT_PUBLIC_API_BASE_URL;
# thiếu thì `next build` dừng (apps/web/lib/build-env.ts).
set -eu

: "${NEXT_PUBLIC_API_BASE_URL:=http://localhost:3001}"
export NEXT_PUBLIC_API_BASE_URL

exec "$@"
