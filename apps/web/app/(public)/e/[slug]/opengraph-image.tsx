import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';

import { ErrorCode, EVENT_IMAGE_MAX_BYTES, formatEventTimeRange, type PublicEvent } from '@tickee/contracts';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';

import { hasErrorCode } from '@/lib/auth/api';
import { fetchPublicEvent } from '@/lib/event/public-api';

export const alt = 'Sự kiện trên Tickee';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Be Vietnam Pro (OFL, `assets/fonts/OFL.txt`): đủ dấu tiếng Việt. Đọc lần đầu cần dùng rồi giữ cho cả process; đọc
// lỗi thì bỏ cache để lần sau đọc lại (và lỗi đi qua handler, không thành unhandled rejection).
let fontsCache: Promise<[Buffer, Buffer]> | null = null;
function loadFonts(): Promise<[Buffer, Buffer]> {
  fontsCache ??= Promise.all([
    readFile(join(process.cwd(), 'assets/fonts/BeVietnamPro-Regular.ttf')),
    readFile(join(process.cwd(), 'assets/fonts/BeVietnamPro-Bold.ttf')),
  ]).catch((error: unknown) => {
    fontsCache = null;
    throw error;
  });
  return fontsCache;
}

// Màu lấy từ token "Rạp tối" (globals.css): stage, stage-fallback, primary (coral), stage-foreground, stage-muted.
const STAGE = '#1C1416';
const STAGE_FALLBACK = '#2A1D20';
const CORAL = '#FF4D6A';
const FOREGROUND = '#FFF7F8';
const MUTED = '#C9BDBF';

const GRADIENT = `radial-gradient(circle at 12% 8%, ${CORAL}99 0%, ${STAGE_FALLBACK}00 55%), linear-gradient(135deg, ${STAGE_FALLBACK} 0%, ${STAGE} 70%)`;
/**
 * Lớp tối phủ trên ảnh Sự kiện: nhẹ ở trên (giữ wordmark đọc được), đậm nhanh từ giữa xuống dưới nơi có tên, giờ và BTC
 * (tên dài 3 dòng bắt đầu ở khoảng 40% chiều cao).
 */
const SHADE =
  'linear-gradient(180deg, rgba(28,20,22,0.5) 0%, rgba(28,20,22,0.15) 22%, rgba(28,20,22,0.72) 45%, rgba(28,20,22,0.94) 75%)';
/** Bóng chữ khi nền là ảnh: giữ chữ đọc được trên vùng ảnh sáng. */
const TEXT_SHADOW = '0 2px 16px rgba(0,0,0,0.55)';

/** Tải ảnh Sự kiện tối đa chừng này mili giây; quá thì dùng bản gradient. */
const IMAGE_TIMEOUT_MS = 3_000;
/** Ảnh đọc từ storage là byte không tin cậy trên route công khai: chặn ảnh "bom điểm ảnh" dưới 5 MB. */
const MAX_INPUT_PIXELS = 40_000_000;
/** Chỉ giải mã đúng ba loại ảnh Sự kiện (theo nội dung file, không theo đuôi hay `content-type`). */
const IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp']);

/** Ghi lý do bỏ ảnh Sự kiện (vd. server web không tới được `S3_PUBLIC_BASE_URL`): chỉ host và lý do, không URL đầy đủ. */
function warnImageFallback(message: string, imageUrl: string, error: unknown): void {
  let host = '?';
  try {
    host = new URL(imageUrl).host;
  } catch {
    // URL lạ: vẫn ghi lý do.
  }
  console.warn(`[og-image] ${message}, dùng nền gradient`, {
    host,
    reason: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Tải byte ảnh bằng `node:http(s)`, không qua `fetch` của Next: không đưa ảnh vào data cache (giới hạn 2 MB/mục). Chỉ
 * nhận `200`; quá `maxBytes` (khai trong `content-length` hoặc đếm khi nhận) thì bỏ.
 */
function download(url: string, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request =
      target.protocol === 'https:' ? httpsRequest : target.protocol === 'http:' ? httpRequest : null;
    if (!request) {
      reject(new Error(`Giao thức không hỗ trợ: ${target.protocol}`));
      return;
    }
    const req = request(target, { method: 'GET', signal, headers: { accept: 'image/*' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Ảnh trả ${res.statusCode}`));
        return;
      }
      if (Number(res.headers['content-length']) > maxBytes) {
        req.destroy(new Error('Ảnh quá dung lượng'));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) req.destroy(new Error('Ảnh quá dung lượng'));
        else chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
      res.on('close', () => {
        if (!res.complete) reject(new Error('Ảnh tải dở'));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Ảnh Sự kiện làm nền ảnh OG: tải (3 giây, ≤ 5 MB), chỉ nhận JPEG/PNG/WebP tới `MAX_INPUT_PIXELS` điểm ảnh, `sharp` xoay
 * theo EXIF rồi phủ kín 1200×630 sang JPEG, trả data URI. Satori không tự tải được URL `localhost` (chặn SSRF) và `resvg`
 * không vẽ WebP, nên không đưa URL thẳng cho `ImageResponse`. Không có ảnh hay mọi lỗi → `null` (bản gradient).
 */
async function backgroundOf(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;
  try {
    const bytes = await download(imageUrl, EVENT_IMAGE_MAX_BYTES, AbortSignal.timeout(IMAGE_TIMEOUT_MS));
    const image = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS });
    const { format } = await image.metadata();
    if (!format || !IMAGE_FORMATS.has(format)) throw new Error(`Định dạng ảnh không nhận: ${format ?? 'không rõ'}`);
    const jpeg = await image
      .rotate()
      .resize(size.width, size.height, { fit: 'cover' })
      .jpeg({ quality: 82 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch (error) {
    warnImageFallback('Không dùng được ảnh Sự kiện', imageUrl, error);
    return null;
  }
}

/** Nội dung ảnh OG: tên, khoảng ngày-giờ, BTC trên ảnh Sự kiện (kèm lớp tối) hoặc nền stage gradient coral. */
function OgCard({ event, background }: { event: PublicEvent; background: string | null }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        color: FOREGROUND,
        fontFamily: 'Be Vietnam Pro',
        backgroundColor: STAGE,
        ...(background ? {} : { backgroundImage: GRADIENT }),
      }}
    >
      {background ? (
        <img
          src={background}
          alt=""
          width={size.width}
          height={size.height}
          style={{ position: 'absolute', top: 0, left: 0, width: size.width, height: size.height }}
        />
      ) : null}
      {background ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size.width,
            height: size.height,
            display: 'flex',
            backgroundImage: SHADE,
          }}
        />
      ) : null}
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          ...(background ? { textShadow: TEXT_SHADOW } : {}),
        }}
      >
        <div style={{ display: 'flex', fontSize: 36, fontWeight: 700, color: CORAL }}>Tickee</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              display: 'block',
              lineClamp: 3,
              fontSize: event.name.length > 60 ? 56 : 72,
              fontWeight: 700,
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
            }}
          >
            {event.name}
          </div>
          <div style={{ display: 'flex', fontSize: 32, color: FOREGROUND }}>
            {formatEventTimeRange(event.startsAt, event.endsAt)}
          </div>
          <div style={{ display: 'flex', fontSize: 28, color: MUTED }}>Tổ chức bởi {event.organizationName}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Ảnh chia sẻ 1200×630 của `/e/{slug}`: tên, khoảng ngày-giờ, BTC trên ảnh Sự kiện (Story 4.8-b) phủ kín khung với lớp
 * tối phía dưới; không có ảnh, ảnh lỗi hay quá 3 giây → nền stage gradient coral như trước. Ảnh không bao giờ làm route
 * trả 500: bản có ảnh được dựng trọn trước khi trả, dựng lỗi thì trả bản gradient.
 */
export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let event;
  try {
    event = await fetchPublicEvent(slug);
  } catch (error) {
    if (hasErrorCode(error, ErrorCode.EVENT_NOT_FOUND)) return new Response('Not found', { status: 404 });
    throw error;
  }
  const [[regular, bold], background] = await Promise.all([loadFonts(), backgroundOf(event.imageUrl)]);
  const options = {
    ...size,
    fonts: [
      { name: 'Be Vietnam Pro', data: regular, weight: 400 as const, style: 'normal' as const },
      { name: 'Be Vietnam Pro', data: bold, weight: 700 as const, style: 'normal' as const },
    ],
  };

  if (background) {
    try {
      const withImage = new ImageResponse(<OgCard event={event} background={background} />, options);
      const body = await withImage.arrayBuffer();
      return new Response(body, { status: withImage.status, headers: withImage.headers });
    } catch (error) {
      warnImageFallback('Dựng ảnh OG có ảnh Sự kiện lỗi', event.imageUrl ?? '', error);
    }
  }
  return new ImageResponse(<OgCard event={event} background={null} />, options);
}
