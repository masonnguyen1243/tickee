import { MAILPIT_URL } from './env';

/*
 * Đọc thư ở Mailpit qua API HTTP (`/api/v1`). Mailpit giữ thư của các lượt trước (cùng địa chỉ) nên `Mailbox` chụp danh
 * sách thư hiện có lúc mở và chỉ trả thư mới đến sau đó — không xóa thư nào.
 */

type MailpitSummary = { ID: string; Subject: string; To: { Address: string }[] | null };
type MailpitSearch = { messages: MailpitSummary[] };
type MailpitMessage = { ID: string; Subject: string; Text: string };

export type Mail = { id: string; subject: string; text: string };

const POLL_MS = 250;
const DEFAULT_TIMEOUT_MS = 20_000;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${MAILPIT_URL}/api/v1${path}`);
  if (!res.ok) throw new Error(`Mailpit ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Thư gửi tới đúng `address` (mới nhất trước). */
async function messagesTo(address: string): Promise<MailpitSummary[]> {
  const query = encodeURIComponent(`to:"${address}"`);
  const { messages } = await getJson<MailpitSearch>(`/search?query=${query}&limit=100`);
  return messages.filter((m) => (m.To ?? []).some((to) => to.Address.toLowerCase() === address));
}

export class Mailbox {
  private constructor(
    readonly address: string,
    private readonly seen: Set<string>,
  ) {}

  /** Mở hộp thư của `address`: thư đang có coi như đã đọc. */
  static async open(address: string): Promise<Mailbox> {
    const normalized = address.toLowerCase();
    return new Mailbox(normalized, new Set((await messagesTo(normalized)).map((m) => m.ID)));
  }

  /** Chờ thư mới đầu tiên có tiêu đề `subject` (chuỗi: khớp nguyên văn); đánh dấu đã đọc. */
  async next(subject: string | RegExp, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Mail> {
    const matches = (s: string) => (typeof subject === 'string' ? s === subject : subject.test(s));
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = (await messagesTo(this.address))
        .reverse()
        .find((m) => !this.seen.has(m.ID) && matches(m.Subject));
      if (found) {
        this.seen.add(found.ID);
        const message = await getJson<MailpitMessage>(`/message/${encodeURIComponent(found.ID)}`);
        return { id: message.ID, subject: message.Subject, text: message.Text };
      }
      if (Date.now() > deadline) {
        throw new Error(`Mailpit: ${timeoutMs} ms chưa có thư mới "${String(subject)}" tới ${this.address}`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  /** Mã OTP 6 số trong thư đăng nhập mới nhất chưa đọc (`apps/api/src/modules/identity/otp-email.ts`). */
  async otp(): Promise<string> {
    const mail = await this.next('Mã đăng nhập Tickee của bạn');
    const code = /Mã đăng nhập Tickee của bạn là: (\d{6})/.exec(mail.text)?.[1];
    if (!code) throw new Error(`Mailpit: thư ${mail.id} không có mã OTP 6 số`);
    return code;
  }
}
