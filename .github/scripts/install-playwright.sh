#!/usr/bin/env bash
# Cài Chromium, WebKit của Playwright và thư viện hệ thống của chúng cho job `ci`.
#
# Thư viện hệ thống là khoảng 126 MB gói `.deb` tải bằng apt. Mirror Ubuntu có lúc mất 24 phút cho phần này, có lúc treo
# hẳn (run 44478845730 treo 52 phút ở `apt-get update`). Tải trình duyệt từ CDN của Playwright chỉ mất vài giây.
#   - Cache trúng (PLAYWRIGHT_CACHE_HIT=true): cài từ các file `.deb` trong $DEB_DIR, không gọi mirror.
#   - Cache trượt, hoặc cài từ cache lỗi: cài qua mirror, có timeout và thử lại. Khi cache trượt, chép các gói vừa tải
#     vào $DEB_DIR để bước sau lưu cache.
# Ghi ra $GITHUB_OUTPUT: `deps` = cache | mirror; `debs` = số gói đã chép (chỉ khi cache trượt).
set -euo pipefail

DEB_DIR="$HOME/.cache/playwright-debs"
OUTPUT="${GITHUB_OUTPUT:-/dev/null}"

playwright() { pnpm --filter @tickee/web exec playwright "$@"; }

# apt mặc định không có timeout: mirror không trả byte nào thì chờ mãi. `Keep-Downloaded-Packages` giữ các gói trong
# /var/cache/apt/archives để chép vào cache.
sudo tee /etc/apt/apt.conf.d/99tickee-ci >/dev/null <<'EOF'
Acquire::Retries "5";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
APT::Keep-Downloaded-Packages "true";
DPkg::Lock::Timeout "120";
EOF

install_from_cache() {
  shopt -s nullglob
  local debs=("$DEB_DIR"/*.deb)
  shopt -u nullglob
  if ((${#debs[@]} == 0)); then
    echo "::warning::Cache Playwright trúng nhưng không có gói .deb nào"
    return 1
  fi
  echo "Cài ${#debs[@]} gói .deb từ cache, không gọi mirror"
  # `--no-download`: thiếu gói nào thì dừng trước khi cài, không âm thầm tải từ mirror.
  sudo apt-get install -y --no-install-recommends --no-download "${debs[@]}"
}

install_from_mirror() {
  local attempt
  for attempt in 1 2 3; do
    if playwright install-deps chromium webkit; then
      return 0
    fi
    echo "::warning::Lần ${attempt}/3 cài thư viện hệ thống cho Playwright lỗi (mirror apt), thử lại"
    # Lượt lỗi có thể để dpkg dở dang; cấu hình nốt trước khi thử lại.
    sudo dpkg --configure -a || true
    sleep 10
  done
  return 1
}

if [[ "${PLAYWRIGHT_CACHE_HIT:-}" == "true" ]] && install_from_cache; then
  echo "deps=cache" >>"$OUTPUT"
else
  started=$SECONDS
  install_from_mirror
  echo "Cài thư viện hệ thống qua mirror mất $((SECONDS - started)) giây"
  rm -rf "$DEB_DIR"
  mkdir -p "$DEB_DIR"
  shopt -s nullglob
  downloaded=(/var/cache/apt/archives/*.deb)
  shopt -u nullglob
  if ((${#downloaded[@]} > 0)); then
    cp "${downloaded[@]}" "$DEB_DIR"/
  else
    echo "::warning::Không thấy gói .deb nào trong /var/cache/apt/archives, lượt sau vẫn phải tải từ mirror"
  fi
  echo "Giữ ${#downloaded[@]} gói .deb cho cache"
  {
    echo "deps=mirror"
    echo "debs=${#downloaded[@]}"
  } >>"$OUTPUT"
fi

# Trình duyệt: có sẵn trong cache thì Playwright bỏ qua, không thì tải từ CDN (vài giây).
playwright install chromium webkit
