/**
 * Loại cảnh báo vận hành (Story 4.6-b). Ba loại đầu trùng marker `alert` của dòng log `error` có sẵn ở mô-đun miền
 * (`PAYMENT_UNMATCHED_ALERT`, `PAYMENT_RECONCILIATION_STOPPED_ALERT`, `TICKET_QR_KEY_MISSING_ALERT`); hai loại kế do luật
 * pg-boss của job quét báo; hai loại cuối do lưới an toàn định kỳ của `ordering` báo (Story 4.6-c). Story 4.6-e thêm loại
 * nghiệp vụ.
 */
export const OpsAlertKind = {
  /** Tiền về tài khoản của BTC mà không khớp Đơn nào của BTC (IPN hay Đối soát bù). Subject: id `payment_events`. */
  PAYMENT_UNMATCHED: 'payment_unmatched',
  /** Chuỗi Đối soát bù của một Đơn dừng (lỗi liên tiếp, key sai, không đọc được credential). Subject: mã Đơn. */
  PAYMENT_RECONCILIATION_STOPPED: 'payment_reconciliation_stopped',
  /** Link chia sẻ Vé trả 404 vì `TICKET_QR_KEYS` của instance thiếu khóa của Vé. Subject: `qrKeyVersion:currentVersion`. */
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
} as const;
export type OpsAlertKind = (typeof OpsAlertKind)[keyof typeof OpsAlertKind];

export const OPS_ALERT_KIND_VALUES = Object.values(OpsAlertKind) as [OpsAlertKind, ...OpsAlertKind[]];

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
      'Link chia sẻ Vé trả 404 vì TICKET_QR_KEYS của một instance api không có khóa của Vé (xoay khóa sai, hoặc instance chưa có khóa mới). Kiểm tra TICKET_QR_KEYS của mọi instance.',
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
};
