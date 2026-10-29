import type { Metadata } from 'next';

import { StatusBanner } from '@/components/tickee/status-banner';

// Bản nháp chờ pháp chế: không cho máy tìm kiếm lập chỉ mục.
export const metadata: Metadata = {
  title: 'Chính sách xử lý dữ liệu cá nhân · Tickee',
  robots: { index: false, follow: false },
};

/*
 * NỘI DUNG TẠM — chờ pháp chế xác nhận; phải thay bằng bản đã duyệt trước Closed Beta.
 */
export default function DataPolicyPage() {
  return (
    <article className="flex flex-col gap-section pt-2">
      <h1 className="text-headline">Chính sách xử lý dữ liệu cá nhân</h1>
      <StatusBanner tone="warning" title="Bản nháp, chờ pháp chế xác nhận" description="Nội dung có thể thay đổi." />

      <section className="flex flex-col gap-2">
        <h2 className="text-title">1. Dữ liệu được thu thập</h2>
        <p className="text-body">
          Email dùng để đăng nhập, tên hiển thị (nếu có) và lịch sử mua vé: Sự kiện, Hạng vé, số lượng, thời điểm và
          trạng thái Đơn. Tickee không lưu thông tin thẻ hay tài khoản ngân hàng của người mua.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-title">2. Mục đích xử lý</h2>
        <p className="text-body">
          Tạo và quản lý Tài khoản Tickee; phát hành và gửi vé; thông báo khi Sự kiện đổi giờ, đổi địa điểm hoặc bị
          hủy; hỗ trợ khi có sự cố thanh toán hay check-in; bảo đảm an toàn cho hệ thống.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-title">3. Chia sẻ dữ liệu</h2>
        <p className="text-body">
          Ban tổ chức của Sự kiện bạn mua vé nhận thông tin cần cho việc check-in và chăm sóc người tham dự. Tickee
          không bán dữ liệu cá nhân.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-title">4. Quyền của bạn</h2>
        <p className="text-body">
          Bạn có quyền xem, chỉnh sửa, yêu cầu xóa dữ liệu và rút lại đồng ý bất kỳ lúc nào. Rút lại đồng ý đồng nghĩa
          với việc ngừng sử dụng Tài khoản Tickee; vé đã phát vẫn check-in được bằng mã.
        </p>
      </section>
    </article>
  );
}
