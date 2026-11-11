import { randomBytes } from 'node:crypto';
import { EmailAddress, Role } from '@tickee/contracts';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { users } from '../../src/modules/identity/schema.js';
import { members, organizations, payoutAccounts, tingeeCredentials } from '../../src/modules/organizer/schema.js';
import { ConfigError, loadConfig, type MigrateConfig } from '../../src/platform/config/index.js';
import { CredentialKeysError, parseCredentialKeys, SecretBox } from '../../src/platform/crypto/index.js';
import { Database, type Tx } from '../../src/platform/db/index.js';
import { SEED_IPN_KEY, SEED_MERCHANT, SEED_PAYOUT_ACCOUNT } from '../tingee-fake/demo-merchants.js';

/*
 * Dữ liệu dev local (`pnpm db:seed`): một Tài khoản Tickee làm Owner của BTC demo đã duyệt Closed Beta, có key Tingee
 * của merchant demo (Tingee fake) và một tài khoản nhận tiền mặc định, nên BTC mở bán được Vé có phí ngay mà không phải
 * sửa DB bằng SQL. BTC demo nhận `ipnKey` cố định `SEED_IPN_KEY` (khi chưa BTC nào giữ) nên Tingee fake biết sẵn URL IPN
 * của nó: bấm nút trên trang thanh toán giả là Đơn có phí thành `paid`. Code nằm ngoài `src/` nên không vào image.
 *
 * Chạy bằng `tickee_migrator` (như vai migrate), trong một transaction. Chỉ thêm phần còn thiếu, nên chạy lại không tạo
 * trùng. Không gọi Tingee, không ghi audit (không có người thao tác thật).
 */

export const DEFAULT_SEED_EMAIL = 'btc.demo@tickee.local';
/** Tên BTC demo; mỗi Owner có một BTC demo, tìm theo tên này và Owner. */
export const DEMO_ORGANIZATION_NAME = 'BTC Demo';
/** `ipnKey`: 128 bit ngẫu nhiên, base64url (như `PayoutAccountService.connect`). */
const IPN_KEY_BYTES = 16;
const newIpnKey = () => randomBytes(IPN_KEY_BYTES).toString('base64url');

/** `SEED_IPN_KEY` còn trống (chưa BTC nào giữ)? Advisory lock của seed tuần tự hóa kiểm-rồi-gán; api chỉ sinh khóa ngẫu nhiên. */
async function seedIpnKeyFree(tx: Tx): Promise<boolean> {
  const [holder] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.tingeeIpnKey, SEED_IPN_KEY))
    .limit(1);
  return holder === undefined;
}

const SEED_IPN_KEY_CHANGE = `Khóa định tuyến IPN cố định của merchant demo (${SEED_IPN_KEY}): Tingee fake gửi IPN về BTC này`;
const RANDOM_IPN_KEY_CHANGE =
  `Khóa định tuyến IPN ngẫu nhiên (${SEED_IPN_KEY} thuộc BTC khác): Tingee fake gửi IPN của merchant demo về BTC kia; ` +
  'dán URL IPN của BTC này (trang Tài khoản nhận tiền) vào ô "Đường dẫn IPN" trên trang thanh toán giả';

export interface DevSeedOptions {
  /** Mã hóa Secret Token demo bằng đúng khóa api dùng (`TINGEE_CREDENTIAL_KEYS`), để api giải mã được. */
  secretBox: SecretBox;
  /** Email đã chuẩn hóa (`EmailAddress`). Chưa có tài khoản thì tạo mới (đã đồng ý NĐ 13). */
  email: string;
}

export interface DevSeedResult {
  userId: string;
  organizationId: string;
  /** Phần đã thêm hoặc đổi, theo thứ tự; rỗng là không đổi gì. */
  changes: string[];
}

/** Bảo đảm BTC demo của `email` đủ điều kiện bán Vé có phí. Một transaction; chỉ thêm phần còn thiếu. */
export async function seedDevData(db: Database, { secretBox, email }: DevSeedOptions): Promise<DevSeedResult> {
  return db.transaction(async (tx) => {
    // Hai lần seed cùng lúc: lần sau chờ lần trước commit rồi thấy dữ liệu đã có.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tickee:dev-seed'))`);
    const changes: string[] = [];

    let [user] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (!user) {
      [user] = await tx
        .insert(users)
        .values({ email, emailVerified: true, consentedAt: sql`now()` })
        .returning({ id: users.id });
      if (!user) throw new Error('INSERT users không trả về dòng nào');
      changes.push(`Tài khoản ${email} (đã đồng ý NĐ 13)`);
    }
    const userId = user.id;

    const [found] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .innerJoin(
        members,
        and(eq(members.organizationId, organizations.id), eq(members.userId, userId), eq(members.role, Role.OWNER)),
      )
      .where(eq(organizations.name, DEMO_ORGANIZATION_NAME))
      .orderBy(asc(organizations.createdAt), asc(organizations.id))
      .limit(1);
    let organizationId: string;
    if (found) {
      organizationId = found.id;
      const approved = await tx
        .update(organizations)
        .set({ closedBetaStatus: 'approved', closedBetaChangedAt: sql`now()` })
        .where(and(eq(organizations.id, organizationId), ne(organizations.closedBetaStatus, 'approved')))
        .returning({ id: organizations.id });
      if (approved.length > 0) changes.push(`Duyệt Closed Beta cho BTC "${DEMO_ORGANIZATION_NAME}"`);
    } else {
      // BTC khác đang giữ `SEED_IPN_KEY` (vd. BTC demo của email khác): khóa ngẫu nhiên, BTC này dán URL IPN của mình
      // vào ô trên trang thanh toán giả.
      const seedKey = await seedIpnKeyFree(tx);
      const [created] = await tx
        .insert(organizations)
        .values({
          name: DEMO_ORGANIZATION_NAME,
          closedBetaStatus: 'approved',
          closedBetaChangedAt: sql`now()`,
          tingeeIpnKey: seedKey ? SEED_IPN_KEY : newIpnKey(),
        })
        .returning({ id: organizations.id });
      if (!created) throw new Error('INSERT organizations không trả về dòng nào');
      organizationId = created.id;
      await tx.insert(members).values({ organizationId, userId, role: Role.OWNER });
      changes.push(`BTC "${DEMO_ORGANIZATION_NAME}", Owner ${email}, đã duyệt Closed Beta`);
      changes.push(seedKey ? SEED_IPN_KEY_CHANGE : RANDOM_IPN_KEY_CHANGE);
    }

    let [credential] = await tx
      .select({ id: tingeeCredentials.id })
      .from(tingeeCredentials)
      .where(and(eq(tingeeCredentials.organizationId, organizationId), isNull(tingeeCredentials.retiredAt)));
    if (!credential) {
      [credential] = await tx
        .insert(tingeeCredentials)
        .values({
          organizationId,
          clientId: SEED_MERCHANT.clientId,
          secretTokenCiphertext: secretBox.seal(SEED_MERCHANT.secretToken),
          createdBy: userId,
        })
        .returning({ id: tingeeCredentials.id });
      if (!credential) throw new Error('INSERT tingee_credentials không trả về dòng nào');
      changes.push(`Key Tingee của merchant demo ${SEED_MERCHANT.clientId}`);
    }
    // BTC demo seed trước đây (khóa ngẫu nhiên) nhận `SEED_IPN_KEY` nếu chưa BTC nào giữ; BTC khác đang giữ thì giữ
    // nguyên khóa. Như lúc BTC lưu key lần đầu: BTC có key thì có `ipnKey`.
    const [current] = await tx
      .select({ ipnKey: organizations.tingeeIpnKey })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    if (current?.ipnKey !== SEED_IPN_KEY) {
      if (await seedIpnKeyFree(tx)) {
        await tx.update(organizations).set({ tingeeIpnKey: SEED_IPN_KEY }).where(eq(organizations.id, organizationId));
        changes.push(SEED_IPN_KEY_CHANGE);
      } else if (!current?.ipnKey) {
        const assigned = await tx
          .update(organizations)
          .set({ tingeeIpnKey: newIpnKey() })
          .where(and(eq(organizations.id, organizationId), isNull(organizations.tingeeIpnKey)))
          .returning({ id: organizations.id });
        if (assigned.length > 0) changes.push('Khóa định tuyến IPN của BTC');
      }
    }

    const [linked] = await tx
      .select({ id: payoutAccounts.id })
      .from(payoutAccounts)
      .where(and(eq(payoutAccounts.organizationId, organizationId), isNull(payoutAccounts.retiredAt)))
      .limit(1);
    if (!linked) {
      const account = SEED_PAYOUT_ACCOUNT;
      const accountLast4 = account.accountNumber.slice(-4);
      await tx.insert(payoutAccounts).values({
        organizationId,
        tingeeCredentialId: credential.id,
        vaAccountNumber: account.vaAccountNumber,
        bankBin: account.bankBin,
        bankName: account.bankName,
        accountType: account.accountType,
        accountLast4,
        accountName: account.accountName,
        tingeeShopId: account.shopId,
        isDefault: true,
        createdBy: userId,
      });
      changes.push(`Tài khoản nhận tiền mặc định ${account.bankName} ••••${accountLast4}`);
    }

    return { userId, organizationId, changes };
  });
}

export interface DevSeedIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = [
  'Cách dùng (ở gốc repo):',
  `  pnpm db:seed                   BTC demo cho ${DEFAULT_SEED_EMAIL}`,
  '  pnpm db:seed --email <email>   BTC demo cho tài khoản này (có sẵn hoặc tạo mới)',
  'Cần MIGRATION_DATABASE_URL (role tickee_migrator) và TINGEE_CREDENTIAL_KEYS (cùng giá trị với api), đọc từ .env.',
].join('\n');

class UsageError extends Error {}

function parseEmail(raw: string | undefined): string {
  if (raw === undefined) throw new UsageError('Thiếu giá trị cho --email.');
  const parsed = EmailAddress.safeParse(raw);
  if (!parsed.success) throw new UsageError('--email không phải email hợp lệ.');
  return parsed.data;
}

function parseArgs(argv: readonly string[]): { email: string } {
  let email = DEFAULT_SEED_EMAIL;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    // `--` tách tham số (vd. `pnpm db:seed -- --email …`): bỏ qua.
    if (arg === '--') continue;
    if (arg === '--email') email = parseEmail(argv[++i]);
    else if (arg.startsWith('--email=')) email = parseEmail(arg.slice('--email='.length));
    else throw new UsageError(arg.startsWith('-') ? `Tùy chọn lạ: ${arg}` : `Tham số lạ: ${arg}`);
  }
  return { email };
}

/** Mã lỗi Postgres/Node (`42P01`, `ECONNREFUSED`…), kèm gợi ý; không in message để không lộ chuỗi kết nối. */
function describeDbError(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const raw = e?.code ?? e?.cause?.code;
  const code = typeof raw === 'string' ? raw : err instanceof Error ? err.name : 'không rõ';
  if (code === '42P01') return `${code}: DB chưa migrate — chạy \`pnpm dev\` trước (pnpm dev tự migrate)`;
  if (code === 'ECONNREFUSED') return `${code}: Postgres chưa chạy — \`docker compose up -d --wait\``;
  return code;
}

/**
 * CLI của seed; trả mã thoát (0 = xong, kể cả "không đổi"). Tham số sai, thiếu biến, `NODE_ENV=production` hoặc lỗi DB:
 * mã ≠ 0 và không đổi gì trong DB.
 */
export async function runDevSeed(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
  io: DevSeedIo = { out: (l) => console.log(l), err: (l) => console.error(l) },
): Promise<number> {
  let email: string;
  try {
    ({ email } = parseArgs(argv));
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.err(`${err.message}\n${USAGE}`);
    return 2;
  }

  let config: MigrateConfig;
  try {
    const loaded = loadConfig({ ...env, APP_ROLE: 'migrate' });
    if (loaded.APP_ROLE !== 'migrate') throw new Error('loadConfig trả sai vai');
    config = loaded;
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    io.err(err.message);
    return 2;
  }
  if (config.NODE_ENV === 'production') {
    io.err('Seed chỉ dùng cho dev local: từ chối chạy khi NODE_ENV=production. Không đổi gì.');
    return 1;
  }

  let secretBox: SecretBox;
  try {
    const keys = env.TINGEE_CREDENTIAL_KEYS;
    if (!keys) throw new CredentialKeysError('thiếu');
    secretBox = new SecretBox(parseCredentialKeys(keys));
  } catch (err) {
    if (!(err instanceof CredentialKeysError)) throw err;
    io.err(`Cấu hình môi trường không hợp lệ: TINGEE_CREDENTIAL_KEYS (${err.message}). Không đổi gì.`);
    return 2;
  }

  const db = new Database({
    connectionString: config.MIGRATION_DATABASE_URL,
    max: 1,
    applicationName: 'tickee-dev-seed',
  });
  let result: DevSeedResult;
  try {
    result = await seedDevData(db, { secretBox, email });
  } catch (err) {
    io.err(`Lỗi khi ghi DB (${describeDbError(err)}). Không đổi gì.`);
    return 1;
  } finally {
    await db.close();
  }

  if (result.changes.length === 0) {
    io.out(`Không đổi: BTC "${DEMO_ORGANIZATION_NAME}" của ${email} đã đủ điều kiện bán Vé có phí.`);
  } else {
    io.out('Đã seed dữ liệu dev:');
    for (const change of result.changes) io.out(`  + ${change}`);
  }
  const webOrigin = env.WEB_ORIGIN || 'http://localhost:3000';
  io.out(`Đăng nhập ${webOrigin}/dang-nhap bằng email ${email} (mã OTP xem ở Mailpit http://localhost:8025).`);
  return 0;
}
