'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { signOut } from './api';

/**
 * Đăng xuất: hủy session ở server, xóa toàn bộ cache của tài khoản rồi gọi `onSignedOut` (nơi gọi tự điều hướng).
 * Cache xóa trước khi điều hướng để trang đích không thấy dữ liệu của tài khoản cũ. Lỗi: nơi gọi tự báo, qua
 * `onError` hoặc `mutation.error`.
 */
export function useSignOut(onSignedOut: () => void, options: { onError?: (error: unknown) => void } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      onSignedOut();
    },
    onError: options.onError,
  });
}
