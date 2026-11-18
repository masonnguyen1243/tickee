import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  PRESIGN_PUT_TTL_SECONDS,
  type ObjectStorage,
  type PresignedPut,
  type PresignPutInput,
} from './object-storage.js';

export interface S3StorageOptions {
  /** Endpoint S3 mà trình duyệt PUT tới, vd. `http://localhost:9000`. */
  endpoint: string;
  region: string;
  bucket: string;
  /** Không bao giờ log hai giá trị này. */
  accessKeyId: string;
  secretAccessKey: string;
  /** `true`: `<endpoint>/<bucket>/<key>` (MinIO); `false`: `<bucket>.<host>/<key>`. */
  forcePathStyle: boolean;
  /** Gốc URL công khai: `publicUrlOf(key)` = `<publicBaseUrl>/<key>`. */
  publicBaseUrl: string;
}

/** Header nằm trong chữ ký của URL PUT (presigner mặc định bỏ `content-type` ra ngoài chữ ký). */
const SIGNED_PUT_HEADERS = new Set(['content-type', 'content-length']);

/**
 * `ObjectStorage` trên S3 chuẩn (`@aws-sdk/client-s3` + presigner), không dùng tính năng riêng của nhà cung cấp nào.
 * Credential tĩnh từ env nên không có chuỗi tìm credential (IMDS…): ký URL không gọi mạng.
 */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly publicBaseUrl: string;

  constructor(private readonly options: S3StorageOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
      // Mặc định (`WHEN_SUPPORTED`) SDK thêm checksum CRC32 của body rỗng vào URL ký: PUT từ trình duyệt với file thật
      // không khớp checksum và bị từ chối. Chỉ tính checksum khi API bắt buộc (PutObject không bắt buộc).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, '');
  }

  async presignPut({ key, contentType, contentLength }: PresignPutInput): Promise<PresignedPut> {
    // SigV4 tính theo giây: làm tròn xuống để `expiresAt` đúng mốc storage dùng.
    const signingDate = new Date(Math.floor(Date.now() / 1000) * 1000);
    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: PRESIGN_PUT_TTL_SECONDS,
      signingDate,
      signableHeaders: SIGNED_PUT_HEADERS,
    });
    return { url, expiresAt: new Date(signingDate.getTime() + PRESIGN_PUT_TTL_SECONDS * 1000) };
  }

  publicUrlOf(key: string): string {
    return `${this.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  close(): void {
    this.client.destroy();
  }
}
