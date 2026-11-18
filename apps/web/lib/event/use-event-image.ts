'use client';

import { useMutation } from '@tanstack/react-query';
import { ErrorCode, type EventImageUpload } from '@tickee/contracts';
import { useEffect, useRef, useState } from 'react';

import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';

import { EventImagePutError, eventImageFileError, IMAGE_UPLOAD_ERROR, uploadEventImage } from './image-upload';

/*
 * Ô "Ảnh bìa" (Story 4.8-b) dùng chung cho wizard bước 1 và tab "Cài đặt": chọn file thì kiểm tại chỗ rồi upload ngay
 * (presign theo BTC, PUT thẳng storage); key mới chỉ vào Sự kiện khi bấm nút lưu như mọi ô khác. "Gỡ ảnh" chỉ đổi giá trị
 * trong form (`key` = `null`). Upload lỗi giữ ảnh cũ và file vừa chọn để "Thử lại".
 */

/** File đã chọn nhưng chưa thành ảnh của form: đang upload hoặc upload lỗi (chờ "Thử lại"). */
type Pending = {
  file: File;
  /** `URL.createObjectURL(file)`: preview hiện ngay khi chọn. */
  previewUrl: string;
  /** Presign của lần thử trước (PUT lại cùng URL khi còn hạn); `null` → xin presign mới. */
  upload: EventImageUpload | null;
};

type ImageState = {
  /** Key sẽ gửi làm `imageKey` khi lưu. */
  key: string | null;
  /** Ảnh ứng với `key`: URL công khai của server hoặc object URL của file đã upload xong. */
  url: string | null;
  pending: Pending | null;
  /** Lỗi tại ô (sai loại, quá dung lượng, upload lỗi). */
  error: string | null;
};

type UploadVariables = { attempt: number; file: File; previewUrl: string; previous: EventImageUpload | null; signal: AbortSignal };

/** Trạng thái và thao tác của ô ảnh, đúng các props của `EventImagePicker` (trừ `readOnly`). */
export type EventImageControls = {
  /** Ảnh hiện trong khung preview: file đang upload, không thì ảnh của form; `null` → ô trống. */
  previewUrl: string | null;
  uploading: boolean;
  /** Form đang có ảnh (`key` khác `null`): nút "Đổi ảnh" và "Gỡ ảnh". */
  hasImage: boolean;
  error: string | null;
  /** Upload vừa lỗi (kể cả lỗi do nơi khác báo, vd. đóng dialog 2FA): hiện "Thử lại" (PUT lại cùng file). */
  canRetry: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
  onRetry: () => void;
};

export type UseEventImageOptions = {
  orgId: string;
  /** Ảnh hiện có của Sự kiện (`EventDetail.imageKey`/`imageUrl`); Sự kiện mới → `null`. */
  initialKey: string | null;
  initialUrl: string | null;
  /** Người dùng chọn hoặc gỡ ảnh (vd. xóa lỗi server ở ô ảnh). */
  onEdit?: () => void;
};

export function useEventImage({ orgId, initialKey, initialUrl, onEdit }: UseEventImageOptions) {
  const goToLogin = useGoToLogin();
  const [state, setState] = useState<ImageState>({ key: initialKey, url: initialUrl, pending: null, error: null });
  /** Lần thử hiện hành; kết quả của lần cũ (đã chọn ảnh khác, đã gỡ) bị bỏ qua. */
  const attempt = useRef(0);
  const controller = useRef<AbortController | null>(null);
  /** Object URL do hook tạo: thu hồi khi không còn hiện ở đâu, và khi unmount. */
  const objectUrls = useRef(new Set<string>());

  const upload = useMutation({
    // Không chờ `onlineManager`: máy báo offline thì mutation mặc định ('online') tạm dừng, nút cứ bận mà không bao giờ
    // báo lỗi. Chạy luôn để lỗi mạng thành "Chưa tải được ảnh." + "Thử lại".
    networkMode: 'always',
    mutationFn: ({ file, previous, signal }: UploadVariables) => uploadEventImage(orgId, file, { previous, signal }),
    onSuccess: (done, { attempt: id, previewUrl }) => {
      if (id !== attempt.current) return;
      setState({ key: done.key, url: previewUrl, pending: null, error: null });
    },
    onError: (error, { attempt: id, file, previewUrl }) => {
      if (id !== attempt.current) return;
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      setState((s) => ({
        ...s,
        pending: { file, previewUrl, upload: error instanceof EventImagePutError ? error.upload : null },
        // 2FA, đồng ý, 401, bị xóa khỏi BTC: nơi khác báo (2FA xong thì tự gửi lại đúng lần upload này).
        error: handledElsewhere(error) ? null : IMAGE_UPLOAD_ERROR,
      }));
    },
  });

  // Thu hồi object URL không còn được trạng thái nào tham chiếu (đã đổi ảnh, đã gỡ, file lỗi bị bỏ).
  const pendingUrl = state.pending?.previewUrl ?? null;
  useEffect(() => {
    for (const url of objectUrls.current) {
      if (url === state.url || url === pendingUrl) continue;
      URL.revokeObjectURL(url);
      objectUrls.current.delete(url);
    }
  }, [state.url, pendingUrl]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      controller.current?.abort();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  /** Bỏ lần upload đang chạy (nếu có): kết quả của nó không còn đổi trạng thái. */
  const abandon = () => {
    attempt.current += 1;
    controller.current?.abort();
    controller.current = null;
    upload.reset();
  };

  const start = (pending: Pending) => {
    abandon();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setState((s) => ({ ...s, pending, error: null }));
    upload.mutate({
      attempt: attempt.current,
      file: pending.file,
      previewUrl: pending.previewUrl,
      previous: pending.upload,
      signal: ctrl.signal,
    });
  };

  const onSelect = (file: File) => {
    onEdit?.();
    const invalid = eventImageFileError(file);
    if (invalid) {
      // Không gọi API; ảnh của form giữ nguyên.
      abandon();
      setState((s) => ({ ...s, pending: null, error: invalid }));
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    objectUrls.current.add(previewUrl);
    start({ file, previewUrl, upload: null });
  };

  const onRemove = () => {
    onEdit?.();
    abandon();
    setState({ key: null, url: null, pending: null, error: null });
  };

  const onRetry = () => {
    if (!state.pending || upload.isPending) return;
    onEdit?.();
    start(state.pending);
  };

  const uploading = upload.isPending;
  const controls: EventImageControls = {
    previewUrl: uploading && state.pending ? state.pending.previewUrl : state.url,
    uploading,
    hasImage: state.key !== null,
    error: state.error,
    // Không upload mà còn file chờ = lần upload của file đó đã lỗi.
    canRetry: !uploading && state.pending !== null,
    onSelect,
    onRemove,
    onRetry,
  };

  return { key: state.key, uploading, controls };
}
