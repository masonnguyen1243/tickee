import type { Ref } from 'react';

type PageHeadingProps = {
  /** Dòng nhỏ phía trên (vd. tên BTC). */
  eyebrow: string;
  title: string;
  /**
   * Trang cần đưa focus về tiêu đề (vd. hàng Cần xử lý hết mục sau một thao tác): `h1` nhận `tabIndex={-1}` để focus
   * bằng script được (không vào thứ tự Tab).
   */
  titleRef?: Ref<HTMLHeadingElement>;
};

/** Tiêu đề trang dashboard: eyebrow muted + `h1` headline, xuống dòng khi tên dài. */
export function PageHeading({ eyebrow, title, titleRef }: PageHeadingProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="truncate text-eyebrow text-muted-foreground">{eyebrow}</p>
      <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined} className="text-headline wrap-break-word">
        {title}
      </h1>
    </div>
  );
}
