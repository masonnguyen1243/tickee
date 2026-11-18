'use client';

import { EVENT_IMAGE_TYPES } from '@tickee/contracts';
import { ImageIcon } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent } from 'react';

import { FieldError } from '@/components/tickee/field-error';
import { Button } from '@/components/ui/button';
import type { EventImageControls } from '@/lib/event/use-event-image';

type EventImagePickerProps = EventImageControls & {
  /** Chỉ đọc (Sự kiện đã hủy): chỉ preview, không chọn, không gỡ. */
  readOnly?: boolean;
  /** Form đang lưu (hoặc đang chuyển trang): tạm khóa chọn, gỡ, thử lại để ảnh không đổi giữa chừng. */
  disabled?: boolean;
};

const ACCEPT = EVENT_IMAGE_TYPES.join(',');

/**
 * Ô "Ảnh bìa" của Sự kiện (Story 4.8-b): preview khung 16:9 `object-cover`, "Chọn ảnh" / "Đổi ảnh" (spinner khi đang
 * upload), "Gỡ ảnh", lỗi tại ô kèm "Thử lại" khi upload lỗi. Không crop, không nén: file gửi nguyên trạng. Trạng thái và
 * thao tác do `useEventImage` giữ.
 */
export function EventImagePicker({
  previewUrl,
  uploading,
  hasImage,
  error,
  canRetry,
  onSelect,
  onRemove,
  onRetry,
  readOnly = false,
  disabled = false,
}: EventImagePickerProps) {
  const ids = useId();
  const labelId = `${ids}-label`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  // Ảnh tải lỗi (URL hỏng, object đã mất) → ô trống; đổi URL thì thử hiện lại.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const shown = previewUrl && previewUrl !== brokenUrl ? previewUrl : null;

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Xóa giá trị để chọn lại đúng file đó vẫn phát `change` (vd. sau khi gỡ).
    e.target.value = '';
    if (file) onSelect(file);
  };

  return (
    <div role="group" aria-labelledby={labelId} className="flex min-w-0 flex-col gap-stack" data-slot="event-image-picker">
      <p id={labelId} className="text-label">
        Ảnh bìa
      </p>
      {readOnly ? null : (
        <p id={hintId} className="text-meta text-muted-foreground">
          JPEG, PNG hoặc WebP, tối đa 5 MB. Nên dùng ảnh ngang 16:9.
        </p>
      )}
      <div
        data-slot="event-image-preview"
        className="flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-md bg-muted"
      >
        {shown ? (
          <img
            src={shown}
            alt="Ảnh bìa"
            data-slot="event-image-preview-image"
            className="size-full object-cover"
            onError={() => setBrokenUrl(shown)}
          />
        ) : (
          <span className="flex flex-col items-center gap-2 text-meta text-muted-foreground" data-slot="event-image-empty">
            <ImageIcon aria-hidden="true" strokeWidth={1.5} className="size-8" />
            Chưa có ảnh bìa
          </span>
        )}
      </div>
      {readOnly ? null : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            data-slot="event-image-input"
            disabled={disabled}
            onChange={onChange}
          />
          <div className="flex flex-wrap items-center gap-stack">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={uploading}
              disabled={disabled}
              aria-describedby={`${hintId} ${errorId}`}
              onClick={() => inputRef.current?.click()}
            >
              {hasImage ? 'Đổi ảnh' : 'Chọn ảnh'}
            </Button>
            {hasImage ? (
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onRemove}>
                Gỡ ảnh
              </Button>
            ) : null}
          </div>
        </>
      )}
      <FieldError id={errorId} message={error} />
      {canRetry && !readOnly ? (
        <div>
          <Button type="button" variant="link" size="sm" disabled={disabled} onClick={onRetry}>
            Thử lại
          </Button>
        </div>
      ) : null}
    </div>
  );
}
