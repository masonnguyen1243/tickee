/** Đang tải trang Sự kiện: `Skeleton` cho stage và 2 thẻ (Hạng vé, mô tả); ≥ `lg` cùng bố cục 2 cột với trang. */
export default function PublicEventLoading() {
  return (
    <div
      data-layout="wide"
      role="status"
      aria-busy="true"
      className="flex flex-col gap-section lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-x-8"
    >
      <span className="sr-only">Đang tải</span>
      <div aria-hidden="true" className="flex flex-col gap-section">
        <div data-slot="skeleton" className="aspect-[4/5] animate-pulse rounded-lg bg-muted lg:aspect-[16/11]" />
        <div data-slot="skeleton" className="h-32 animate-pulse rounded-lg bg-muted" />
      </div>
      <div aria-hidden="true" data-slot="skeleton" className="h-48 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
