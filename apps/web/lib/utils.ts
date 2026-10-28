import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge cần biết các cỡ chữ có tên của Tickee, nếu không `text-label` bị coi là màu và gộp sai với `text-*` màu.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'display',
            'headline',
            'title',
            'body',
            'input',
            'label',
            'meta',
            'eyebrow',
            'button',
            'amount',
            'total',
            'scan-result',
            'scan-detail',
            'code',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
