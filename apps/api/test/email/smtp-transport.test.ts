import type { AddressInfo } from 'node:net';
import { SMTPServer, type SMTPServerSession } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SmtpEmailTransport } from '../../src/platform/email/index.js';

interface Received {
  mailFrom: string | false;
  rcptTo: string[];
  raw: string;
}

/** SMTP thật trong tiến trình (cổng 0): kiểm transport nodemailer gửi đúng envelope và nội dung. */
describe('SmtpEmailTransport', () => {
  const received: Received[] = [];
  let server: SMTPServer;
  let port: number;

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      logger: false,
      onData(stream, session: SMTPServerSession, callback) {
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => {
          received.push({
            mailFrom: session.envelope.mailFrom && session.envelope.mailFrom.address,
            rcptTo: session.envelope.rcptTo.map((r) => r.address),
            raw: Buffer.concat(chunks).toString('utf8'),
          });
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('gửi một email: envelope from/to, subject, text và html tới máy chủ SMTP', async () => {
    const transport = new SmtpEmailTransport({ url: `smtp://127.0.0.1:${port}`, from: 'Tickee <no-reply@tickee.test>' });
    try {
      // Nội dung ASCII, dòng ngắn: nodemailer giữ nguyên (7bit) nên đọc được trong thư thô mà không cần giải MIME.
      await transport.send({
        to: 'nguoi-nhan@vidu.vn',
        subject: 'Ma dang nhap Tickee',
        text: 'Ma cua ban: 123456',
        html: '<p>Ma cua ban: <b>123456</b></p>',
      });
    } finally {
      transport.close();
    }

    expect(received).toHaveLength(1);
    const [mail] = received;
    expect(mail!.mailFrom).toBe('no-reply@tickee.test');
    expect(mail!.rcptTo).toEqual(['nguoi-nhan@vidu.vn']);
    expect(mail!.raw).toMatch(/^From: Tickee <no-reply@tickee\.test>\r?$/m);
    expect(mail!.raw).toMatch(/^To: nguoi-nhan@vidu\.vn\r?$/m);
    expect(mail!.raw).toMatch(/^Subject: Ma dang nhap Tickee\r?$/m);
    expect(mail!.raw).toMatch(/Content-Type: text\/plain[\s\S]*Ma cua ban: 123456/);
    expect(mail!.raw).toMatch(/Content-Type: text\/html[\s\S]*<p>Ma cua ban: <b>123456<\/b><\/p>/);
  });
});
