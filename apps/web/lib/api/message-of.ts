import { ApiError } from './errors';

/** Câu báo chung khi lỗi không phải `ApiError` (lỗi lập trình, lỗi không rõ). */
export const GENERIC_ERROR = 'Đã có lỗi xảy ra. Vui lòng thử lại.';

/** Câu báo cho người dùng: lời của api khi là `ApiError`, câu chung trong mọi trường hợp khác. */
export const messageOf = (error: unknown): string => (error instanceof ApiError ? error.message : GENERIC_ERROR);
