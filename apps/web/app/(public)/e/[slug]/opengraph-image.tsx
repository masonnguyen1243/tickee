import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ErrorCode, formatEventTimeRange } from '@tickee/contracts';
import { ImageResponse } from 'next/og';

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

/** Ảnh chia sẻ 1200×630 của `/e/{slug}`: tên, khoảng ngày-giờ, BTC trên nền stage với gradient coral. */
export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let event;
  try {
    event = await fetchPublicEvent(slug);
  } catch (error) {
    if (hasErrorCode(error, ErrorCode.EVENT_NOT_FOUND)) return new Response('Not found', { status: 404 });
    throw error;
  }
  const [regular, bold] = await loadFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          color: FOREGROUND,
          fontFamily: 'Be Vietnam Pro',
          backgroundColor: STAGE,
          backgroundImage: `radial-gradient(circle at 12% 8%, ${CORAL}99 0%, ${STAGE_FALLBACK}00 55%), linear-gradient(135deg, ${STAGE_FALLBACK} 0%, ${STAGE} 70%)`,
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
    ),
    {
      ...size,
      fonts: [
        { name: 'Be Vietnam Pro', data: regular, weight: 400, style: 'normal' },
        { name: 'Be Vietnam Pro', data: bold, weight: 700, style: 'normal' },
      ],
    },
  );
}
