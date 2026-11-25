import { formatVnTime } from '@tickee/contracts';

/*
 * Số check-in realtime (Story 5.7, FR-30, UX-DR39): câu chữ và hàm thuần của khối `checkin-progress` ở tab Check-in và
 * nhịp polling dùng chung với Màn quét. Kiểm bằng Vitest môi trường node; giờ luôn theo giờ Việt Nam (không theo múi giờ
 * máy).
 */

/** Polling khi SSE chưa kết nối (AD-17: 10 giây ở dashboard; Màn quét dùng cùng nhịp). */
export const CHECKIN_PROGRESS_POLL_MS = 10_000;

/** Chu kỳ polling của `CheckinEvent` khi SSE chưa kết nối: luôn 10 giây. */
export const checkinProgressPollInterval = (): number => CHECKIN_PROGRESS_POLL_MS;

/** Tiêu đề của khối (chỉ cho trình đọc màn hình: `stat-card` đã có nhãn "Check-in"). */
export const CHECKIN_PROGRESS_TITLE = 'Tiến độ check-in';

/** Nhãn của `stat-card` tổng. */
export const CHECKIN_PROGRESS_LABEL = 'Check-in';

/** Nhãn truy cập của thanh tổng (thanh của mỗi Hạng vé mang tên Hạng vé). */
export const CHECKIN_PROGRESS_TOTAL = 'Tổng đã check-in';

/** Dòng phụ của `stat-card` khi số liệu đang tự cập nhật. */
export const CHECKIN_PROGRESS_LIVE = 'Cập nhật liên tục';

/** Đang tải lần đầu (skeleton, chỉ cho trình đọc màn hình). */
export const CHECKIN_PROGRESS_LOADING = 'Đang tải số liệu check-in';

/** Tiêu đề `StatusBanner` khi tải lần đầu lỗi. */
export const CHECKIN_PROGRESS_LOAD_FAILED = 'Chưa tải được số liệu check-in';

/** "k/N": số đã check-in trên số Vé hợp lệ. */
export const progressLabel = (checkedInCount: number, validTicketCount: number): string =>
  `${checkedInCount}/${validTicketCount}`;

/** Giá trị đọc cho trình đọc màn hình của một thanh (`aria-valuetext`): "k trên N Vé đã check-in". */
export const progressValueText = (checkedInCount: number, validTicketCount: number): string =>
  `${checkedInCount} trên ${validTicketCount} Vé đã check-in`;

/**
 * "HH:MM:SS" theo giờ Việt Nam. Giây không phụ thuộc múi giờ (+07:00 tròn giờ), nên lấy giây UTC ghép sau
 * `formatVnTime` (không dùng `Intl`).
 */
function vnTimeWithSeconds(value: number): string {
  return `${formatVnTime(value)}:${String(new Date(value).getUTCSeconds()).padStart(2, '0')}`;
}

/** Dòng phụ khi số liệu có thể đã cũ: "Cập nhật lúc HH:MM:SS" theo lần tải thành công gần nhất (giờ Việt Nam). */
export const checkinUpdatedAtLabel = (updatedAt: number): string => `Cập nhật lúc ${vnTimeWithSeconds(updatedAt)}`;

/**
 * Dòng phụ của `stat-card` tổng: "Cập nhật liên tục"; số liệu có thể đã cũ (`stale`: mất mạng, hoặc lần tải lại lỗi mà
 * vẫn còn dữ liệu cũ) → "Cập nhật lúc HH:MM:SS" theo `updatedAt`.
 */
export const checkinProgressCaption = ({ stale, updatedAt }: { stale: boolean; updatedAt: number }): string =>
  stale ? checkinUpdatedAtLabel(updatedAt) : CHECKIN_PROGRESS_LIVE;
