/** Hạn của URL upload (presigned PUT): 5 phút. */
export const PRESIGN_PUT_TTL_SECONDS = 300;

/** Một lệnh PUT cần ký: object `key` đúng `contentType` và đúng `contentLength` byte. */
export interface PresignPutInput {
  key: string;
  contentType: string;
  contentLength: number;
}

/** URL PUT đã ký và lúc nó hết hạn. */
export interface PresignedPut {
  url: string;
  expiresAt: Date;
}

/**
 * Cổng object storage dùng chung (AD-22): chỉ API S3 chuẩn, MinIO ở local. Api không tải, đọc hay proxy byte nào: trình
 * duyệt PUT thẳng lên storage bằng URL ký, và đọc ảnh qua URL công khai. Cả hai hàm tính tại chỗ, không gọi mạng.
 */
export interface ObjectStorage {
  /**
   * URL PUT ký SigV4 (query string), hạn `PRESIGN_PUT_TTL_SECONDS`. Header `content-type` và `content-length` nằm trong
   * chữ ký: PUT khác loại hoặc khác số byte đã khai thì storage từ chối.
   */
  presignPut(input: PresignPutInput): Promise<PresignedPut>;
  /** URL công khai (đọc ẩn danh) của object `key`. */
  publicUrlOf(key: string): string;
}

/** Token DI của `ObjectStorage`; test thay bằng `overrideProvider(OBJECT_STORAGE)` khi cần. */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
