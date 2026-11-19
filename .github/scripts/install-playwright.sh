#!/usr/bin/env bash
# Cài Chromium, WebKit của Playwright và thư viện hệ thống của chúng cho job `ci`.
#
# Thư viện hệ thống là khoảng 126 MB gói `.deb` tải bằng apt. Mirror Ubuntu có lúc mất 24 phút cho phần này, có lúc treo
# hẳn (run 44478845730 treo 52 phút ở `apt-get update`). Tải trình duyệt từ CDN của Playwright chỉ mất vài giây. Thứ tự:
#   1. Image đã đủ thư viện (kiểm offline bằng `install-deps --dry-run`): không cài gì.
#   2. Có gói `.deb` trong $DEB_DIR (cache khớp đúng khóa, hoặc khớp tiền tố từ image trước): cài từ đó, không gọi
#      mirror, rồi kiểm lại bằng `--dry-run`.
#   3. Còn lại: cài qua mirror, có timeout và thử lại. Chỉ chép các gói mà lượt cài này tải về vào $DEB_DIR.
# Ghi ra $GITHUB_OUTPUT: `save=true` khi bước sau nên lưu cache, tức cache không khớp đúng khóa và $DEB_DIR có gói.
# Env: PLAYWRIGHT_CACHE_EXACT=true khi cache khớp đúng khóa.
set -euo pipefail

DEB_DIR="$HOME/.cache/playwright-debs"
ARCHIVES=/var/cache/apt/archives
OUTPUT="${GITHUB_OUTPUT:-/dev/null}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
CHECK_LOG="${RUNNER_TEMP:-/tmp}/playwright-deps-check.log"

playwright() { pnpm --filter @tickee/web exec playwright "$@"; }

# apt mặc định không có timeout: mirror không trả byte nào thì chờ mãi. `Keep-Downloaded-Packages` giữ các gói trong
# $ARCHIVES để chép vào cache.
sudo tee /etc/apt/apt.conf.d/99tickee-ci >/dev/null <<'EOF'
Acquire::Retries "5";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
APT::Keep-Downloaded-Packages "true";
DPkg::Lock::Timeout "120";
EOF

# `apt-get install -s` của Playwright: không gọi mạng; còn thiếu gói (hoặc apt không tra được gói) thì mã khác 0.
deps_complete() {
  if playwright install-deps --dry-run chromium webkit >"$CHECK_LOG" 2>&1; then
    return 0
  fi
  grep -m1 -E 'Missing system dependencies|exited with code' "$CHECK_LOG" || true
  return 1
}

cached_debs() {
  shopt -s nullglob
  DEBS=("$DEB_DIR"/*.deb)
  shopt -u nullglob
}

install_from_cache() {
  cached_debs
  ((${#DEBS[@]} > 0)) || return 1
  echo "Cài ${#DEBS[@]} gói .deb từ cache, không gọi mirror"
  # `--no-download`: thiếu gói thì dừng trước khi cài. `-y` không cho hạ phiên bản: gói trong cache cũ hơn gói của image
  # (cache khớp tiền tố từ image trước) thì cũng dừng.
  if ! sudo apt-get install -y --no-install-recommends --no-download "${DEBS[@]}"; then
    return 1
  fi
  deps_complete
}

install_from_mirror() {
  local attempt
  for attempt in 1 2 3; do
    if playwright install-deps chromium webkit; then
      return 0
    fi
    if ((attempt < 3)); then
      echo "::warning::Lần ${attempt}/3 cài thư viện hệ thống cho Playwright lỗi (mirror apt), thử lại sau 10 giây"
      # Lượt lỗi có thể để apt/dpkg dở dang (gói chưa cấu hình, phụ thuộc thiếu).
      sudo apt-get -f install -y || true
      sleep 10
    fi
  done
  echo "::error::Cài thư viện hệ thống cho Playwright qua mirror apt lỗi cả 3 lần"
  return 1
}

started=$SECONDS
deps_source=mirror
if deps_complete; then
  deps_source=image
elif install_from_cache; then
  deps_source=cache
else
  cached_debs
  if ((${#DEBS[@]} > 0)); then
    if [[ "${PLAYWRIGHT_CACHE_EXACT:-}" == "true" ]]; then
      echo "::warning::Cache Playwright khớp đúng khóa nhưng cài từ cache lỗi. Tăng tiền tố v<n> của khóa ở ci.yml để lượt sau tạo cache mới"
    fi
    sudo apt-get -f install -y || true
  fi
  shopt -s nullglob
  before=("$ARCHIVES"/*.deb)
  shopt -u nullglob
  install_from_mirror
  # Chỉ giữ gói mà lượt cài này tải về: gói có sẵn trong $ARCHIVES từ trước không vào cache.
  declare -A existed=()
  for f in "${before[@]}"; do existed["$f"]=1; done
  rm -rf "$DEB_DIR"
  mkdir -p "$DEB_DIR"
  shopt -s nullglob
  for f in "$ARCHIVES"/*.deb; do
    [[ -n "${existed[$f]:-}" ]] || cp "$f" "$DEB_DIR"/
  done
  shopt -u nullglob
fi

cached_debs
message="Thư viện hệ thống cho Playwright: nguồn \`${deps_source}\`, $((SECONDS - started)) giây, ${#DEBS[@]} gói .deb trong cache"
echo "$message"
echo "$message" >>"$SUMMARY"
if [[ "$deps_source" != image && "${PLAYWRIGHT_CACHE_EXACT:-}" != "true" ]] && ((${#DEBS[@]} > 0)); then
  echo "save=true" >>"$OUTPUT"
else
  echo "save=false" >>"$OUTPUT"
fi

# Trình duyệt: có sẵn trong cache thì Playwright bỏ qua, không thì tải từ CDN (vài giây).
playwright install chromium webkit
