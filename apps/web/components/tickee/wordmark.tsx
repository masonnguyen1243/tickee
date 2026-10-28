import { cn } from '@/lib/utils';

type WordmarkProps = {
  /**
   * `default` — trên nền trang/thẻ: ô vuông `brand-text` (coral-700 ở light, coral ở dark).
   * `stage` — trên stage/bar: chữ `stage-foreground`, ô vuông coral `brand`.
   */
  tone?: 'default' | 'stage';
  className?: string;
};

/** Wordmark tạm (chưa có logo): "tickee" chữ thường 700 kèm ô vuông xoay 45°. Coral chỉ trên nền tối. */
export function Wordmark({ tone = 'default', className }: WordmarkProps) {
  return (
    <span
      data-slot="wordmark"
      className={cn(
        'inline-flex items-center gap-2 text-title font-bold lowercase',
        tone === 'stage' ? 'text-stage-foreground' : 'text-foreground',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-2.5 rotate-45 rounded-[2px]', tone === 'stage' ? 'bg-primary' : 'bg-brand-text')}
      />
      tickee
    </span>
  );
}
