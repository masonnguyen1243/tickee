---
title: Tickee
status: final
created: 2026-10-27
updated: 2026-10-27
sources:
  - ../../prds/prd-tickee-2026-10-27/prd.md
  - ../../prds/prd-tickee-2026-10-27/addendum.md
  - .working/reference-sites.md
name: Tickee
description: Bán vé sự kiện nhỏ qua VietQR — hướng "Rạp tối" (Hướng D). shadcn/ui + Tailwind; DESIGN.md này chỉ định lớp thương hiệu (delta) trên nền shadcn, sáng/tối theo hệ thống.
colors:
  # --- Thương hiệu (dùng chung hai chế độ) ---
  brand: '#FF4D6A'              # coral — CHỈ đặt trên nền tối (stage / bar / page-dark / card-dark)
  on-brand: '#1F0A10'           # chữ mực trên nền coral; không bao giờ chữ trắng trên coral
  brand-text: '#CF2147'         # coral-700 — chữ thương hiệu trên nền sáng (page + card)
  brand-text-dark: '#FF4D6A'    # chữ thương hiệu ở dark mode
  brand-border: '#FF4D6A80'     # viền coral 50% (countdown-chip) — chỉ trên nền tối
  # --- Sân khấu (khối gần đen, có mặt ở cả light và dark) ---
  stage: '#1C1416'
  stage-foreground: '#FFF7F8'
  stage-muted: '#C9BDBF'
  stage-line: '#2A2023'
  bar: '#141012'                # thanh mua vé dính đáy, bottom tab bar
  stage-fallback: '#2A1D20'     # nền event-hero khi Sự kiện không có ảnh (dưới gradient coral mờ)
  # --- Light mode (map sang biến shadcn) ---
  page: '#F7F3F2'               # shadcn background
  card: '#FFFFFF'               # shadcn card / popover
  text: '#1C1917'               # shadcn foreground / card-foreground
  muted: '#5C5552'              # shadcn muted-foreground
  surface-sunken: '#F0EBEA'     # shadcn muted / secondary (nền stepper, badge neutral)
  line: '#EFE8E7'               # shadcn border / input (đường chia trong thẻ, không viền thẻ)
  ring: '#CF2147'               # shadcn ring (focus) light
  # --- Dark mode ---
  page-dark: '#0B0809'
  card-dark: '#1C1416'
  text-dark: '#F5F2F2'
  muted-dark: '#A8A29E'
  surface-sunken-dark: '#2A2023'
  line-dark: '#2A2023'
  ring-dark: '#FF4D6A'
  # --- Trạng thái (badge, chữ trạng thái) ---
  success-text: '#3F5F4F'
  success-subtle: '#E8EFEA'
  warning-text: '#7A5320'
  warning-subtle: '#F5EDDC'
  danger-text: '#8F3F3F'        # chữ trạng thái danger (khác destructive — nền nút)
  danger-subtle: '#F5E6E4'
  neutral-text: '#5C5552'
  neutral-subtle: '#F0EBEA'
  success-text-dark: '#A3C4B2'
  success-subtle-dark: '#1A2621'
  warning-text-dark: '#E3C590'
  warning-subtle-dark: '#2A2318'
  danger-text-dark: '#E0A3A0'
  danger-subtle-dark: '#2E1B1B'
  neutral-text-dark: '#C9BDBF'
  neutral-subtle-dark: '#2A2023'
  destructive: '#B42318'        # nền nút phá hủy (cả hai chế độ)
  destructive-foreground: '#FFFFFF'
  # --- Kết quả quét (phủ toàn màn hình, giống nhau ở hai chế độ) ---
  scan-success: '#4A6B5A'
  scan-danger: '#8F3F3F'
  scan-foreground: '#FFFFFF'
  # --- QR ---
  qr-module: '#000000'
  qr-plate: '#FFFFFF'
typography:
  # Một họ font: Be Vietnam Pro (Google Fonts), fallback system-ui. Thay Geist mặc định của shadcn.
  display:
    fontFamily: 'Be Vietnam Pro'
    fontSize: 40px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline:
    fontFamily: 'Be Vietnam Pro'
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  title:
    fontFamily: 'Be Vietnam Pro'
    fontSize: 17px
    fontWeight: '700'
    lineHeight: '1.3'
  body:
    fontFamily: 'Be Vietnam Pro'
    fontSize: 15px
    fontWeight: '400'
    lineHeight: '1.5'
  input:
    fontFamily: 'Be Vietnam Pro'
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.4'
  label:
    fontFamily: 'Be Vietnam Pro'
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
  meta:
    fontFamily: 'Be Vietnam Pro'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.45'
  eyebrow:
    fontFamily: 'Be Vietnam Pro'
    fontSize: 13px
    fontWeight: '700'
    lineHeight: '1.3'
  button:
    fontFamily: 'Be Vietnam Pro'
    fontSize: 16px
    fontWeight: '700'
    lineHeight: '1'
  amount:
    fontFamily: 'Be Vietnam Pro'
    fontSize: 34px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  total:
    fontFamily: 'Be Vietnam Pro'
    fontSize: 19px
    fontWeight: '700'
    lineHeight: '1.2'
  scan-result:
    fontFamily: 'Be Vietnam Pro'
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.15'
  scan-detail:
    fontFamily: 'Be Vietnam Pro'
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.35'
  code:
    fontFamily: 'ui-monospace, SF Mono, Menlo, Consolas, monospace'
    fontSize: 15px
    fontWeight: '500'
    letterSpacing: 0.04em
rounded:
  sm: 10px       # nút con trong stepper
  md: 12px       # control: nút, input, icon button, khung ảnh trong stage
  lg: 18px       # thẻ, stage block, thẻ Hạng vé, thẻ QR + tấm QR
  xl: 20px       # thanh mua vé nổi, bottom sheet
  full: 9999px   # badge trạng thái, chip đếm ngược, avatar BTC
spacing:
  # Thang 4px của Tailwind kế thừa nguyên vẹn. Chỉ thêm token có tên:
  gutter-mobile: 16px
  card-padding: 14px
  stack: 10px          # khoảng giữa các thẻ Hạng vé / hàng danh sách
  section: 24px        # khoảng giữa các khối nội dung
  control-height: 50px # nút chính, nút phụ toàn chiều rộng
  stepper-button: 34px
  tab-bar-height: 64px
  sidebar-width: 256px
  content-max-buyer: 480px
  icon-button: 40px    # icon button, ô icon khiên, icon empty-state
  qr-plate-padding: 12px
components:
  button-primary:
    background: '{colors.brand}'
    foreground: '{colors.on-brand}'
    radius: '{rounded.md}'
    height: '{spacing.control-height}'
    typography: '{typography.button}'
    placement: 'chỉ trên stage, bar, dashboard-sidebar hoặc nền dark'
  button-primary-on-light:
    background: '{colors.stage}'
    foreground: '{colors.stage-foreground}'
    background-dark: '{colors.brand}'         # dark mode = button-primary (coral chỉ trên nền tối, chữ mực)
    foreground-dark: '{colors.on-brand}'
    radius: '{rounded.md}'
    height: '{spacing.control-height}'
    typography: '{typography.button}'
  button-secondary:
    background: '{colors.card}'
    background-dark: '{colors.card-dark}'
    foreground: '{colors.text}'
    foreground-dark: '{colors.text-dark}'
    radius: '{rounded.md}'
    height: '{spacing.control-height}'
  button-destructive:
    background: '{colors.destructive}'
    foreground: '{colors.destructive-foreground}'
    radius: '{rounded.md}'
  stage-block:
    background: '{colors.stage}'
    foreground: '{colors.stage-foreground}'
    muted: '{colors.stage-muted}'
    accent: '{colors.brand}'
    radius: '{rounded.lg}'
    padding: '{spacing.gutter-mobile}'
  event-hero:
    container: '{components.stage-block}'
    eyebrow: '{typography.eyebrow}'
    eyebrow-color: '{colors.brand}'
    title: '{typography.headline}'
    icon-color: '{colors.brand}'
  event-card:
    background: '{colors.card}'
    background-dark: '{colors.card-dark}'
    radius: '{rounded.lg}'
    padding: '{spacing.card-padding}'
  ticket-tier-row:
    background: '{colors.card}'
    background-dark: '{colors.card-dark}'
    radius: '{rounded.lg}'
    padding: '{spacing.card-padding}'
    name: '{typography.title}'
    availability: '{typography.label}'
    availability-low-color: '{colors.brand-text}'
  ticket-tier-row-unavailable:
    background: 'transparent'
    border: '1px dashed {colors.line}'
    foreground: '{colors.muted}'
  quantity-stepper:
    background: '{colors.surface-sunken}'
    background-dark: '{colors.surface-sunken-dark}'
    radius: '{rounded.md}'
    button-size: '{spacing.stepper-button}'
    button-radius: '{rounded.sm}'
    increment-background: '{colors.stage}'
    increment-foreground: '{colors.brand}'
  purchase-bar:
    background: '{colors.bar}'
    foreground: '{colors.stage-foreground}'
    muted: '{colors.stage-muted}'
    radius: '{rounded.xl}'
    total: '{typography.total}'
    action: '{components.button-primary}'
  payment-qr-card:
    container: '{components.stage-block}'
    amount: '{typography.amount}'
    plate: '{colors.qr-plate}'
    module: '{colors.qr-module}'
    plate-radius: '{rounded.lg}'
  countdown-chip:
    foreground: '{colors.brand}'
    border: '1px solid {colors.brand-border}'
    radius: '{rounded.full}'
    typography: '{typography.label}'
  recipient-trust-block:
    background: '{colors.card}'
    background-dark: '{colors.card-dark}'
    radius: '{rounded.lg}'
    divider: '{colors.line}'
    emphasis: '{typography.title}'
  reassurance-line:
    background: '{colors.stage}'
    foreground: '{colors.stage-foreground}'
    icon: '{colors.brand}'
    radius: '{rounded.lg}'
  ticket-card:
    background: '{colors.card}'
    background-dark: '{colors.card-dark}'
    radius: '{rounded.lg}'
    plate: '{colors.qr-plate}'
    module: '{colors.qr-module}'
  social-ticket-card:
    background: '{colors.stage}'
    foreground: '{colors.stage-foreground}'
    muted: '{colors.stage-muted}'
    accent: '{colors.brand}'
    radius: '{rounded.lg}'
    title: '{typography.headline}'
    eyebrow: '{typography.eyebrow}'
  order-card:
    background: '{colors.card}'
    background-dark: '{colors.card-dark}'
    radius: '{rounded.lg}'
    padding: '{spacing.card-padding}'
    title: '{typography.title}'
    meta: '{typography.meta}'
    amount: '{typography.label}'
    countdown: '{typography.label}'
    countdown-color: '{colors.brand-text}'
    countdown-color-dark: '{colors.brand-text-dark}'
    action: '{components.button-primary-on-light}'
  scan-result-success:
    background: '{colors.scan-success}'
    foreground: '{colors.scan-foreground}'
    headline: '{typography.scan-result}'
    detail: '{typography.scan-detail}'
  scan-result-danger:
    background: '{colors.scan-danger}'
    foreground: '{colors.scan-foreground}'
    headline: '{typography.scan-result}'
    detail: '{typography.scan-detail}'
  offline-banner:
    background: '{colors.warning-subtle}'
    background-dark: '{colors.warning-subtle-dark}'
    foreground: '{colors.warning-text}'
    foreground-dark: '{colors.warning-text-dark}'
  status-banner:
    radius: '{rounded.md}'
    padding: '{spacing.card-padding}'
    typography: '{typography.label}'
    detail: '{typography.meta}'
    icon-size: 20px
    success-background: '{colors.success-subtle}'
    success-background-dark: '{colors.success-subtle-dark}'
    success-foreground: '{colors.success-text}'
    success-foreground-dark: '{colors.success-text-dark}'
    warning-background: '{colors.warning-subtle}'
    warning-background-dark: '{colors.warning-subtle-dark}'
    warning-foreground: '{colors.warning-text}'
    warning-foreground-dark: '{colors.warning-text-dark}'
    danger-background: '{colors.danger-subtle}'
    danger-background-dark: '{colors.danger-subtle-dark}'
    danger-foreground: '{colors.danger-text}'
    danger-foreground-dark: '{colors.danger-text-dark}'
    neutral-background: '{colors.neutral-subtle}'
    neutral-background-dark: '{colors.neutral-subtle-dark}'
    neutral-foreground: '{colors.neutral-text}'
    neutral-foreground-dark: '{colors.neutral-text-dark}'
  bottom-tab-bar:
    background: '{colors.bar}'
    foreground: '{colors.stage-muted}'
    active: '{colors.brand}'
    height: '{spacing.tab-bar-height}'
  dashboard-sidebar:
    background: '{colors.stage}'
    foreground: '{colors.stage-foreground}'
    muted: '{colors.stage-muted}'
    active: '{colors.brand}'
    width: '{spacing.sidebar-width}'
  stat-card:
    container: '{components.stage-block}'
    value: '{typography.headline}'
  status-badge:
    radius: '{rounded.full}'
    typography: '{typography.label}'
  landing-hero:
    container: '{components.stage-block}'
    title: '{typography.display}'
    action: '{components.button-primary}'
  wizard-stepper:
    current-background: '{colors.stage}'
    current-foreground: '{colors.stage-foreground}'
    done: '{colors.success-text}'
    upcoming: '{colors.muted}'
  needs-action-row:
    background: '{colors.card}'
    background-dark: '{colors.card-dark}'
    radius: '{rounded.lg}'
    code: '{typography.code}'
    delta: '{colors.danger-text}'
  checkin-progress:
    track: '{colors.surface-sunken}'
    fill: '{colors.text}'
    fill-dark: '{colors.brand}'
  empty-state:
    icon-size: '{spacing.icon-button}'
    icon: '{colors.muted}'
    title: '{typography.title}'
    body: '{typography.body}'
  otp-input:
    background: '{colors.surface-sunken}'
    background-dark: '{colors.surface-sunken-dark}'
    radius: '{rounded.md}'
    focus: '{colors.ring}'
  scanner-viewport:
    frame-radius: '{rounded.lg}'
    label: '{typography.label}'
    action: '{components.button-secondary}'
  manual-lookup:
    input: '{typography.input}'
    name: '{typography.title}'
    meta: '{typography.meta}'
    action: '{components.button-primary-on-light}'
---

## Brand & Style

> Các mock trong `mockups/` chỉ để minh họa và được link tại từng mục. Khi mock và spine mâu thuẫn, **spine thắng**.

Tickee là cửa bán vé cho các BTC nhỏ — giải Pickleball phong trào, workshop, phòng trà, livehouse — và cho những người trẻ mua vé từ một link trong nhóm Zalo. Hướng thiết kế được chọn là **"Rạp tối" (Hướng D)**: ngay cả ở light mode, phần "sân khấu" đầu trang (thông tin Sự kiện, QR thanh toán) và thanh mua vé là khối gần đen, như đèn rạp vừa tắt trước giờ diễn. Nền trang ấm, thẻ trắng nổi bằng bóng mềm, không viền. Coral `#FF4D6A` chỉ xuất hiện trên nền tối nên trông như ánh đèn sân khấu, không như một mảng sơn.

Cảm giác chủ đạo là **dễ dùng**; cảm xúc phụ là hồi hộp nhẹ kiểu "tối nay đi chơi". Đơn giản, hợp người trẻ, ít màu mè: một màu thương hiệu, một họ font, và để ảnh/nội dung của BTC mang màu sắc riêng.

Ba bề mặt, cùng một bộ token:

- **Bề mặt Người mua** (trang Sự kiện, Checkout, QR thanh toán, Vé của tôi) và **landing BTC**: đậm chất "Rạp tối" — stage block đầu màn hình, thanh mua vé tối dính đáy, CTA coral.
- **Dashboard BTC**: **tiết chế hơn** — nền chủ yếu sáng/tối theo hệ thống; stage block chỉ dùng cho sidebar/header hoặc thẻ số liệu nổi bật. Không có stage block trang trí trong bảng Đơn hay form.
- **Màn quét của CTV**: theo cài đặt hệ thống (không ép tối); chỉ kết quả quét phủ toàn màn hình xanh/đỏ.

Tickee kế thừa shadcn/ui. DESIGN.md này chỉ định lớp thương hiệu: màu, font, bo góc, đổ bóng, và các component riêng của Tickee. Component shadcn dùng nguyên trạng nhận token qua biến CSS, không tùy biến thêm — danh sách ở § Components.

Chưa có logo; wordmark tạm "tickee" chữ thường weight 700, kèm một ô vuông coral xoay 45° (theo mock Hướng D). Tên "Tickee" là tên làm việc, chưa chốt (PRD). `[ASSUMPTION]` wordmark tạm cho tới khi có logo.

Tham chiếu hình ảnh: [Hướng D · Rạp tối](mockups/directions-2.html) — chỉ mục "Hướng D · Rạp tối" là hướng được chọn; gồm trang Sự kiện, QR thanh toán, trạng thái trấn an, sáng và tối.

## Colors

Bảng đầy đủ nằm trong frontmatter. Ánh xạ sang biến shadcn (`globals.css`, `:root` và `.dark` theo `prefers-color-scheme`):

| Biến shadcn | Light | Dark |
|---|---|---|
| `--background` | `{colors.page}` #F7F3F2 | `{colors.page-dark}` #0B0809 |
| `--foreground` | `{colors.text}` #1C1917 | `{colors.text-dark}` #F5F2F2 |
| `--card`, `--popover` | `{colors.card}` #FFFFFF | `{colors.card-dark}` #1C1416 |
| `--muted`, `--secondary` | `{colors.surface-sunken}` #F0EBEA | `{colors.surface-sunken-dark}` #2A2023 |
| `--muted-foreground` | `{colors.muted}` #5C5552 | `{colors.muted-dark}` #A8A29E |
| `--primary` | `{colors.brand}` #FF4D6A | `{colors.brand}` #FF4D6A |
| `--primary-foreground` | `{colors.on-brand}` #1F0A10 | `{colors.on-brand}` #1F0A10 |
| `--border`, `--input` | `{colors.line}` #EFE8E7 | `{colors.line-dark}` #2A2023 |
| `--ring` | `{colors.ring}` #CF2147 | `{colors.ring-dark}` #FF4D6A |
| `--destructive` | `{colors.destructive}` #B42318 | `{colors.destructive}` #B42318 |

Thêm biến riêng Tickee: `--stage`, `--stage-foreground`, `--stage-muted`, `--bar`, `--brand-text`, các cặp `--success/warning/danger/neutral-(text|subtle)`, `--scan-success`, `--scan-danger`.

**Câu chuyện từng màu**

- **Coral `{colors.brand}`** — ánh đèn sân khấu. Dùng cho: nền nút chính (`button-primary`), eyebrow và icon trong stage, chip đếm ngược, mục đang chọn của sidebar/tab bar. **Chỉ đặt trên nền tối** (`stage`, `bar`, `page-dark`, `card-dark`). Không dùng làm chữ hay nền nút trên nền sáng (không đạt AA — xem bảng tương phản).
- **Mực `{colors.on-brand}`** — chữ trên mọi nền coral. Không bao giờ chữ trắng trên coral (không đạt AA — xem bảng).
- **Coral-700 `{colors.brand-text}`** — khi cần chữ mang màu thương hiệu trên nền sáng ("Còn 3 vé" sắp hết, link "Chính sách hoàn vé", chấm "đang chờ thanh toán"). Đạt AA trên cả `card` trắng và `page` (xem bảng).
- **Stage `{colors.stage}` / Bar `{colors.bar}`** — khối gần đen có mặt ở cả hai chế độ: hero Sự kiện, thẻ QR thanh toán, dòng trấn an, thanh mua vé, sidebar dashboard, thẻ số liệu nổi bật, hero landing. Ở dark mode `stage` trùng màu `card-dark`; phân biệt bằng vị trí và nội dung, không cần khác màu.
- **Page / Card** — nền ấm `#F7F3F2` + thẻ trắng nổi bằng bóng. Dark: `#0B0809` + `#1C1416` (cách tạo chiều sâu: § Elevation & Depth).
- **Trạng thái (success / warning / danger / neutral)** — chỉ cho badge trạng thái, banner hệ thống và chữ trạng thái. Không dùng trang trí. Danger (#8F3F3F) là đỏ gạch trầm, đủ khác coral về sắc độ. Toàn bộ màu trạng thái được làm dịu (độ bão hòa thấp) theo yêu cầu "bớt sặc sỡ"; không bao giờ dùng coral để báo lỗi.
- **Scan success / danger** — hai màu phủ toàn màn hình cho kết quả quét. Giống nhau ở light mode và dark mode để CTV học một lần là nhớ. Luôn kèm chữ lớn và biểu tượng (✓ tròn / ✕ bát giác); kết quả đỏ kèm thêm âm thanh — không chỉ dựa vào màu. Vì màu dịu, xanh/đỏ khó phân biệt hơn khi liếc ngoài trời nên các tín hiệu này là bắt buộc. Minh họa: [Màu quét](mockups/scan-colors-2.html).
- **QR** — module đen `{colors.qr-module}` trên tấm trắng `{colors.qr-plate}` ở mọi chế độ (máy quét ngân hàng và camera cần tương phản tối đa, 21:1). Không bao giờ đảo màu QR ở dark mode.

**Bảng tương phản đã kiểm (WCAG 2.2 AA: chữ thường ≥ 4.5:1, chữ lớn/UI ≥ 3:1)**

| Chữ / phần tử | Nền | Tỉ lệ | Kết quả |
|---|---|---|---|
| `brand` #FF4D6A | `stage` #1C1416 | 5.62:1 | AA |
| `brand` #FF4D6A | `bar` #141012 | 5.86:1 | AA |
| `brand` #FF4D6A | `page-dark` #0B0809 | 6.19:1 | AA |
| `brand` #FF4D6A | `stage-line` #2A2023 | 4.91:1 | AA |
| `brand` #FF4D6A | `card` #FFFFFF / `page` #F7F3F2 | 3.22 / 2.92:1 | Không đạt AA — cấm |
| `#FFFFFF` (chữ trắng) | `brand` #FF4D6A | 3.22:1 | Không đạt AA — cấm |
| `on-brand` #1F0A10 | `brand` #FF4D6A | 5.88:1 | AA |
| `brand-text` #CF2147 | `card` #FFFFFF | 5.30:1 | AA |
| `brand-text` #CF2147 | `page` #F7F3F2 | 4.81:1 | AA (cũng đủ UI ≥ 3:1 cho chấm "đang chờ") |
| `stage-foreground` #FFF7F8 | `stage` #1C1416 (cả nền `button-primary-on-light`) | 17.15:1 | AAA |
| `stage-muted` #C9BDBF | `stage` #1C1416 | 9.92:1 | AAA |
| `stage-foreground` #FFF7F8 | `bar` #141012 | 17.90:1 | AAA |
| `stage-muted` #C9BDBF | `bar` #141012 | 10.35:1 | AAA |
| `text` #1C1917 | `page` / `card` | 15.87 / 17.49:1 | AAA |
| `muted` #5C5552 | `page` / `card` | 6.63 / 7.30:1 | AA |
| `muted` #5C5552 | `line` #EFE8E7 | 6.04:1 | AA |
| `text-dark` #F5F2F2 | `page-dark` / `card-dark` | 17.92 / 16.25:1 | AAA |
| `muted-dark` #A8A29E | `page-dark` / `card-dark` | 7.91 / 7.17:1 | AAA |
| `muted-dark` #A8A29E | `surface-sunken-dark` #2A2023 | 6.26:1 | AA |
| `button-primary-on-light` #1C1416 (cạnh nút) | `page` #F7F3F2 | 16.41:1 | UI ≥ 3:1 |
| `success-text` #3F5F4F | `success-subtle` #E8EFEA / `card` | 6.07 / 7.09:1 | AA |
| `warning-text` #7A5320 | `warning-subtle` #F5EDDC | 5.84:1 | AA |
| `danger-text` #8F3F3F | `danger-subtle` #F5E6E4 / `card` | 5.87 / 7.12:1 | AA |
| `neutral-text` #5C5552 | `neutral-subtle` #F0EBEA | 6.18:1 | AA |
| `success-text-dark` #A3C4B2 | `success-subtle-dark` #1A2621 / `card-dark` | 8.26 / 9.56:1 | AAA |
| `warning-text-dark` #E3C590 | `warning-subtle-dark` #2A2318 | 9.36:1 | AAA |
| `danger-text-dark` #E0A3A0 | `danger-subtle-dark` #2E1B1B / `card-dark` | 7.69 / 8.54:1 | AAA |
| `neutral-text-dark` #C9BDBF | `neutral-subtle-dark` #2A2023 | 8.66:1 | AAA |
| `destructive-foreground` #FFFFFF | `destructive` #B42318 | 6.57:1 | AA |
| `destructive` #B42318 (cạnh nút) | `card-dark` / `page-dark` | 2.75 / 3.03:1 | Dưới 3:1 trên `card-dark` — chấp nhận: nút nhận diện bằng nhãn chữ trắng (6.57:1), không dựa vào cạnh nền |
| `scan-foreground` #FFFFFF | `scan-success` #4A6B5A | 5.93:1 | AA |
| `scan-foreground` #FFFFFF | `scan-danger` #8F3F3F | 7.12:1 | AA |
| `scan-success` / `scan-danger` (khối phủ) | `page` #F7F3F2 | 5.38 / 6.46:1 | UI ≥ 3:1 |
| `ring` #CF2147 | `page` #F7F3F2 | 4.81:1 | UI ≥ 3:1 |
| `ring-dark` #FF4D6A | `page-dark` #0B0809 | 6.19:1 | UI ≥ 3:1 |
| `qr-module` #000000 | `qr-plate` #FFFFFF | 21:1 | — |

Ghi chú:

- `line` (#EFE8E7 trên #FFFFFF = 1.21:1) và `stage-line` (#2A2023 trên #1C1416 = 1.14:1) chỉ là đường chia trang trí, không mang thông tin — mọi control phải nhận diện được bằng chữ, nền hoặc bóng, không dựa vào đường viền này.
- Ô input dùng nền `surface-sunken`; khi focus thêm viền `{colors.ring}`.

## Typography

Một họ font: **Be Vietnam Pro** (Google Fonts, đủ dấu tiếng Việt), fallback `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Thay Geist mặc định của shadcn qua `--font-sans`. Tải các weight 400, 500, 700; `font-display: swap`.

| Vai trò | Token | Dùng ở |
|---|---|---|
| Display | `{typography.display}` | Tiêu đề hero landing BTC (desktop có thể lên 56px — `[ASSUMPTION]`) |
| Headline | `{typography.headline}` | Tên Sự kiện trong stage, tiêu đề trang dashboard, số liệu `stat-card` |
| Title | `{typography.title}` | Tiêu đề khối ("Chọn vé"), tên Hạng vé, tên người nhận trong trust block |
| Body | `{typography.body}` | Văn bản thường |
| Input | `{typography.input}` | Mọi ô nhập — 16px để Safari iOS không tự zoom |
| Label | `{typography.label}` | Nhãn form, badge, "Còn 12 vé", chip đếm ngược |
| Meta | `{typography.meta}` | Địa chỉ, ghi chú, dòng phụ |
| Eyebrow | `{typography.eyebrow}` | Danh mục trên tên Sự kiện ("Thể thao · Pickleball") |
| Button | `{typography.button}` | Nhãn nút |
| Amount | `{typography.amount}` | Số tiền trên thẻ QR thanh toán ("300.000đ") |
| Total | `{typography.total}` | Tổng tiền trên thanh mua vé |
| Scan result | `{typography.scan-result}` / `{typography.scan-detail}` | Kết quả quét toàn màn hình — đọc được bằng một cái liếc ở khoảng cách cánh tay |
| Code | `{typography.code}` | Mã Đơn, số tài khoản — luôn `tabular-nums` |

Quy tắc:

- Số tiền, đồng hồ đếm ngược, số Vé luôn `font-variant-numeric: tabular-nums`.
- Tiền định dạng VN, không phần thập phân: "300.000đ".
- Tiêu đề không viết hoa toàn bộ (giữ dữ liệu BTC như nhập).
- Không dùng weight dưới 400.
- Tên chủ tài khoản ngân hàng hiển thị đúng chữ in hoa như app ngân hàng ("NGUYEN VAN TUAN").

## Layout & Spacing

Thang 4px của Tailwind kế thừa nguyên vẹn. Token có tên trong frontmatter:

- `{spacing.gutter-mobile}` (16px) — lề trái/phải mọi bề mặt di động, padding stage.
- `{spacing.card-padding}` (14px) — padding trong thẻ, thẻ Hạng vé.
- `{spacing.stack}` (10px) — khoảng giữa các thẻ Hạng vé, hàng danh sách.
- `{spacing.section}` (24px) — giữa các khối ("Chọn vé", "Về sự kiện").
- `{spacing.control-height}` (50px) — nút chính/phụ toàn chiều rộng.

**Bề mặt Người mua**: một cột, mobile-first. Trang Sự kiện trên desktop (≥ `lg`): **2 cột** — trái ảnh bìa + mô tả, phải thẻ chọn vé dính khi cuộn (đã chốt). Checkout, QR thanh toán, Vé của tôi trên màn rộng: cột căn giữa tối đa `{spacing.content-max-buyer}` (480px) `[ASSUMPTION]`. Thanh mua vé nổi cách mép 10px, dính đáy, chừa `env(safe-area-inset-bottom)`.

**Dashboard BTC**: responsive đầy đủ. ≥ `lg` (1024px): `dashboard-sidebar` cố định `{spacing.sidebar-width}` + vùng nội dung. < `md` (768px): sidebar ẩn, thay bằng `bottom-tab-bar`. Khoảng `md–lg`: `[ASSUMPTION]` sidebar thu thành icon. Bảng Đơn ở < `md` chuyển thành danh sách thẻ.

**Màn quét CTV**: toàn màn hình, khung camera chiếm phần lớn; nút "Tra tay" và trạng thái nằm ở vùng ngón cái (nửa dưới).

**Landing BTC**: hero stage toàn chiều rộng, các section một cột trên mobile, lưới 2–3 cột trên desktop.

## Elevation & Depth

Light mode: thẻ trắng nổi trên nền ấm bằng **bóng mềm ấm, không viền**: `0 1px 2px rgba(60,20,30,.06), 0 8px 24px rgba(60,20,30,.08)` — dùng cho `card`, `ticket-tier-row`, `recipient-trust-block`, `ticket-card`, `button-secondary`, icon button. Stage block và thanh mua vé không cần bóng — độ tối đã là chiều sâu.

Dark mode: bỏ bóng (vô hình trên nền đen), thay bằng vòng 1px `{colors.stage-line}` (`box-shadow: 0 0 0 1px #2A2023`).

Lớp phủ (`Dialog`, `Sheet`) kế thừa shadcn. Kết quả quét là lớp trên cùng, che toàn bộ. Dashboard tiết chế: không dùng bóng để phân cấp nội dung; bảng và form phẳng trên `card`.

## Shapes

- `{rounded.lg}` (18px) — thẻ (card), stage block, thẻ Hạng vé, thẻ QR thanh toán và tấm QR trong thẻ, thẻ Vé.
- `{rounded.md}` (12px) — mọi control: nút, input, icon button `{spacing.icon-button}`, khung ảnh trong stage.
- `{rounded.sm}` (10px) — nút con trong `quantity-stepper`.
- `{rounded.xl}` (20px) — thanh mua vé nổi, bottom sheet.
- `{rounded.full}` — badge trạng thái, chip đếm ngược, avatar BTC.

Logic: thẻ mềm, control gọn hơn một bậc — mềm mại hợp người trẻ nhưng vẫn ra dáng công cụ. Hạng vé không bán được dùng viền **nét đứt** thay vì bóng — trông như "chỗ trống".

## Components

shadcn dùng nguyên trạng: `Dialog`, `Sheet`, `DropdownMenu`, `Tabs`, `Table`, `Input`, `Textarea`, `Select`, `RadioGroup`, `Checkbox`, `Switch`, `Sonner` (toast), `Skeleton`, `Tooltip`, `Avatar`, `Separator`. Các component dưới đây là lớp thương hiệu hoặc riêng Tickee, nhóm theo bề mặt (cùng tên nhóm với EXPERIENCE › Component Patterns). Component không có key frontmatter (`value-tile`, `google-signin-button`, `tickee-referral-line`, `needs-action-card`, `recent-orders-block`, CTA cuối landing) chỉ dùng token chung đã nêu tại chỗ.

### Dùng chung

#### Nút

- **button-primary** — nền `{colors.brand}`, chữ `{colors.on-brand}` (5.88:1), `{rounded.md}`, cao `{spacing.control-height}`, `{typography.button}`. Chỉ đặt trên stage, `purchase-bar`, `dashboard-sidebar`, hero landing, hoặc nền dark mode. Pressed: tối hơn 8% (`brightness(.92)`); disabled: opacity .45, không đổi màu chữ.
- **button-primary-on-light** — nút chính khi nằm trên nền sáng (form dashboard, Checkout light mode, Tra tay, `order-card`): nền `{colors.stage}`, chữ `{colors.stage-foreground}` (17.15:1). **Quy tắc chung cho dark mode:** mọi `button-primary-on-light` ở dark mode trở thành `button-primary` — nền `{colors.brand}`, chữ `{colors.on-brand}` (5.88:1) — vì nền stage trùng `card-dark` (1.0:1) và coral được phép trên nền tối. Áp dụng ở mọi nơi dùng component này, không cần ghi lại từng chỗ.
- **button-secondary** — nền `{colors.card}` + bóng mềm (dark mode: `{colors.card-dark}`; chiều sâu theo § Elevation & Depth), chữ `{colors.text}`, cùng kích thước. Ví dụ "Tải ảnh QR".
- **button-destructive** — `{colors.destructive}` / `{colors.destructive-foreground}` (6.57:1). Dùng cho "Hủy Sự kiện", "Từ chối", "Thu hồi".
- Ghost/link kế thừa shadcn; link mang màu thương hiệu trên nền sáng dùng `{colors.brand-text}` (đạt AA trên cả `card` và `page`).

#### stage-block

Khối gần đen `{colors.stage}`, chữ `{colors.stage-foreground}`, chữ phụ `{colors.stage-muted}`, điểm nhấn `{colors.brand}`, `{rounded.lg}`, padding `{spacing.gutter-mobile}`. Có thể chứa một vùng ảnh `{rounded.md}`. Là nền cho `event-hero`, `payment-qr-card`, `reassurance-line`, `stat-card`, `landing-hero`. Mỗi màn Người mua tối đa một stage block lớn; dashboard chỉ dùng stage cho sidebar/header và tối đa 1–2 `stat-card`.

#### event-card

Hàng Sự kiện trong danh sách Sự kiện của dashboard và lịch sử "Vé của tôi". Nền `{colors.card}`, `{rounded.lg}`, padding `{spacing.card-padding}`: thumbnail vuông 56px `{rounded.md}` · tên (`{typography.title}`) · ngày-giờ (`{typography.meta}`) · `status-badge` trạng thái Sự kiện bên phải. Dashboard thêm dòng số liệu nhỏ "Đã bán 48/80" (`{typography.meta}`). Không có thẻ khám phá công khai (không chợ vé).

#### status-badge

Pill `{rounded.full}`, padding 2px 10px, `{typography.label}`, luôn có chữ (không chỉ chấm màu). Ánh xạ tone:

| Thực thể | Trạng thái → tone |
|---|---|
| **Đơn** | Chờ thanh toán → warning · Đã thanh toán → success · Hết hạn → neutral · Cần xử lý → danger · Đã hủy → neutral · Đã hoàn tay → neutral |
| **Loại Cần xử lý** | "Lệch số tiền", "Thanh toán mồ côi", "Giao dịch chưa khớp" → danger (kèm tên loại) |
| **Vé** | Hợp lệ → success · Đã check-in → neutral · Đã hủy → danger |
| **Sự kiện** | Nháp → neutral · Đang mở bán → success · Đã kết thúc → neutral · Ẩn → warning · Đã hủy → danger · Bị khóa → danger · "Tạm ngừng bán" (thông báo) → warning |
| **Người mua — Đơn đang chờ** | "BTC đang kiểm tra thanh toán" → warning |
| **BTC** | "Chờ duyệt Closed Beta" → warning · Bị khóa → danger |
| **Tài khoản nhận tiền** | Đang liên kết → neutral · QR động → success · Chỉ QR tĩnh → warning · Liên kết thất bại → danger `[ASSUMPTION]` |

Tone dùng cặp `{colors.<tone>-text}` trên `{colors.<tone>-subtle}` (light mode) / `-dark` (dark mode). `[ASSUMPTION]` ánh xạ tone do distill đề xuất.

#### status-banner

Dải thông báo trạng thái rộng toàn cột nội dung — dùng cho banner trạng thái Sự kiện (trang Sự kiện) và banner hệ thống dashboard. `offline-banner` của Màn quét là một biến thể cố định riêng, không tính vào giới hạn chồng banner (tối đa 2).

- **Tone**: success / warning / danger / neutral — cùng cặp màu với `status-badge` (`{colors.<tone>-text}` trên `{colors.<tone>-subtle}`, dark mode `-dark`). Không bao giờ dùng coral.
- **Giải phẫu**: icon 20px bên trái (icon riêng theo tone: tích tròn · tam giác · bát giác · i tròn — hình khác nhau để không chỉ dựa vào màu) + tiêu đề `{typography.label}` + dòng phụ `{typography.meta}` (tùy chọn) + tối đa **một** nút hành động dạng link/ghost bên phải (mobile: xuống dòng dưới). `{rounded.md}`, padding `{spacing.card-padding}`, không bóng.
- **Nút đóng** (chỉ khi banner đóng được): icon button `{spacing.icon-button}` ở mép phải. Banner nào đóng được, cách chồng và thứ tự ưu tiên: EXPERIENCE › Component Patterns › Thứ tự ưu tiên `status-banner`.
- **Vị trí**: trang Sự kiện — ngay dưới `event-hero`, trên danh sách Hạng vé. Dashboard — đầu vùng nội dung, dưới tiêu đề trang, trên tabs Sự kiện; không đặt trong sidebar.

#### empty-state

Icon line `{spacing.icon-button}` `{colors.muted}`, một câu `{typography.title}`, một câu `{typography.body}` `{colors.muted}`, tối đa một nút.

#### Đăng nhập: google-signin-button, otp-input

- **google-signin-button** ("Tiếp tục với Google") — `button-secondary` toàn chiều rộng, logo Google bên trái theo hướng dẫn thương hiệu Google, nhãn `{typography.button}`; đặt trên ô email OTP, ngăn bằng `Separator` "hoặc".
- **otp-input** — 6 ô, chữ `{typography.input}` phóng lên cỡ chữ 20px, `{rounded.md}`, nền `{colors.surface-sunken}`; focus viền `{colors.ring}` 2px.

### Người mua

#### event-hero

Stage block đầu trang Sự kiện. Thứ tự: ảnh Sự kiện (nếu có; không có ảnh → nền gradient coral mờ trên `{colors.stage-fallback}` như mock) → eyebrow `{typography.eyebrow}` màu `{colors.brand}` → tên Sự kiện `{typography.headline}` → hàng icon + 2 dòng: ngày-giờ, địa điểm (icon `{colors.brand}`, dòng 1 weight 500, dòng 2 `{colors.stage-muted}`). Dưới stage: hàng BTC (avatar tròn nền stage chữ coral + "Ban tổ chức" + tên BTC). Banner trạng thái Sự kiện ("Tạm ngừng bán", Bị khóa, Ẩn, Đã hủy, Đã kết thúc) nằm ngay dưới stage, dùng `status-banner`.

#### ticket-tier-row, quantity-stepper

- **ticket-tier-row** — thẻ trắng `{rounded.lg}` + bóng. Trái: tên Hạng vé (`{typography.title}`, weight 700), mô tả (`{typography.meta}`, `{colors.muted}`), giá · tình trạng (`{typography.label}`). Phải: `quantity-stepper`.
- **Tình trạng chỗ** (FR-10, luôn hiện số chính xác): "Còn 12 vé" ở `{colors.muted}` weight 500; khi sắp hết (≤ 10 vé còn lại, đã chốt) — `{colors.brand-text}` weight 700. Dark mode: `{colors.brand-text-dark}`.
- **ticket-tier-row-unavailable** — "Hết vé", "Chưa mở bán", "Đã đóng bán": nền trong suốt, viền 1px nét đứt `{colors.line}`, tên và giá `{colors.muted}`, stepper ẩn, nhãn trạng thái thay chỗ stepper. "Chưa mở bán" kèm thời điểm mở (`{typography.meta}`).
- **quantity-stepper** — vỏ `{colors.surface-sunken}` `{rounded.md}` padding 3px; hai nút `{spacing.stepper-button}` (34px, ≥ 24px của WCAG 2.5.8) `{rounded.sm}`; số ở giữa tabular weight 700. Nút "+" khi kích hoạt: nền `{colors.stage}`, icon `{colors.brand}` (5.62:1). Nút "−" khi số lượng bằng 0 và "+" khi chạm giới hạn: opacity .45.
- Dưới danh sách: dòng ghi chú `{typography.meta}` "Tối đa 4 vé mỗi Đơn · Chính sách hoàn vé" (link `{colors.brand-text}`, đạt 4.81:1 trên `page`).

#### purchase-bar

Thanh mua vé dính đáy, nổi: nền `{colors.bar}`, `{rounded.xl}`, cách mép 10px. Trái: "Tổng · 2 vé" (`{typography.meta}`, `{colors.stage-muted}`) + "300.000đ" (`{typography.total}`, `{colors.stage-foreground}`). Phải: `button-primary` "Mua" rộng ~140px. Khi chưa chọn vé: hiện "Chọn vé để tiếp tục" `[ASSUMPTION]` và nút disabled. Dùng chung cho Checkout ("Tiếp tục"/"Gửi Đơn").

#### tickee-referral-line

Dòng giới thiệu Tickee (FR-36, Could) — cuối trang Sự kiện và email Vé: `{typography.meta}` `{colors.muted}` "Bán vé bằng Tickee · Tạo Sự kiện của bạn" kèm link `{colors.brand-text}` tới `/`; nội dung chữ là `[ASSUMPTION]`.

### Thanh toán & Vé

#### payment-qr-card

Thẻ QR thanh toán — trái tim màn thanh toán. Stage block căn giữa: nhãn "Quét bằng app ngân hàng để trả" (`{colors.stage-muted}`) → số tiền `{typography.amount}` → `countdown-chip` "Giữ chỗ còn 14:32" → tấm QR trắng `{colors.qr-plate}` `{rounded.lg}` padding `{spacing.qr-plate-padding}`, module đen → "Mã Đơn" + mã `{typography.code}`. (Với QR tĩnh: mã Đơn to hơn, kèm nút sao chép và hướng dẫn ghi nội dung chuyển khoản — FR-17.)

- **countdown-chip** — viền 1px `{colors.brand-border}` (coral 50%), chữ `{colors.brand}`, `{rounded.full}`, tabular. Không đổi sang đỏ khi sắp hết (tránh gây hoảng — giữ niềm tin).
- **recipient-trust-block** — thẻ trắng ngay dưới stage: icon khiên trong ô stage `{spacing.icon-button}` (icon coral) + "Tiền chuyển thẳng cho **CLB ABC**" (`{typography.title}`); các hàng khóa–giá trị cách nhau bằng đường chia `{colors.line}`: "Chủ tài khoản — NGUYEN VAN TUAN", "Ngân hàng — Vietcombank". Nhãn `{colors.muted}`, giá trị `{colors.text}` weight 500. Tên phải khớp đúng tên mà app ngân hàng sẽ hiển thị.
- **Trạng thái chờ** — dòng `{typography.meta}` "Đang chờ thanh toán — vé sẽ tự hiện khi BTC nhận được tiền." Chữ `{colors.muted}`; chấm 8px `{colors.brand-text}` #CF2147 (dark mode: `{colors.brand-text-dark}`). Không có ngoại lệ coral trên nền sáng (đã chốt).
- **reassurance-line** — khi đã chờ lâu (ngưỡng thời gian: xem EXPERIENCE): stage block `{rounded.lg}` padding 14px, icon coral, chữ `{colors.stage-foreground}` weight 500: "Nếu bạn đã chuyển, vé sẽ về trong vài phút — đừng chuyển lại."
- Nút: `button-primary` "Mở app ngân hàng" khi nằm trong vùng tối; `button-primary-on-light` khi đặt trên page sáng. `button-secondary` "Tải ảnh QR". Chân: "Tickee không giữ tiền của bạn · Chính sách hoàn vé".

#### ticket-card

Thẻ Vé (Mã QR vé) phải **khác hẳn** thẻ QR thanh toán (PRD §3) — Người mua không được nhầm, CTV không được nhận nhầm:

| | `payment-qr-card` (QR thanh toán) | `ticket-card` (Mã QR vé) |
|---|---|---|
| Nền khối | Stage tối | Thẻ sáng `{colors.card}` (dark mode: `{colors.card-dark}`) |
| Nhãn trên QR | "Quét bằng app ngân hàng để trả" + số tiền | "Mã QR vé · đưa cho CTV ở cổng" |
| Đi kèm | Đếm ngược, người nhận tiền | Tên Sự kiện, Hạng vé, "Vé 1/2", tên Người mua, ngày-giờ |
| Hình khối | Thẻ liền | Thẻ có đường xé nét đứt + hai khuyết bán nguyệt tách phần thông tin và phần QR (dáng cuống vé) |

`[ASSUMPTION]` hình dáng cuống vé và nhãn "Mã QR vé · đưa cho CTV ở cổng" do bước distill đề xuất (đã render trong mock Thành công nhưng chưa được duyệt riêng). Tấm QR trắng, module đen, luôn tối thiểu 200×200px để camera quét nhanh. Thẻ Vé đã check-in / Đã hủy: QR mờ (opacity .25) + `status-badge` phủ giữa. Nút "Chia sẻ Vé" (`button-secondary`).

Trên màn Thành công, `ticket-card` đầu tiên **chồng lên mép dưới stage block ~30px** — vị trí cuối của chuyển cảnh "thẻ Vé trượt lên từ sân khấu tối"; chữ phụ trong stage dùng `{colors.stage-muted}`. Bố cục màn: EXPERIENCE › State Patterns › QR thanh toán & sau thanh toán (Thành công).

Minh họa: [Thành công & Vé của tôi](mockups/key-success-ticket.html) (mục 1–2: màn Thành công, phân biệt QR thanh toán / Mã QR vé).

#### social-ticket-card

Ảnh chia sẻ Story (FR-25, Should) — ảnh tĩnh để Người mua đăng Story, **không bao giờ chứa Mã QR vé** hay bất kỳ thông tin nào dùng để check-in được (không mã Vé, không mã Đơn, không chữ ký — FR-25). Bố cục: nền `{colors.stage}` toàn khung (khác hẳn `ticket-card` sáng có QR) → ảnh Sự kiện (nếu có) bo `{rounded.lg}` ở nửa trên → eyebrow `{typography.eyebrow}` `{colors.brand}` → tên Sự kiện `{typography.headline}` `{colors.stage-foreground}` → ngày-giờ, địa điểm `{colors.stage-muted}` → Hạng vé → tên BTC → chân: wordmark "tickee" + dòng giới thiệu Tickee (FR-36). Không hiện tên Người mua `[ASSUMPTION]`. Khung ảnh 9:16 (1080×1920) `[ASSUMPTION]` — tỉ lệ Story; có cần thêm bản 1:1 hay không chưa quyết. Không có đường xé / khuyết cuống vé để không ai nhầm là Vé dùng được.

#### order-card

Thẻ cho Đơn chưa thành Vé — Chờ thanh toán, "BTC đang kiểm tra thanh toán", Đã hủy — trong nhóm "Đơn đang chờ" của Vé của tôi. Khác `event-card` (Sự kiện) và `ticket-card` (Vé, có QR): **không bao giờ có QR nào**. Nền `{colors.card}` (dark mode `{colors.card-dark}`) + bóng mềm, `{rounded.lg}`, padding `{spacing.card-padding}`. Hàng trên: tên Sự kiện `{typography.title}` + `status-badge` bên phải. Hàng giữa: ngày-giờ (`{typography.meta}`) · Hạng vé × số lượng (`{typography.meta}`) · số tiền (`{typography.label}`) · mã Đơn (`{typography.code}`). Hàng dưới theo trạng thái:

- **Chờ thanh toán** — "Giữ chỗ còn 08:12" `{typography.label}` tabular màu `{colors.brand-text}` (dark mode `{colors.brand-text-dark}`) + nút "Tiếp tục thanh toán" `button-primary-on-light` toàn chiều rộng.
- **"BTC đang kiểm tra thanh toán"** — badge warning; khối liên hệ BTC (tên BTC + kênh liên hệ `[ASSUMPTION]` — EXPERIENCE Open Questions #4) `{typography.meta}` `{colors.muted}`; không có nút chính.
- **Đã hủy** — badge neutral "Đã hủy"; dòng liên hệ BTC; thẻ mờ nhẹ (chữ `{colors.muted}`).

Minh họa: nhóm "Đơn đang chờ" của [Vé của tôi](mockups/key-success-ticket.html) (mục 3).

### Màn quét

#### scan-result-success, scan-result-danger

`scan-result-overlay` là **tên nhóm** cho hai key frontmatter `scan-result-success` và `scan-result-danger`. Phủ **toàn màn hình**, che camera:

- **scan-result-success** — nền `{colors.scan-success}`, chữ `{colors.scan-foreground}` (5.93:1). Icon dấu tích lớn (96px) + "Thành công" `{typography.scan-result}` + "Minh · Vé 2/2 · Đôi nam" `{typography.scan-detail}`.
- **scan-result-danger** — nền `{colors.scan-danger}`, chữ `{colors.scan-foreground}` (7.12:1). Icon dấu X lớn + tiêu đề `{typography.scan-result}`: "Đã check-in" (kèm "lúc 07:42 · bởi Hùng" ở `{typography.scan-detail}`) hoặc "Vé không hợp lệ" (kèm một dòng lý do ở `{typography.scan-detail}` ngay dưới tiêu đề, vd. "Vé của Sự kiện khác"). Nút "Chạm để quét tiếp" (chỉ ở kết quả đỏ) chữ trắng viền trắng ở vùng ngón cái.
- Hình dạng icon khác nhau (tích tròn vs X bát giác) để người mù màu phân biệt mà không cần màu.

Minh họa: [Màn quét — kết quả quét](mockups/key-checkin.html) (mục 1).

#### scanner-viewport, offline-banner, manual-lookup

- **scanner-viewport** — khung camera toàn chiều rộng, khung ngắm vuông bo `{rounded.lg}` viền trắng 3px; đỉnh màn: tên Sự kiện (`{typography.label}`) + số đã check-in; đáy: nút "Tra tay" (`button-secondary`, cao `{spacing.control-height}`).
- **offline-banner** — dải cố định trên cùng: nền `{colors.warning-subtle}` chữ `{colors.warning-text}` (5.84:1; dark mode 9.36:1), icon mất sóng: "Mất kết nối — chưa quét được". Khi camera tạm dừng: khung ngắm mờ 50% + dòng chữ trắng `{typography.meta}` căn giữa đáy khung "Camera tạm dừng · tự thử lại". Nút "Tra tay" vẫn hiện ở đáy màn.
- **manual-lookup** — `Sheet` từ dưới lên, tiêu đề "Tra tay" + nút đóng: ô tìm `{typography.input}` tự focus, có **nhãn hiển thị luôn** phía trên ô (`{typography.label}`) "SĐT hoặc email Người mua" (FR-29); nếu PM duyệt tìm theo tên/số cuối SĐT (`[ASSUMPTION]` — EXPERIENCE Open Questions #3), nhãn đổi thành "Tên, SĐT/email hoặc số cuối SĐT". Dòng đếm "N Vé khớp" `{typography.meta}`; mỗi kết quả là hàng: tên Người mua (`{typography.title}`), Hạng vé · "Vé 1/2" (`{typography.meta}`), `status-badge` (Hợp lệ / Đã check-in) + nút "Check-in" (`button-primary-on-light`). Hàng "Đã check-in" chỉ có badge, **không có nút "Check-in"**. Hàng kết quả không bao giờ hiện Mã QR vé hay SĐT.

Minh họa: [Màn quét — chờ, mất kết nối, Tra tay](mockups/key-checkin.html) (mục 2–4).

### Dashboard

#### dashboard-sidebar

Nền `{colors.stage}`, rộng `{spacing.sidebar-width}`. Đầu sidebar: **BTC switcher** (avatar + tên BTC + chevron, mở `DropdownMenu`). Nhóm mục cấp BTC: Sự kiện · Cần xử lý (badge số) · Token · Thành viên · Tài khoản nhận tiền · Cài đặt (các mục chỉ dành cho Owner bị ẩn với Admin). Mục thường `{colors.stage-muted}`, hover nền `{colors.stage-line}`, mục đang chọn chữ `{colors.stage-foreground}` weight 700 + thanh coral 3px bên trái + icon `{colors.brand}`. Vùng nội dung bên phải dùng `page`/`card` sáng–tối theo hệ thống. Tabs cấp Sự kiện (Tổng quan · Đơn · Hạng vé · Form mua · Check-in · Cài đặt) dùng shadcn `Tabs` nguyên trạng; tab đang chọn gạch chân `{colors.text}` 2px (không coral trên nền sáng).

#### bottom-tab-bar

Dashboard trên điện thoại. Nền `{colors.bar}`, cao `{spacing.tab-bar-height}` + safe-area, 4 mục: Sự kiện · Cần xử lý · Quét vé · Thêm. Icon 24px + nhãn `{typography.meta}`; mục thường `{colors.stage-muted}` (10.35:1), mục đang chọn `{colors.brand}` (5.86:1) + thanh chỉ báo 2px coral phía trên. "Cần xử lý" có badge số (nền `{colors.brand}`, chữ `{colors.on-brand}`). `[ASSUMPTION]` tab bar dùng nền tối `bar` (suy từ quy tắc "sân khấu chỉ cho sidebar/header").

#### stat-card

Thẻ số liệu nổi bật trên Tổng quan Sự kiện (doanh thu; check-in đã vào / tổng): stage block, nhãn `{typography.label}` `{colors.stage-muted}`, giá trị `{typography.headline}` `{colors.stage-foreground}` tabular, thanh tiến độ check-in nền `{colors.stage-line}` phần đã đầy `{colors.brand}`. Tối đa 1–2 stat-card tối mỗi màn; số liệu phụ dùng `card` sáng.

Khối phụ cạnh stat-card dùng `card` sáng phẳng (không stage): **needs-action-card** — nhãn `{typography.label}` `{colors.muted}`, giá trị `{colors.text}`, link `{colors.brand-text}`; **recent-orders-block** — tiêu đề `{typography.title}` + link `{colors.brand-text}` bên phải, `Table` với Mã Đơn `{typography.code}`, số tiền tabular căn phải, trạng thái `status-badge`. Bố cục và nội dung màn: EXPERIENCE › Component Patterns › Dashboard (Bố cục Tổng quan Sự kiện).

Minh họa: [Tổng quan Sự kiện](mockups/key-dashboard-event.html) (desktop sáng/tối, điện thoại với `bottom-tab-bar`).

#### wizard-stepper, needs-action-row, checkin-progress

- **wizard-stepper** (tạo Sự kiện 4 bước) — hàng 4 bước ở đầu form: số bước trong vòng tròn 28px; bước hiện tại nền `{colors.stage}` chữ `{colors.stage-foreground}`, bước xong dấu tích `{colors.success-text}`, bước sau `{colors.muted}`. Trên mobile thu thành "Bước 2/4 · Hạng vé".
- **needs-action-row** (hàng Cần xử lý) — thẻ `card`: `status-badge` loại + mã Đơn `{typography.code}` + Người mua + số tiền nhận/số tiền Đơn (chênh lệch tô `{colors.danger-text}`) + tên Sự kiện (ở cấp BTC) + các nút thao tác.
- **checkin-progress** — trong tab Check-in: tổng ở `stat-card`, từng Hạng vé là thanh tiến độ trên `card` (nền `{colors.surface-sunken}`, phần đầy `{colors.text}` ở light mode / `{colors.brand}` ở dark mode).

### Landing

- **landing-hero** — stage block toàn chiều rộng (không bo góc ở mobile, `{rounded.lg}` khi có lề ở desktop), tiêu đề `{typography.display}` `{colors.stage-foreground}` với một cụm từ nhấn `{colors.brand}`, câu phụ `{colors.stage-muted}`, `button-primary` "Đăng ký Closed Beta" (dẫn tới tạo Tài khoản Tickee — không có form đăng ký riêng) + nút phụ viền trắng. Bốn giá trị (tiền về thẳng tài khoản, phí thấp, tạo trong vài phút, tự khớp giao dịch) hiển thị ngay dưới tiêu đề dạng 4 `value-tile`.
- **value-tile** (4 ô giá trị landing) — trong stage: icon 24px `{colors.brand}` + một dòng `{typography.label}` `{colors.stage-foreground}`; lưới 2×2 trên mobile, 4 cột trên desktop; không nền riêng, không bóng `[ASSUMPTION]`.
- **CTA cuối landing** — section stage hẹp: một câu `{typography.headline}` + cùng `button-primary` "Đăng ký Closed Beta" như hero; không có ô nhập.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Coral `{colors.brand}` chỉ trên nền tối (stage, bar, dark mode); chữ thương hiệu trên nền sáng dùng `{colors.brand-text}` #CF2147 | Coral làm chữ, viền hay nền nút trên nền sáng (2.92–3.22:1 — không đạt AA) |
| Chữ mực `{colors.on-brand}` trên mọi nền coral | Chữ trắng trên coral |
| Tối đa một stage block lớn mỗi màn Người mua; dashboard chỉ dùng stage cho sidebar/header và tối đa 1–2 `stat-card` | Rải stage tối khắp dashboard, trong bảng hay form |
| Thẻ sáng nổi bằng bóng mềm ấm, không viền | Viền 1px quanh thẻ ở light mode; bóng ở dark mode |
| QR luôn module đen trên tấm trắng, mọi chế độ | Đảo màu QR ở dark mode hay đặt QR thẳng trên nền tối |
| QR thanh toán trong stage tối; Mã QR vé trong thẻ sáng dáng cuống vé | Hai loại QR trông giống nhau |
| Kết quả quét: màu + chữ lớn + hình icon khác nhau (+ âm thanh khi đỏ) | Báo kết quả chỉ bằng màu hay toast nhỏ |
| Badge trạng thái luôn có chữ | Chấm màu không chữ |
| Danger đỏ gạch `{colors.danger-text}` cho lỗi | Dùng coral thương hiệu để báo lỗi |
| Một họ font Be Vietnam Pro; số tiền và đếm ngược tabular | Font thứ hai, chữ hoa toàn bộ (trừ tên chủ tài khoản ngân hàng), weight < 400 |
| Ô nhập 16px | Ô nhập < 16px (Safari iOS tự zoom) |
| Đếm ngược giữ màu coral bình tĩnh | Đổi đồng hồ sang đỏ nhấp nháy khi sắp hết |

## Open Questions

1. **Logo** — chưa có; wordmark tạm.
2. **Social Ticket Card** — tỉ lệ 9:16 và có hiện tên Người mua hay không (`[ASSUMPTION]`).
3. **Token bóng đổ** — chuỗi bóng ở § Elevation & Depth đang là giá trị literal; cân nhắc đặt tên (`shadow-card`, `shadow-ring-dark`) khi spec định dạng hỗ trợ nhóm token bóng.
4. **Token hóa kích thước pixel lẻ** còn lại (padding 3px stepper, icon 96px, vòng 28px, thumbnail 56px) — hiện chỉ token hóa giá trị lặp (40px, 12px).

`[ASSUMPTION]` inline còn lại (mặc định UX, không chặn triển khai; chưa quyết thì giữ như ghi): Brand & Style — wordmark tạm · Typography — Display 56px desktop · Layout — cột 480px, sidebar thu icon ở `md–lg` · Components › Dùng chung — ánh xạ tone `status-badge`, tone "Liên kết thất bại" · Người mua — nhắc "Chọn vé để tiếp tục", copy `tickee-referral-line` · Thanh toán & Vé — dáng cuống vé + nhãn Mã QR vé, `social-ticket-card` 9:16 + không tên Người mua (#2), kênh liên hệ BTC trên `order-card` (EXPERIENCE Open Questions #4) · Màn quét — mở rộng tìm của `manual-lookup` (EXPERIENCE Open Questions #3) · Dashboard — nền `bar` cho `bottom-tab-bar` · Landing — `value-tile`.
