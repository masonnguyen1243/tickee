import { createTransport, type Transporter } from 'nodemailer';
import type { EmailMessage, EmailTransport } from './email-transport.js';

export interface SmtpTransportOptions {
  /** `smtp://user:pass@host:port` hoặc `smtps://…`. Không bao giờ log giá trị này. */
  url: string;
  from: string;
}

/** `EmailTransport` qua SMTP bằng nodemailer. Timeout ngắn để request gửi mã không treo. */
export class SmtpEmailTransport implements EmailTransport {
  private readonly transporter: Transporter;

  constructor(private readonly options: SmtpTransportOptions) {
    this.transporter = createTransport({
      url: options.url,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.options.from, ...message });
  }

  close(): void {
    this.transporter.close();
  }
}
