import { ExternalLink } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

type TingeeLinkProps = Omit<ComponentProps<'a'>, 'target' | 'rel'> & { href: string };

/**
 * Liên kết ra ngoài Tickee (portal Tingee…): luôn mở tab mới với `noopener noreferrer`, kèm icon liên kết ngoài (ẩn với
 * trình đọc màn hình) và câu "(mở trong tab mới)" chỉ trình đọc màn hình đọc. Dùng được trong `Button asChild` (vd. hành
 * động của `status-banner`): nhận `className` và các thuộc tính khác của `<a>`.
 */
export function TingeeLink({ href, className, children, ...props }: TingeeLinkProps) {
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('inline-flex items-center gap-1 text-brand-text underline underline-offset-4', className)}
    >
      {children}
      <span className="sr-only"> (mở trong tab mới)</span>
      <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
    </a>
  );
}
