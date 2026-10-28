import { StageBlock } from '@/components/tickee/stage-block';

/** Trang chủ tạm — landing thật thuộc Story 2.3. */
export default function HomePage() {
  return (
    <StageBlock className="flex flex-col gap-2">
      <p className="text-eyebrow text-primary">Bán vé sự kiện nhỏ</p>
      <h1 className="text-headline">Vé sự kiện, thanh toán bằng VietQR</h1>
      <p className="text-body text-stage-muted">
        Tickee giúp ban tổ chức giải đấu, workshop, phòng trà bán vé qua một đường link. Tiền về thẳng tài khoản của
        bạn.
      </p>
    </StageBlock>
  );
}
