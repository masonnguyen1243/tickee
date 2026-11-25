import {
  formatVnTime,
  ScanCheckerRole,
  ScanInvalidReason,
  ScanOutcome,
  type ScanCheckedBy,
  type ScanResult,
} from '@tickee/contracts';

/*
 * Nội dung `scan-result-overlay` của Màn quét (Story 5.3, UX-DR30): `ScanResult` của api → màu, tiêu đề, dòng chi tiết,
 * âm thanh và thời gian tự đóng. Hàm thuần, kiểm bằng Vitest môi trường node; giờ "Đã check-in lúc HH:MM" luôn theo giờ
 * Việt Nam (không theo múi giờ máy).
 */

/** Nền của overlay: `scan-success` (xanh), `neutral-subtle` (trung tính), `scan-danger` (đỏ). */
export type ScanTone = 'success' | 'neutral' | 'danger';

/** Âm thanh khi overlay hiện: bíp nhẹ (xanh), cảnh báo (đỏ), `null` = im lặng. */
export type ScanSoundKind = 'success' | 'warning';

export type ScanView = {
  tone: ScanTone;
  /** Dòng lớn (`text-scan-result`). */
  title: string;
  /** Dòng dưới (`text-scan-detail`); `null` khi không có. */
  detail: string | null;
  sound: ScanSoundKind | null;
  /** Tự đóng sau chừng này mili giây; `null` = giữ tới khi chạm. */
  autoCloseMs: number | null;
};

/** Kết quả xanh và trung tính tự đóng sau ~1,5 giây. */
export const SCAN_AUTO_CLOSE_MS = 1500;

/** Dòng lý do của "Vé không hợp lệ". */
export const SCAN_INVALID_REASON_TEXT: Readonly<Record<ScanInvalidReason, string>> = {
  [ScanInvalidReason.BAD_SIGNATURE]: 'Mã QR vé không đúng',
  [ScanInvalidReason.CANCELLED]: 'Vé đã hủy',
  [ScanInvalidReason.VOIDED]: 'Vé bị vô hiệu',
  [ScanInvalidReason.OTHER_EVENT]: 'Vé của Sự kiện khác',
  [ScanInvalidReason.EVENT_ENDED]: 'Sự kiện đã kết thúc',
};

/** Người quét trước theo vai, khi tài khoản không có tên. */
const CHECKER_ROLE_TEXT: Readonly<Record<ScanCheckerRole, string>> = {
  [ScanCheckerRole.OWNER]: 'Owner',
  [ScanCheckerRole.ADMIN]: 'Admin',
  [ScanCheckerRole.CHECKER]: 'CTV khác',
};

/** "{người}" trong "bởi {người}": "bạn", tên, hoặc vai. Không bao giờ là email. */
export function checkedByText(checkedBy: ScanCheckedBy): string {
  switch (checkedBy.kind) {
    case 'self':
      return 'bạn';
    case 'name':
      return checkedBy.name;
    case 'role':
      return CHECKER_ROLE_TEXT[checkedBy.role];
  }
}

export function scanView(result: ScanResult): ScanView {
  switch (result.outcome) {
    case ScanOutcome.OK:
      return {
        tone: 'success',
        title: 'Thành công',
        // Bỏ phần rỗng để không ra " · Vé 1/2" khi bản chụp thiếu tên.
        detail: [result.holderName.trim(), `Vé ${result.seq}/${result.count}`, result.ticketTypeName.trim()]
          .filter(Boolean)
          .join(' · '),
        sound: 'success',
        autoCloseMs: SCAN_AUTO_CLOSE_MS,
      };
    case ScanOutcome.RECENT:
      return {
        tone: 'neutral',
        title: 'Bạn vừa check-in Vé này',
        detail: null,
        sound: null,
        autoCloseMs: SCAN_AUTO_CLOSE_MS,
      };
    case ScanOutcome.ALREADY:
      return {
        tone: 'danger',
        title: 'Đã check-in',
        detail: `lúc ${formatVnTime(result.checkedInAt)} · bởi ${checkedByText(result.checkedBy)}`,
        sound: 'warning',
        autoCloseMs: null,
      };
    case ScanOutcome.INVALID:
      return {
        tone: 'danger',
        title: 'Vé không hợp lệ',
        detail: SCAN_INVALID_REASON_TEXT[result.reason],
        sound: 'warning',
        autoCloseMs: null,
      };
  }
}
