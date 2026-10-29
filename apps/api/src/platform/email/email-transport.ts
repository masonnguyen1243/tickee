/** Một email đã dựng sẵn nội dung. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Cổng gửi email dùng chung (AD-19): SMTP mặc định, Mailpit ở local, transport giả trong test.
 * Không gắn với dịch vụ độc quyền của cloud nào. Không gọi bên trong transaction DB.
 */
export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

/** Token DI của `EmailTransport`; test thay bằng `overrideProvider(EMAIL_TRANSPORT)`. */
export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');
