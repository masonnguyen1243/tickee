'use client';

import { formatVnd } from '@tickee/contracts';
import { Inbox } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/tickee/empty-state';
import { StageBlock } from '@/components/tickee/stage-block';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import type { StatusTone } from '@/components/tickee/tone';
import { Wordmark } from '@/components/tickee/wordmark';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

const TONES: { tone: StatusTone; badge: string; title: string; description: string }[] = [
  { tone: 'success', badge: 'Đã thanh toán', title: 'Đang mở bán', description: 'Người mua có thể đặt vé ngay.' },
  { tone: 'warning', badge: 'Chờ thanh toán', title: 'Tạm ngừng bán', description: 'Ban tổ chức tạm dừng nhận Đơn.' },
  { tone: 'danger', badge: 'Cần xử lý', title: 'Sự kiện đã hủy', description: 'Liên hệ ban tổ chức để được hỗ trợ.' },
  { tone: 'neutral', badge: 'Hết hạn', title: 'Sự kiện đã kết thúc', description: 'Cảm ơn bạn đã quan tâm.' },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-stack">
      <h2 id={id} className="text-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function UiKit() {
  const [loading, setLoading] = useState(false);
  const [clicks, setClicks] = useState(0);

  return (
    <div className="flex flex-col gap-section">
      <h1 className="text-headline">Bộ giao diện</h1>

      <Section id="kit-stage" title="Khối sân khấu">
        <StageBlock className="flex flex-col gap-3">
          <Wordmark tone="stage" />
          <p className="text-eyebrow text-primary">Thể thao · Pickleball</p>
          <p className="text-headline">Giải Pickleball phong trào mùa thu</p>
          <p className="text-meta text-stage-muted">Sân Rạch Miễu · 19:00 thứ Bảy</p>
          <p className="text-amount tabular-nums">{formatVnd(300000)}</p>
          <Button variant="primary" className="w-full" data-testid="kit-button-primary">
            Mua vé
          </Button>
        </StageBlock>
      </Section>

      <Section id="kit-buttons" title="Nút trên nền sáng">
        <Button variant="primary-on-light" className="w-full" data-testid="kit-button-primary-on-light">
          Gửi Đơn
        </Button>
        <Button variant="secondary" className="w-full">
          Tải ảnh QR
        </Button>
        <Button variant="destructive" className="w-full">
          Hủy Sự kiện
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost">Để sau</Button>
          <Button variant="link">Chính sách hoàn vé</Button>
        </div>
        <Button variant="secondary" className="w-full" disabled>
          Chưa thể tiếp tục
        </Button>
      </Section>

      <Section id="kit-loading" title="Nút đang gọi mạng">
        <Button
          variant="primary-on-light"
          data-testid="kit-loading-button"
          loading={loading}
          onClick={() => {
            setClicks((n) => n + 1);
            setLoading(true);
          }}
        >
          Thanh toán {formatVnd(600000)}
        </Button>
        <p className="text-meta text-muted-foreground">
          Số lần bấm được xử lý: <span data-testid="kit-loading-clicks" className="tabular-nums">{clicks}</span>
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLoading(false);
            setClicks(0);
          }}
        >
          Đặt lại
        </Button>
      </Section>

      <Section id="kit-badges" title="Huy hiệu trạng thái">
        <div className="flex flex-wrap gap-2">
          {TONES.map(({ tone, badge }) => (
            <StatusBadge key={tone} tone={tone}>
              {badge}
            </StatusBadge>
          ))}
        </div>
      </Section>

      <Section id="kit-banners" title="Banner trạng thái">
        {TONES.map(({ tone, title, description }) => (
          <StatusBanner
            key={tone}
            tone={tone}
            title={title}
            description={description}
            action={
              tone === 'warning' ? (
                <Button variant="link" size="sm">
                  Xem chi tiết
                </Button>
              ) : undefined
            }
          />
        ))}
      </Section>

      <Section id="kit-empty" title="Trạng thái trống">
        <div className="rounded-lg bg-card p-card-padding shadow-card">
          <EmptyState
            icon={Inbox}
            title="Chưa có Đơn nào"
            description="Đơn của bạn sẽ hiện ở đây sau khi đặt vé."
            action={<Button variant="secondary">Xem sự kiện</Button>}
          />
        </div>
      </Section>

      <Section id="kit-form" title="Ô nhập và phân cách">
        <label htmlFor="kit-email" className="text-label">
          Email
        </label>
        <input
          id="kit-email"
          type="email"
          autoComplete="email"
          placeholder="ban@vidu.vn"
          className="h-control-height w-full rounded-md border border-transparent bg-muted px-3 text-foreground placeholder:text-muted-foreground focus:border-ring"
        />
        <div className="flex items-center gap-3 text-meta text-muted-foreground">
          <Separator className="flex-1" />
          <span>hoặc</span>
          <Separator className="flex-1" />
        </div>
        <Button variant="secondary" className="w-full" onClick={() => toast.success('Đã lưu thay đổi')}>
          Hiện thông báo
        </Button>
      </Section>

      <Section id="kit-type" title="Chữ và số tiền">
        <div className="flex flex-col gap-1 rounded-lg bg-card p-card-padding shadow-card">
          <p className="text-display">Tiêu đề lớn</p>
          <p className="text-headline">Tiêu đề trang</p>
          <p className="text-title">Tiêu đề khối</p>
          <p className="text-body">Văn bản thường có đủ dấu tiếng Việt: ơ ư ă â ê ô đ.</p>
          <p className="text-label">Còn 12 vé</p>
          <p className="text-label font-bold text-brand-text">Còn 3 vé</p>
          <p className="text-meta text-muted-foreground">Địa chỉ, ghi chú, dòng phụ</p>
          <p className="text-total tabular-nums">{formatVnd(1234567)}</p>
          <p className="font-mono text-code tabular-nums">TK-2026-000123</p>
        </div>
      </Section>
    </div>
  );
}
