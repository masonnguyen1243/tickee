import { spawn } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/*
 * Log và tiến trình con của stack e2e full-stack (`main.ts`): mỗi nguồn log in từng dòng ra terminal kèm tiền tố
 * `[tên]` và ghi nguyên dòng vào `<thư mục log>/<tên>.log` (CI upload thư mục này khi test lỗi).
 */

/** Một nguồn log: dòng ra stdout (hoặc stderr) có tiền tố `[name]`, vào file `<dir>/<name>.log` nguyên văn. */
export class LogSink {
  readonly path: string;
  private readonly file: WriteStream;

  constructor(
    readonly name: string,
    dir: string,
  ) {
    this.path = join(dir, `${name}.log`);
    this.file = createWriteStream(this.path, { flags: 'w' });
  }

  line(text: string, stream: NodeJS.WriteStream = process.stdout): void {
    stream.write(`[${this.name}] ${text}\n`);
    this.file.write(`${text}\n`);
  }

  error(text: string): void {
    this.line(text, process.stderr);
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.file.end(resolve));
  }
}

export interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface Child {
  readonly name: string;
  readonly log: LogSink;
  /** Xong khi tiến trình thoát và stdout/stderr đã đọc hết. */
  readonly exited: Promise<ChildExit>;
  /** `SIGTERM`, sau `KILL_AFTER_MS` mà chưa thoát thì `SIGKILL`; rồi đóng file log. Gọi lại nhiều lần được. */
  stop(): Promise<void>;
}

/** Thời gian chờ tắt êm (api đóng SSE, worker `boss.stop` graceful) trước khi `SIGKILL`. */
const KILL_AFTER_MS = 10_000;

/**
 * Chạy `node <args>` trong `cwd` với đúng `env`. Tiến trình con cùng process group với stack: Playwright tắt cả group,
 * và stack bị giết thì con không mồ côi giữ cổng.
 */
export function startChild(
  name: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; logDir: string },
): Child {
  const log = new LogSink(name, options.logDir);
  const child = spawn(process.execPath, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  createInterface({ input: child.stdout }).on('line', (line) => log.line(line));
  createInterface({ input: child.stderr }).on('line', (line) => log.error(line));
  const exited = new Promise<ChildExit>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
    child.once('error', (err) => {
      log.error(`Không chạy được: ${err.message}`);
      resolve({ code: null, signal: null });
    });
  });

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS);
        await exited;
        clearTimeout(timer);
      } else {
        await exited;
      }
      await log.close();
    })();
    return stopping;
  };

  return { name, log, exited, stop };
}

/** Mô tả lần thoát cho người đọc: "mã 1" hoặc "tín hiệu SIGKILL". */
export function describeExit({ code, signal }: ChildExit): string {
  return signal ? `tín hiệu ${signal}` : `mã ${code ?? 'không rõ'}`;
}
