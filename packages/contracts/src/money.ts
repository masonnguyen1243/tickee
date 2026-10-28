/**
 * Định dạng tiền VND kiểu Việt Nam, không phần thập phân: `300000` → `"300.000đ"`.
 * Dùng chung web và email. Chỉ nhận số nguyên không âm (đơn vị đồng).
 */
export function formatVnd(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`formatVnd: số tiền phải là số nguyên không âm, nhận ${String(amount)}`);
  }
  // Tự chèn dấu chấm phân cách nghìn: không phụ thuộc dữ liệu ICU của runtime.
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;
}
