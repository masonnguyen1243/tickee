/** Tone trạng thái dùng chung cho `status-badge` và `status-banner`. Không bao giờ dùng coral. */
export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

export const toneClasses: Record<StatusTone, string> = {
  success: 'bg-success-subtle text-success-text',
  warning: 'bg-warning-subtle text-warning-text',
  danger: 'bg-danger-subtle text-danger-text',
  neutral: 'bg-neutral-subtle text-neutral-text',
};
