import {
  ErrorCode,
  EVENT_IMAGE_MAX_BYTES,
  EVENT_IMAGE_TYPES,
  EventImageRateLimitedDetails,
  EventImageUpload,
  eventImagesApiPath,
  type EventImageType,
} from '@tickee/contracts';

import { apiRequest } from '@/lib/api/client';
import { serviceUnavailableError } from '@/lib/api/errors';
import { hasErrorCode } from '@/lib/auth/api';

/*
 * Ảnh Sự kiện (Story 4.8-b): kiểm file tại chỗ, xin presigned PUT của api theo BTC (`POST /v1/orgs/:orgId/event-images`)
 * rồi `PUT` file thẳng lên object storage. Không crop, không nén, không resize: gửi nguyên file người dùng chọn.
 */

export const IMAGE_TYPE_ERROR = 'Chỉ nhận ảnh JPEG, PNG hoặc WebP.';
export const IMAGE_SIZE_ERROR = 'Ảnh tối đa 5 MB.';
/** PUT lên storage hoặc presign lỗi (mạng, 5xx…): kèm "Thử lại". */
export const IMAGE_UPLOAD_ERROR = 'Chưa tải được ảnh.';
/** Lưu Sự kiện bị từ chối ở trường `imageKey` (key sai dạng hoặc của BTC khác). */
export const IMAGE_REJECTED_ERROR = 'Ảnh không hợp lệ. Chọn lại ảnh.';

/**
 * Câu báo khi presign bị `429 EVENT_IMAGE_RATE_LIMITED` (Story 4.7-d): số phút chờ làm tròn lên, tối thiểu 1; từ 60
 * phút trở lên thì đổi ra giờ, làm tròn lên. `details` thiếu hoặc sai dạng → không nêu thời gian chờ.
 */
export function imageRateLimitedMessage(details: unknown): string {
  const parsed = EventImageRateLimitedDetails.safeParse(details);
  if (!parsed.success) return 'Bạn đã tải quá nhiều ảnh. Thử lại sau.';
  const minutes = Math.max(1, Math.ceil(parsed.data.retryAfterSeconds / 60));
  const wait = minutes < 60 ? `${minutes} phút` : `${Math.ceil(minutes / 60)} giờ`;
  return `Bạn đã tải quá nhiều ảnh. Thử lại sau ${wait}.`;
}

/**
 * Lỗi tại ô ảnh khi upload thất bại (presign hoặc PUT): presign bị giới hạn → `imageRateLimitedMessage`; còn lại →
 * `IMAGE_UPLOAD_ERROR`. Cả hai đều kèm "Thử lại".
 */
export const eventImageUploadErrorMessage = (error: unknown): string =>
  hasErrorCode(error, ErrorCode.EVENT_IMAGE_RATE_LIMITED) ? imageRateLimitedMessage(error.details) : IMAGE_UPLOAD_ERROR;

/** "Thử lại" PUT lại cùng URL nếu URL còn hạn ít nhất chừng này; không thì xin presign mới. */
export const UPLOAD_URL_REUSE_MARGIN_MS = 30_000;
/** Presign treo quá chừng này thì bỏ (lỗi như mất mạng, kèm "Thử lại"). */
export const PRESIGN_TIMEOUT_MS = 30_000;
/** PUT treo quá chừng này thì bỏ: đủ cho 5 MB trên mạng di động chậm. */
export const PUT_TIMEOUT_MS = 120_000;

/** `signal` của nơi gọi (hủy chủ động) gộp với hạn giờ `timeoutMs`. */
const withTimeout = (timeoutMs: number, signal?: AbortSignal): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);

const isEventImageType = (type: string): type is EventImageType =>
  (EVENT_IMAGE_TYPES as readonly string[]).includes(type);

/**
 * Lỗi của file trước khi gọi API: sai loại → `IMAGE_TYPE_ERROR`, quá 5 MB → `IMAGE_SIZE_ERROR`; hợp lệ → `null`. File rỗng
 * không phải ảnh nào trong ba loại nên báo như sai loại.
 */
export function eventImageFileError(file: { type: string; size: number }): string | null {
  if (!isEventImageType(file.type) || file.size < 1) return IMAGE_TYPE_ERROR;
  if (file.size > EVENT_IMAGE_MAX_BYTES) return IMAGE_SIZE_ERROR;
  return null;
}

/**
 * `PUT` lên storage thất bại. `upload` là presign còn dùng lại được cho "Thử lại" (lỗi mạng hoặc 5xx); `null` khi storage
 * từ chối chữ ký (4xx, vd. URL đã hết hạn): lần sau phải xin presign mới.
 */
export class EventImagePutError extends Error {
  override readonly name = 'EventImagePutError';
  readonly upload: EventImageUpload | null;
  /** HTTP status của storage; `null` khi không nhận được phản hồi. */
  readonly status: number | null;

  constructor(upload: EventImageUpload | null, status: number | null, options?: { cause?: unknown }) {
    super(status === null ? 'Không kết nối được object storage.' : `Object storage trả ${status}.`, options);
    this.upload = upload;
    this.status = status;
  }
}

/** Presign còn hạn đủ lâu để PUT lại cùng URL. */
export const isUploadUrlReusable = (upload: EventImageUpload, now: number): boolean =>
  Date.parse(upload.expiresAt) - now > UPLOAD_URL_REUSE_MARGIN_MS;

/**
 * Xin URL upload cho đúng loại và số byte của `file` (URL ký `content-type` và `content-length`). Quá `timeoutMs` →
 * `ApiError` `SERVICE_UNAVAILABLE` như mất mạng; hủy (`signal`) → ném lại lỗi hủy.
 */
export async function presignEventImage(
  orgId: string,
  file: File,
  signal?: AbortSignal,
  timeoutMs = PRESIGN_TIMEOUT_MS,
): Promise<EventImageUpload> {
  try {
    return await apiRequest(eventImagesApiPath(orgId), {
      schema: EventImageUpload,
      init: {
        method: 'POST',
        body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
        signal: withTimeout(timeoutMs, signal),
      },
    });
  } catch (error) {
    // `apiRequest` ném lại nguyên lỗi khi signal bị hủy: chỉ hủy của nơi gọi là hủy thật, còn lại là hết giờ.
    if (signal?.aborted || !(error instanceof Error) || error.name !== 'TimeoutError') throw error;
    throw serviceUnavailableError(error);
  }
}

/**
 * `PUT` nguyên file lên `uploadUrl`: URL tuyệt đối của storage (không qua api, không tiền tố `/v1`), không credentials,
 * `content-type` đúng loại đã khai lúc presign. Lỗi, kể cả quá `timeoutMs` → `EventImagePutError`; hủy (`signal`) → ném
 * lại lỗi hủy.
 */
export async function putEventImage(
  upload: EventImageUpload,
  file: File,
  signal?: AbortSignal,
  timeoutMs = PUT_TIMEOUT_MS,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(upload.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'content-type': file.type },
      credentials: 'omit',
      signal: withTimeout(timeoutMs, signal),
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new EventImagePutError(upload, null, { cause });
  }
  if (!res.ok) throw new EventImagePutError(res.status >= 500 ? upload : null, res.status);
}

export type UploadEventImageOptions = {
  /** Presign của lần thử trước với cùng file: còn hạn thì PUT lại cùng URL, không xin presign mới. */
  previous?: EventImageUpload | null;
  signal?: AbortSignal;
  /** Đồng hồ (ms) để xét hạn của `previous`; mặc định `Date.now()`. */
  now?: number;
  /** Hạn giờ của presign và PUT (test); mặc định `PRESIGN_TIMEOUT_MS`, `PUT_TIMEOUT_MS`. */
  timeouts?: { presignMs?: number; putMs?: number };
};

/**
 * Tải một ảnh Sự kiện lên storage: presign (trừ khi `previous` còn hạn) rồi PUT; trả presign đã dùng (`key` là giá trị gửi
 * làm `imageKey` khi lưu Sự kiện). Presign lỗi → `ApiError`; PUT lỗi → `EventImagePutError`.
 */
export async function uploadEventImage(
  orgId: string,
  file: File,
  { previous, signal, now = Date.now(), timeouts }: UploadEventImageOptions = {},
): Promise<EventImageUpload> {
  const upload =
    previous && isUploadUrlReusable(previous, now)
      ? previous
      : await presignEventImage(orgId, file, signal, timeouts?.presignMs);
  await putEventImage(upload, file, signal, timeouts?.putMs);
  return upload;
}
