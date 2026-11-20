/**
 * Loại cảnh báo vận hành (Story 4.6-b). Ba loại đầu trùng marker `alert` của dòng log `error` có sẵn ở mô-đun miền
 * (`PAYMENT_UNMATCHED_ALERT`, `PAYMENT_RECONCILIATION_STOPPED_ALERT`, `TICKET_QR_KEY_MISSING_ALERT`); hai loại kế do luật
 * pg-boss của job quét báo; hai loại kế do lưới an toàn định kỳ của `ordering` báo (Story 4.6-c); ba loại cuối là luật
 * nghiệp vụ (Story 4.6-e): hai loại vai api đếm trong bộ nhớ của tiến trình (IPN lỗi, p95 tạo link), một loại do luật của
 * `ordering` trong job quét báo (tỉ lệ phát Vé giảm). Ba loại nghiệp vụ có một subject cố định
 * (`OPS_ALERT_SYSTEM_SUBJECT`): một email mỗi `OPS_ALERT_COOLDOWN_MINUTES` cho cả hệ thống.
 */
export const OpsAlertKind = {
  /** Tiền về tài khoản của BTC mà không khớp Đơn nào của BTC (IPN hay Đối soát bù). Subject: id `payment_events`. */
  PAYMENT_UNMATCHED: 'payment_unmatched',
  /** Chuỗi Đối soát bù của một Đơn dừng (lỗi liên tiếp, key sai, không đọc được credential). Subject: mã Đơn. */
  PAYMENT_RECONCILIATION_STOPPED: 'payment_reconciliation_stopped',
  /**
   * `TICKET_QR_KEYS` của một instance thiếu khóa của Vé còn dùng: phát hiện lúc vai api hoặc worker khởi động (Story
   * 4.7-g), hoặc khi link chia sẻ Vé trả 404. Subject: `qrKeyVersion:currentVersion`.
   */
  TICKET_QR_KEY_MISSING: 'ticket_qr_key_missing',
  /** Queue pg-boss có job tới hạn mà chưa chạy quá `OPS_ALERT_QUEUE_WAIT_MINUTES`. Subject: tên queue. */
  QUEUE_BACKLOG: 'queue_backlog',
  /** Có job mới trong một queue `*.dead-letter`. Subject: id job (trong queue dead-letter). */
  DEAD_LETTER: 'dead_letter',
  /**
   * Lưới an toàn (`ordering.safety-sweep`) vừa cho hết hạn Đơn `pending` đã quá hạn hơn 2 phút mà job hết hạn chưa xử lý
   * (không được enqueue, lỗi đang retry, hoặc worker ngừng). Subject: mã Đơn.
   */
  PENDING_ORDER_OVERDUE: 'pending_order_overdue',
  /**
   * Đối chiếu tồn kho (`ordering.inventory-check`) thấy Hạng vé lệch. Subject:
   * `<ticketTypeId>:held=<held>/<tổng Vé của Đơn pending>:sold=<sold>/<số Vé đã phát>` (số liệu đổi thì là subject mới).
   */
  INVENTORY_DRIFT: 'inventory_drift',
  /**
   * Một instance api thấy từ `OPS_ALERT_IPN_FAILURES` IPN lỗi trong 5 phút (401 chữ ký/timestamp sai hay key cũ không
   * ràng được Đơn, 400 chữ ký đúng mà body hỏng, 5xx). Subject: `OPS_ALERT_SYSTEM_SUBJECT`.
   */
  IPN_FAILURES: 'ipn_failures',
  /**
   * Một instance api thấy p95 thời lượng `create_link` trong 5 phút vượt `OPS_ALERT_LINK_P95_MS` (khi có từ
   * `OPS_ALERT_LINK_MIN_SAMPLES` lần gọi). Subject: `OPS_ALERT_SYSTEM_SUBJECT`.
   */
  PAYMENT_LINK_SLOW: 'payment_link_slow',
  /**
   * Tỉ lệ Đơn có link được trả tiền (`paid_source`) trong khung 75 → 15 phút trước dưới `OPS_ALERT_ISSUANCE_RATIO` lần
   * tỉ lệ của cùng khung 7 ngày trước (luật `ordering` trong job quét). Subject: `OPS_ALERT_SYSTEM_SUBJECT`.
   */
  TICKET_ISSUANCE_DROP: 'ticket_issuance_drop',
} as const;
export type OpsAlertKind = (typeof OpsAlertKind)[keyof typeof OpsAlertKind];

export const OPS_ALERT_KIND_VALUES = Object.values(OpsAlertKind) as [OpsAlertKind, ...OpsAlertKind[]];

/**
 * Subject duy nhất của loại cảnh báo theo tỉ lệ toàn hệ thống (Story 4.6-e: `ipn_failures`, `payment_link_slow`,
 * `ticket_issuance_drop`): cùng `cooldown`, mỗi loại báo tối đa một email mỗi `OPS_ALERT_COOLDOWN_MINUTES`.
 */
export const OPS_ALERT_SYSTEM_SUBJECT = 'toan-he-thong';

/**
 * Kiểu chống lặp theo `(kind, subject)`:
 * - `once`: mỗi subject chỉ báo một lần (tới khi dấu bị xóa sau 30 ngày);
 * - `cooldown`: bỏ qua subject đã báo trong `OPS_ALERT_COOLDOWN_MINUTES`; instance vừa raise subject đó còn bỏ qua ngay
 *   trong bộ nhớ, không ghi DB.
 */
export type OpsAlertDedupe = 'once' | 'cooldown';

export interface OpsAlertKindSpec {
  /** Tiêu đề email: `[Tickee vận hành] <title>`; cũng là message của dòng log `error`. */
  title: string;
  /** Câu đầu của email: chuyện gì xảy ra và cần làm gì. */
  summary: string;
  /** Nhãn của danh sách subject trong email. */
  subjectLabel: string;
  dedupe: OpsAlertDedupe;
}

/** Danh mục loại cảnh báo vận hành: tiêu đề và kiểu chống lặp. */
export const OPS_ALERT_KINDS: Readonly<Record<OpsAlertKind, OpsAlertKindSpec>> = {
  payment_unmatched: {
    title: 'Tiền về không khớp Đơn',
    summary:
      'Tiền đã về tài khoản nhận tiền của BTC nhưng không khớp Đơn nào của BTC. Hệ thống đã tạo mục Cần xử lý "Giao dịch chưa khớp" cho BTC; kiểm tra giao dịch trên Tingee.',
    subjectLabel: 'Sự kiện thanh toán (payment_events)',
    dedupe: 'once',
  },
  payment_reconciliation_stopped: {
    title: 'Đối soát bù dừng',
    summary:
      'Đối soát bù đã dừng tra Tingee cho Đơn dưới đây. Đơn có thể đã được trả tiền mà chưa phát Vé; kiểm tra thanh toán của Đơn với Tingee.',
    subjectLabel: 'Mã Đơn',
    dedupe: 'once',
  },
  ticket_qr_key_missing: {
    title: 'Thiếu khóa Mã QR vé',
    summary:
      'TICKET_QR_KEYS của một instance api hoặc worker không có khóa của Vé còn dùng (xoay khóa sai, hoặc instance chưa có khóa mới khi deploy dần). Phát hiện lúc instance khởi động (chi tiết có số Vé bị ảnh hưởng), hoặc khi link chia sẻ Vé trả 404 (chi tiết có id Vé). Trên instance đó, Trang Đơn và Chi tiết Vé của các Vé này lỗi, link chia sẻ trả 404, email Vé vào dead-letter, check-in từ chối Mã QR vé. Kiểm tra TICKET_QR_KEYS của mọi instance và thêm lại khóa còn thiếu.',
    subjectLabel: 'Phiên bản khóa của Vé:phiên bản hiện hành của instance',
    dedupe: 'cooldown',
  },
  queue_backlog: {
    title: 'Hàng đợi bị ùn',
    summary:
      'Hàng đợi pg-boss có job đã tới hạn mà chưa chạy quá ngưỡng chờ. Kiểm tra worker (còn chạy không, có bị nghẽn không).',
    subjectLabel: 'Queue',
    dedupe: 'cooldown',
  },
  dead_letter: {
    title: 'Job vào dead-letter',
    summary: 'Job đã hết lượt retry và được chép sang queue dead-letter. Kiểm tra lỗi của job rồi xử lý hoặc chạy lại.',
    subjectLabel: 'Job (id trong queue dead-letter)',
    dedupe: 'once',
  },
  pending_order_overdue: {
    title: 'Đơn quá hạn hơn 2 phút chưa được job hết hạn xử lý',
    summary:
      'Đơn dưới đây còn giữ chỗ quá mốc hết hạn hơn 2 phút mà job hết hạn (ordering.expire-order) chưa xử lý. Nguyên nhân có thể: job không được enqueue, job lỗi đang retry, hoặc worker ngừng. Lưới an toàn đã cho Đơn hết hạn và nhả chỗ; kiểm tra job hết hạn Đơn (worker, hàng đợi, dead-letter).',
    subjectLabel: 'Mã Đơn',
    dedupe: 'once',
  },
  inventory_drift: {
    title: 'Tồn kho lệch',
    summary:
      'Số đang giữ (held) hoặc đã bán (sold) của Hạng vé dưới đây khác với tổng Vé của Đơn đang chờ hoặc số Vé đã phát. Hệ thống không tự sửa tồn kho; tìm nguyên nhân rồi sửa bằng tay.',
    subjectLabel: 'Hạng vé:held=<held>/<tổng Vé của Đơn pending>:sold=<sold>/<số Vé đã phát>',
    dedupe: 'once',
  },
  ipn_failures: {
    title: 'IPN lỗi tăng',
    summary:
      'Một instance api nhận nhiều IPN lỗi trong 5 phút: chữ ký hoặc timestamp sai (Tingee đổi cách ký, lệch đồng hồ, BTC đổi key), body đúng chữ ký mà sai dạng (Tingee đổi định dạng IPN), hoặc lỗi xử lý 5xx. Tingee sẽ gửi lại IPN lỗi; kiểm tra log của TingeeIpnController theo lý do dưới đây và đối chiếu với Tingee.',
    subjectLabel: 'Phạm vi',
    dedupe: 'cooldown',
  },
  payment_link_slow: {
    title: 'Tạo link thanh toán chậm',
    summary:
      'p95 thời gian gọi create-link của Tingee trong 5 phút gần nhất ở một instance api vượt ngưỡng: Người mua chờ lâu ở Checkout, có thể gặp lỗi hết thời gian. Kiểm tra tình trạng Tingee và mạng từ api tới Tingee.',
    subjectLabel: 'Phạm vi',
    dedupe: 'cooldown',
  },
  ticket_issuance_drop: {
    title: 'Tỉ lệ phát Vé giảm bất thường',
    summary:
      'Tỉ lệ Đơn có link thanh toán được trả tiền (IPN, Đối soát bù hay duyệt tay) trong khung 75 tới 15 phút trước giảm mạnh so với cùng khung 7 ngày trước. Kiểm tra IPN (lỗi, có tới không), Đối soát bù và trang thanh toán của Tingee.',
    subjectLabel: 'Phạm vi',
    dedupe: 'cooldown',
  },
};
