import 'reflect-metadata';
import { runDevSeed } from './seed.js';

/*
 * `pnpm db:seed [--email <email>]` ở gốc repo, sau khi `pnpm dev` đã migrate DB: BTC demo đã duyệt Closed Beta, có tài
 * khoản nhận tiền trỏ vào merchant demo của Tingee fake. Chỉ cho dev local; xem `seed.ts`.
 */
process.exitCode = await runDevSeed(process.argv.slice(2));
