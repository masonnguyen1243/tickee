'use client';

import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { toggleTheme } from '@/lib/theme';

/**
 * Nút chuyển giao diện ở header (quyết định 02/11/2026): hai trạng thái, mỗi lần bấm đổi Sáng ↔ Tối ngay tại chỗ, không
 * có lựa chọn "theo hệ thống". Icon và tên truy cập chỉ đích đến: đang sáng thì mặt trăng "Chuyển sang giao diện tối",
 * đang tối thì mặt trời "Chuyển sang giao diện sáng". Cả hai chọn bằng CSS theo `data-theme` nên đúng ngay từ HTML đầu,
 * trước khi hydrate. Không có JS (`<html>` không có `data-theme`) thì ẩn nút vì bấm không có tác dụng.
 */
export function ThemeToggle() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="[html:not([data-theme])_&]:hidden"
      onClick={toggleTheme}
    >
      <Moon aria-hidden="true" className="dark:hidden" />
      <Sun aria-hidden="true" className="hidden dark:block" />
      <span className="sr-only dark:hidden">Chuyển sang giao diện tối</span>
      <span className="sr-only hidden dark:inline">Chuyển sang giao diện sáng</span>
    </Button>
  );
}
