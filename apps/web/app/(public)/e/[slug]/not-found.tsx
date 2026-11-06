import { SearchX } from 'lucide-react';

import { EmptyState } from '@/components/tickee/empty-state';

/** Sự kiện nháp hoặc slug sai (`404 EVENT_NOT_FOUND`): HTTP 404, không nút. */
export default function PublicEventNotFound() {
  return (
    <EmptyState icon={SearchX} title="Không tìm thấy Sự kiện này." description="Kiểm tra lại link BTC gửi bạn." />
  );
}
