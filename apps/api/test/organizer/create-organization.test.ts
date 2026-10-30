import { randomUUID } from 'node:crypto';
import {
  CreatedOrganization,
  ErrorResponse,
  MembershipList,
  Organization,
  Role,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../../src/platform/db/index.js';
import { runMigrations } from '../../src/roles/migrate.js';
import { databaseUrl, migrationDatabaseUrl } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;
const create = (cookie: string, body: unknown) => h.http.post('/v1/orgs').set('cookie', cookie).send(body as object);

async function rowsFor(userId: string) {
  const members = await h.db.orm.execute<{ organization_id: string; role: string }>(
    sql`SELECT organization_id, role FROM members WHERE user_id = ${userId} ORDER BY created_at, id`,
  );
  const audits = await h.db.orm.execute<Record<string, unknown>>(
    sql`SELECT * FROM audit_events WHERE actor_user_id = ${userId} ORDER BY created_at, id`,
  );
  return { members: members.rows, audits: audits.rows };
}

describe('POST /v1/orgs — tạo BTC', () => {
  it('201 {id, name, role: owner}; tạo organizations + members(owner) + đúng 1 dòng audit không chứa giá trị', async () => {
    const user = await signUp(h);
    const phone = '0901 234 567';
    const contactEmail = `lien-he-${randomUUID()}@vidu.vn`;
    const name = `CLB Cờ Vua ${randomUUID()}`;
    const res = await create(user.cookie, { name: `  ${name}  `, contactPhone: phone, contactEmail });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['id', 'name', 'role']);
    const created = CreatedOrganization.parse(res.body);
    expect(created).toEqual({ id: created.id, name, role: 'owner' });

    const org = await h.db.orm.execute<{ name: string; contact_phone: string; contact_email: string }>(
      sql`SELECT name, contact_phone, contact_email FROM organizations WHERE id = ${created.id}`,
    );
    expect(org.rows).toEqual([{ name, contact_phone: '0901234567', contact_email: contactEmail }]);

    const { members, audits } = await rowsFor(user.userId);
    expect(members).toEqual([{ organization_id: created.id, role: 'owner' }]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_user_id: user.userId,
      organization_id: created.id,
      action: 'organization.created',
      target_type: 'organization',
      target_id: created.id,
      changed_fields: ['name'],
    });
    const auditText = JSON.stringify(audits);
    for (const value of [name, '0901234567', phone, contactEmail]) expect(auditText).not.toContain(value);
    expect(auditText).not.toContain('contact');

    // Log của luồng tạo BTC không có kênh liên hệ.
    for (const value of ['0901234567', phone, contactEmail]) expect(h.logs.text).not.toContain(value);
  });

  it('bỏ trống cả hai ô liên hệ vẫn hợp lệ → lưu null', async () => {
    const user = await signUp(h);
    const res = await create(user.cookie, { name: 'BTC không liên hệ', contactPhone: '', contactEmail: '' }).expect(201);
    const org = await h.http.get(`/v1/orgs/${res.body.id}`).set('cookie', user.cookie).expect(200);
    expect(Organization.parse(org.body)).toMatchObject({ contactPhone: null, contactEmail: null });
  });

  it('đã là Owner ở BTC X vẫn tạo được BTC mới, thành Owner BTC mới', async () => {
    const user = await signUp(h);
    const x = (await create(user.cookie, { name: 'BTC X' }).expect(201)).body.id as string;
    const y = (await create(user.cookie, { name: 'BTC Y' }).expect(201)).body.id as string;
    expect(x).not.toBe(y);
    const { members } = await rowsFor(user.userId);
    expect(members).toEqual([
      { organization_id: x, role: 'owner' },
      { organization_id: y, role: 'owner' },
    ]);
  });

  it('đã là Admin ở BTC khác vẫn tạo được BTC mới', async () => {
    const owner = await signUp(h);
    const user = await signUp(h);
    const other = (await create(owner.cookie, { name: 'BTC của người khác' }).expect(201)).body.id as string;
    await h.db.orm.execute(
      sql`INSERT INTO members (organization_id, user_id, role) VALUES (${other}, ${user.userId}, ${Role.ADMIN})`,
    );
    const res = await create(user.cookie, { name: 'BTC của tôi' }).expect(201);
    expect(res.body.role).toBe('owner');
  });

  it.each([
    ['tên rỗng', { name: '' }, 'name'],
    ['tên toàn khoảng trắng', { name: '    ' }, 'name'],
    ['tên > 100 ký tự sau trim', { name: ` ${'a'.repeat(101)} ` }, 'name'],
    ['thiếu tên', {}, 'name'],
    ['SĐT "123"', { name: 'BTC', contactPhone: '123' }, 'contactPhone'],
    ['email hỏng', { name: 'BTC', contactEmail: 'khong-phai-email' }, 'contactEmail'],
  ])('%s → 400 VALIDATION_FAILED tại đúng trường, không ghi DB', async (_label, body, field) => {
    const user = await signUp(h);
    const res = await create(user.cookie, body);
    expect(res.status).toBe(400);
    const error = errorOf(res.body);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect((error.details as { issues: { path: string }[] }).issues.map((i) => i.path)).toContain(field);
    const { members, audits } = await rowsFor(user.userId);
    expect(members).toEqual([]);
    expect(audits).toEqual([]);
  });

  it('tên đúng 100 ký tự sau trim → 201', async () => {
    const user = await signUp(h);
    await create(user.cookie, { name: ` ${'b'.repeat(100)} ` }).expect(201);
  });

  it('chưa đăng nhập → 401 UNAUTHENTICATED', async () => {
    const res = await h.http.post('/v1/orgs').send({ name: 'BTC' });
    expect(res.status).toBe(401);
    expect(errorOf(res.body).code).toBe('UNAUTHENTICATED');
  });
});

describe('GET /v1/me/memberships và GET /v1/orgs/:orgId', () => {
  it('memberships theo created_at tăng, không có kênh liên hệ', async () => {
    const user = await signUp(h);
    const first = (await create(user.cookie, { name: 'Thứ nhất', contactPhone: '0901234567' }).expect(201)).body.id;
    const second = (await create(user.cookie, { name: 'Thứ hai', contactEmail: 'a@vidu.vn' }).expect(201)).body.id;
    const res = await h.http.get('/v1/me/memberships').set('cookie', user.cookie).expect(200);
    expect(MembershipList.parse(res.body)).toEqual(res.body);
    expect(res.body).toEqual([
      { organizationId: first, name: 'Thứ nhất', role: 'owner' },
      { organizationId: second, name: 'Thứ hai', role: 'owner' },
    ]);
  });

  it('chưa thuộc BTC nào → []', async () => {
    const user = await signUp(h);
    await h.http.get('/v1/me/memberships').set('cookie', user.cookie).expect(200, []);
  });

  it('GET /v1/orgs/:orgId trả kênh liên hệ', async () => {
    const user = await signUp(h);
    const id = (
      await create(user.cookie, { name: 'BTC', contactPhone: '+84 901 234 567', contactEmail: 'LH@Vidu.vn' }).expect(201)
    ).body.id;
    const res = await h.http.get(`/v1/orgs/${id}`).set('cookie', user.cookie).expect(200);
    expect(Organization.parse(res.body)).toEqual({
      id,
      name: 'BTC',
      role: 'owner',
      contactPhone: '0901234567',
      contactEmail: 'lh@vidu.vn',
      createdAt: res.body.createdAt,
    });
  });
});

describe('ràng buộc DB', () => {
  const pgCode = (err: unknown) => (err as { code?: string }).code;

  it('Owner thứ hai cho cùng BTC (chèn trực tiếp) bị unique index từ chối', async () => {
    const a = await signUp(h);
    const b = await signUp(h);
    const id = (await create(a.cookie, { name: 'BTC một Owner' }).expect(201)).body.id;
    await expect(
      h.db.pool.query(`INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, [id, b.userId]),
    ).rejects.toSatisfy((err) => pgCode(err) === '23505');
    // Cùng người hai lần trong một BTC cũng bị từ chối.
    await expect(
      h.db.pool.query(`INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin')`, [id, a.userId]),
    ).rejects.toSatisfy((err) => pgCode(err) === '23505');
  });

  it('hai request đồng thời tạo Owner cho cùng một BTC → đúng một bị từ chối', async () => {
    const a = await signUp(h);
    const b = await signUp(h);
    const db = new Database({ connectionString: databaseUrl(), max: 2 });
    try {
      const { rows } = await db.pool.query<{ id: string }>(`INSERT INTO organizations (name) VALUES ('BTC đua') RETURNING id`);
      const orgId = rows[0]!.id;
      const insertOwner = async (userId: string) => {
        const client: pg.PoolClient = await db.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, [orgId, userId]);
          await new Promise((r) => setTimeout(r, 50));
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      };
      const results = await Promise.allSettled([insertOwner(a.userId), insertOwner(b.userId)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(pgCode(rejected[0]!.reason)).toBe('23505');
    } finally {
      await db.close();
    }
  });

  it('mọi bảng có cột organization_id đều NOT NULL (trừ audit_events)', async () => {
    const { rows } = await h.db.pool.query<{ table_name: string; is_nullable: string }>(
      `SELECT table_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'organization_id' ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toContain('members');
    expect(rows.filter((r) => r.table_name !== 'audit_events' && r.is_nullable !== 'NO')).toEqual([]);
  });

  it('tickee_app chỉ INSERT/SELECT audit_events, kể cả sau khi chạy lại migrate', async () => {
    await runMigrations({ MIGRATION_DATABASE_URL: migrationDatabaseUrl() });
    const { rows } = await h.db.pool.query<{ id: string }>(
      `INSERT INTO audit_events (action, target_type, target_id) VALUES ('organization.created', 'test', 'x') RETURNING id`,
    );
    const id = rows[0]!.id;
    await expect(h.db.pool.query(`UPDATE audit_events SET action = 'sua' WHERE id = $1`, [id])).rejects.toSatisfy(
      (err) => pgCode(err) === '42501',
    );
    await expect(h.db.pool.query(`DELETE FROM audit_events WHERE id = $1`, [id])).rejects.toSatisfy(
      (err) => pgCode(err) === '42501',
    );
    await expect(h.db.pool.query(`TRUNCATE audit_events`)).rejects.toSatisfy((err) => pgCode(err) === '42501');
    const still = await h.db.pool.query(`SELECT 1 FROM audit_events WHERE id = $1`, [id]);
    expect(still.rowCount).toBe(1);
  });
});
