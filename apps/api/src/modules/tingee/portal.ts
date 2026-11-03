/** Host Open API UAT của Tingee; mọi host khác (kể cả Tingee fake ở local) dùng portal thật. */
const UAT_API_HOST = 'uat-open-api.tingee.vn';
const UAT_PORTAL_URL = 'https://uat-baas-portal.tingee.vn';
const PORTAL_URL = 'https://baas.tingee.vn';

/**
 * Portal Tingee nơi BTC đăng ký merchant, liên kết ngân hàng, tạo API key và cấu hình cổng thanh toán, ứng với Open API
 * mà api đang gọi (`TINGEE_BASE_URL`): UAT → portal UAT, còn lại → portal thật.
 */
export function tingeePortalUrl(baseUrl: string): string {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return PORTAL_URL;
  }
  return host === UAT_API_HOST ? UAT_PORTAL_URL : PORTAL_URL;
}
