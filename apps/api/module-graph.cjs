/**
 * Sơ đồ hướng phụ thuộc giữa các mô-đun (AD-10) — nguồn duy nhất.
 * `A: [B, …]` = mô-đun A được gọi service công khai / đọc read model của B.
 * Mọi mô-đun được gọi `platform`; `flows` được gọi mọi mô-đun. Thêm mũi tên chỉ sửa ở đây;
 * `.dependency-cruiser.cjs` sinh luật từ object này.
 */
module.exports = {
  identity: [],
  organizer: ['identity', 'tingee'],
  event: ['organizer'],
  ordering: ['ticketing', 'event', 'organizer', 'tingee'],
  payment: ['ordering', 'tingee'],
  ticketing: ['event'],
  checkin: ['ticketing', 'event'],
  reporting: ['ordering', 'ticketing', 'payment', 'event', 'organizer', 'integration'],
  integration: ['ordering', 'ticketing', 'event', 'organizer', 'identity'],
  admin: ['organizer'],
  tingee: [],
};
