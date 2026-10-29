'use client';

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

const EMPTY = '';

type OtpInputProps = {
  /** Số ô (mặc định 6). */
  length?: number;
  /** Gọi một lần mỗi khi đủ số: dán, tự điền hay gõ ô cuối. */
  onComplete: (code: string) => void;
  /** Các số đã nhập (bỏ ô trống), sau mỗi thay đổi. */
  onChange?: (partial: string) => void;
  /** Id của phần tử nhãn luôn hiện phía trên. */
  labelledBy: string;
  /** Id của dòng lỗi/hướng dẫn, gắn vào từng ô bằng `aria-describedby`. */
  describedBy?: string;
  invalid?: boolean;
  /** Đang gửi mã đi kiểm: ô chỉ đọc (không `disabled` để giữ focus). */
  readOnly?: boolean;
  autoFocus?: boolean;
  /** Tiền tố id của các ô (`<idPrefix>-0` … ). */
  idPrefix?: string;
};

/**
 * `otp-input` (DESIGN.md § Đăng nhập): 6 ô, chữ 20px, `rounded-md`, nền `surface-sunken`, viền `ring` khi focus.
 * Ô đầu có `autocomplete="one-time-code"` để Safari/Chrome tự điền mã từ email/SMS. Dán hoặc tự điền ở bất kỳ ô nào
 * thì điền tiếp các ô sau; dán đủ mã thì điền cả 6 ô. Backspace ở ô trống lùi về ô trước. Đủ số → `onComplete`.
 * Muốn xóa trắng (vd. sau khi mã sai) thì đổi `key` để dựng lại.
 */
export function OtpInput({
  length = 6,
  onComplete,
  onChange,
  labelledBy,
  describedBy,
  invalid = false,
  readOnly = false,
  autoFocus = false,
  idPrefix = 'otp',
}: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length }, () => EMPTY));
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const focusAt = (index: number) => {
    const target = inputs.current[Math.max(0, Math.min(length - 1, index))];
    target?.focus();
    target?.select();
  };

  const update = (next: string[]) => {
    setDigits(next);
    onChange?.(next.join(''));
  };

  const commit = (next: string[], focusIndex: number) => {
    update(next);
    focusAt(focusIndex);
    if (next.every((d) => d !== EMPTY)) onComplete(next.join(''));
  };

  /** Ghi một chuỗi số bắt đầu từ ô `start`; đủ cả mã thì luôn điền từ ô đầu. */
  const fill = (start: number, raw: string) => {
    const incoming = raw.replace(/\D/g, '');
    if (incoming === '') return;
    const from = incoming.length >= length ? 0 : start;
    const next = [...digits];
    const chars = incoming.slice(0, length - from).split('');
    chars.forEach((d, i) => {
      next[from + i] = d;
    });
    commit(next, from + chars.length);
  };

  const handleChange = (index: number, value: string) => {
    if (readOnly) return;
    const incoming = value.replace(/\D/g, '');
    if (incoming === '') {
      const next = [...digits];
      next[index] = EMPTY;
      update(next);
      return;
    }
    // Gõ đè lên ô đã có số: giữ ký tự mới nhất. Nhiều số cùng lúc (tự điền) → điền tiếp các ô sau.
    if (incoming.length === 2 && digits[index] !== EMPTY && value.length === 2) {
      fill(index, incoming.replace(digits[index]!, '') || incoming.slice(-1));
      return;
    }
    fill(index, incoming);
  };

  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    if (readOnly) return;
    fill(index, event.clipboardData?.getData('text') ?? '');
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && digits[index] === EMPTY && index > 0) {
      event.preventDefault();
      if (readOnly) return;
      const next = [...digits];
      next[index - 1] = EMPTY;
      update(next);
      focusAt(index - 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      focusAt(index - 1);
    } else if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault();
      focusAt(index + 1);
    }
  };

  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      data-slot="otp-input"
      className="grid w-full max-w-88 gap-2"
      style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}
    >
      {digits.map((digit, index) => (
        <input
          // Số ô cố định trong suốt vòng đời component nên index là khóa ổn định.
          key={index}
          ref={(el) => {
            inputs.current[index] = el;
          }}
          id={`${idPrefix}-${index}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          // Ô đầu nhận cả mã khi tự điền; các ô khác chỉ một số.
          maxLength={index === 0 ? length : 2}
          autoFocus={autoFocus && index === 0}
          aria-label={`Số thứ ${index + 1} trên ${length}`}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          readOnly={readOnly}
          value={digit}
          onChange={(event) => handleChange(index, event.target.value)}
          onPaste={(event) => handlePaste(index, event)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onFocus={(event) => event.target.select()}
          className={cn(
            'h-14 w-full min-w-0 rounded-md border-2 border-transparent bg-muted text-center text-[20px] leading-none font-medium text-foreground tabular-nums caret-transparent focus:border-ring aria-invalid:border-danger-text',
            readOnly && 'opacity-70',
          )}
        />
      ))}
    </div>
  );
}
