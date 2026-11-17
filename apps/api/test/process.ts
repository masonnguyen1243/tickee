import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

/*
 * Chạy `dist/main.js` như một tiến trình thật (process test): env tối thiểu, không kế thừa env của tiến trình test, gom
 * stdout + stderr.
 */

// Đúng artefact sẽ vào image (turbo `test` phụ thuộc `build`).
export const MAIN = fileURLToPath(new URL('../dist/main.js', import.meta.url));

export interface Proc {
  child: ChildProcess;
  output: () => string;
  exit: Promise<number | null>;
}

export function startProcess(env: Record<string, string>, script = MAIN): Proc {
  const child = spawn(process.execPath, [script], {
    env: { PATH: process.env.PATH ?? '', LOG_LEVEL: 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString('utf8')));
  const exit = once(child, 'exit').then(([code]) => code as number | null);
  return { child, output: () => out, exit };
}

export async function runProcess(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  const p = startProcess(env);
  const code = await p.exit;
  return { code, output: p.output() };
}

export async function waitFor(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Hết ${timeoutMs}ms mà chưa thấy: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function waitForOutput(p: Proc, text: string, timeoutMs = 20_000): Promise<void> {
  await waitFor(
    () => {
      if (p.child.exitCode !== null || p.child.signalCode !== null) {
        throw new Error(`Tiến trình thoát sớm (${p.child.exitCode ?? p.child.signalCode}):\n${p.output()}`);
      }
      return p.output().includes(text);
    },
    `"${text}" trong output:\n${p.output()}`,
    timeoutMs,
  );
}

/** Dòng log JSON của tiến trình (bỏ dòng không phải JSON). */
export function logLines(p: Proc): Record<string, unknown>[] {
  return p
    .output()
    .split('\n')
    .flatMap((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        return typeof parsed === 'object' && parsed !== null ? [parsed as Record<string, unknown>] : [];
      } catch {
        return [];
      }
    });
}

/** SIGTERM (nếu còn chạy) rồi chờ thoát; không bao giờ SIGKILL: đường đó là `killProcess`. */
export async function stopProcess(p: Proc): Promise<number | null> {
  if (p.child.exitCode === null && p.child.signalCode === null) p.child.kill('SIGTERM');
  return p.exit;
}

export function killProcess(p: Proc | undefined): void {
  if (p && p.child.exitCode === null && p.child.signalCode === null) p.child.kill('SIGKILL');
}

export async function freePort(): Promise<number> {
  const srv = createServer();
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const address = srv.address();
  srv.close();
  if (!address || typeof address === 'string') throw new Error('Không lấy được cổng trống');
  return address.port;
}
