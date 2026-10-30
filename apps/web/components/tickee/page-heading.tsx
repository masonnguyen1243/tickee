type PageHeadingProps = {
  /** Dòng nhỏ phía trên (vd. tên BTC). */
  eyebrow: string;
  title: string;
};

/** Tiêu đề trang dashboard: eyebrow muted + `h1` headline, xuống dòng khi tên dài. */
export function PageHeading({ eyebrow, title }: PageHeadingProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="truncate text-eyebrow text-muted-foreground">{eyebrow}</p>
      <h1 className="text-headline wrap-break-word">{title}</h1>
    </div>
  );
}
