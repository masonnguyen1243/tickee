import {
  CalendarPlus,
  ClipboardCheck,
  Landmark,
  type LucideIcon,
  PiggyBank,
  QrCode,
  RefreshCw,
  ScanLine,
  Timer,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { StageBlock } from '@/components/tickee/stage-block';
import { Button } from '@/components/ui/button';

import { LandingCta } from './landing-cta';

const TITLE = 'Bán vé sự kiện cho Ban tổ chức · Tickee';
const DESCRIPTION =
  'Tạo Sự kiện trong vài phút, bán vé qua link và VietQR, tiền về thẳng tài khoản của Ban tổ chức, Đơn tự khớp giao dịch và soát vé bằng điện thoại.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', locale: 'vi_VN' },
};

const JOURNEY_ID = 'hanh-trinh';

type ValueTile = { icon: LucideIcon; title: string };
type JourneyStep = ValueTile & { body: string };

const VALUE_TILES: ValueTile[] = [
  { icon: Landmark, title: 'Tiền về thẳng tài khoản của bạn' },
  { icon: PiggyBank, title: 'Phí thấp, rõ ràng' },
  { icon: Timer, title: 'Tạo Sự kiện trong vài phút' },
  { icon: RefreshCw, title: 'Tự khớp giao dịch với Đơn' },
];

const JOURNEY: JourneyStep[] = [
  {
    icon: CalendarPlus,
    title: 'Mở bán chỉ trong vài phút',
    body: 'Tạo Sự kiện, thêm Hạng vé và câu hỏi cho người mua, xem trước rồi mở bán.',
  },
  {
    icon: QrCode,
    title: 'Tiền về thẳng tài khoản của bạn',
    body: 'Chia sẻ một đường link, người mua quét VietQR để thanh toán. Tiền vào thẳng tài khoản của bạn.',
  },
  {
    icon: ClipboardCheck,
    title: 'Không phải đối soát tay',
    body: 'Đơn tự khớp với giao dịch ngân hàng. Xuất danh sách ra CSV hoặc Google Sheets khi cần.',
  },
  {
    icon: ScanLine,
    title: 'Soát vé nhanh tại cửa',
    body: 'Bạn và cộng tác viên quét vé bằng điện thoại, không cần thiết bị riêng.',
  },
];

/** Landing cho Ban tổ chức: render tĩnh ở server; chỉ `LandingCta` là client để chọn đích theo tài khoản. */
export default function LandingPage() {
  return (
    <div className="flex flex-col gap-12 md:gap-16">
      <StageBlock
        aria-labelledby="landing-title"
        className="-mx-gutter-mobile flex flex-col gap-8 rounded-none px-gutter-mobile py-10 md:mx-0 md:rounded-lg md:p-12"
      >
        <div className="flex max-w-3xl flex-col gap-4">
          <p className="text-eyebrow text-stage-muted">Dành cho Ban tổ chức sự kiện nhỏ</p>
          <h1 id="landing-title" className="text-display lg:text-[56px]">
            Bán vé sự kiện, <span className="text-primary">tiền về thẳng tài khoản</span> của bạn
          </h1>
          <p className="text-body text-stage-muted md:text-title md:font-normal">
            Tickee giúp CLB, giải đấu, workshop và phòng trà bán vé qua một đường link với VietQR. Đơn tự khớp giao
            dịch, soát vé bằng điện thoại.
          </p>
          <div className="flex flex-col gap-3 pt-2 sm:flex-row">
            <LandingCta />
            <Button
              asChild
              variant="ghost"
              className="border border-stage-foreground text-stage-foreground hover:bg-stage-foreground/10 hover:text-stage-foreground"
            >
              <Link href={`#${JOURNEY_ID}`}>Xem cách hoạt động</Link>
            </Button>
          </div>
        </div>
        <ul role="list" aria-label="Lợi ích chính" className="grid grid-cols-2 gap-x-4 gap-y-6 lg:grid-cols-4">
          {VALUE_TILES.map(({ icon: Icon, title }) => (
            <li key={title} data-slot="value-tile" className="flex flex-col gap-2">
              <Icon aria-hidden="true" className="size-6 text-primary" />
              <span className="text-label">{title}</span>
            </li>
          ))}
        </ul>
      </StageBlock>

      <section id={JOURNEY_ID} aria-labelledby="journey-title" className="flex scroll-mt-4 flex-col gap-section">
        <div className="flex flex-col gap-2">
          <p className="text-eyebrow text-brand-text">Cách hoạt động</p>
          <h2 id="journey-title" className="text-headline">
            Từ tạo Sự kiện tới soát vé, gọn trong một chỗ
          </h2>
        </div>
        <ol role="list" className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {JOURNEY.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="flex flex-col gap-3 rounded-lg bg-card p-card-padding text-card-foreground shadow-card">
              <div className="flex items-center gap-3">
                <span className="text-eyebrow text-muted-foreground">Bước {index + 1}</span>
                <Icon aria-hidden="true" className="size-6 text-brand-text" />
              </div>
              <h3 className="text-title">{title}</h3>
              <p className="text-body text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="beta-title" className="flex max-w-3xl flex-col gap-2">
        <h2 id="beta-title" className="text-headline">
          Đang trong giai đoạn Closed Beta
        </h2>
        <p className="text-body text-muted-foreground">
          Sau khi bạn tạo Ban tổ chức trên Tickee, Quản trị Tingee sẽ duyệt trước khi bạn bán được Vé có phí. Trong lúc
          chờ, bạn vẫn chuẩn bị Sự kiện được, và Sự kiện miễn phí dùng được ngay.
        </p>
      </section>

      <StageBlock
        aria-labelledby="final-cta-title"
        className="mx-auto flex w-full max-w-3xl flex-col items-start gap-5 md:items-center md:p-10 md:text-center"
      >
        <h2 id="final-cta-title" className="text-headline">
          Sẵn sàng mở bán Sự kiện tiếp theo?
        </h2>
        <LandingCta className="w-full sm:w-auto" />
      </StageBlock>
    </div>
  );
}
