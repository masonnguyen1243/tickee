import { randomUUID } from 'node:crypto';
import { EventDetail, EventForm, ErrorResponse, FormQuestion, Role } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 2.9: form mua vé (câu hỏi riêng) trên Postgres thật. Thêm/sửa/xóa từng câu và sắp thứ tự, mỗi lần ghi khóa dòng
 * `events` rồi ghi audit `event_form.*` trong cùng transaction.
 */

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let admin: Awaited<ReturnType<typeof signUp>>;
let ownerB: Awaited<ReturnType<typeof signUp>>;
let orgId: string;
let orgB: string;

const draft = { name: 'Giải cầu lông mở rộng', startsAt: '2026-11-16T07:00:00+07:00', endsAt: '2026-11-16T17:00:00+07:00' };
const level = (overrides: Record<string, unknown> = {}) => ({
  label: 'Trình độ',
  kind: 'choice',
  required: true,
  options: [{ label: 'Mới chơi' }, { label: 'Trung bình' }, { label: 'Khá' }],
  ...overrides,
});
const club = (overrides: Record<string, unknown> = {}) => ({
  label: 'Câu lạc bộ',
  kind: 'text',
  required: false,
  ...overrides,
});

beforeAll(async () => {
  h = await createHarness();
  owner = await signUp(h);
  admin = await signUp(h);
  ownerB = await signUp(h);
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Cầu Lông' }).expect(201)).body.id;
  orgB = (await h.http.post('/v1/orgs').set('cookie', ownerB.cookie).send({ name: 'BTC B' }).expect(201)).body.id;
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
});
afterAll(async () => {
  await h.close();
});

async function newEvent(cookie = admin.cookie, org = orgId): Promise<EventDetail> {
  return EventDetail.parse((await h.http.post(`/v1/orgs/${org}/events`).set('cookie', cookie).send(draft).expect(201)).body);
}

const formPath = (eventId: string, org = orgId) => `/v1/orgs/${org}/events/${eventId}/form`;
const questionPath = (eventId: string, questionId: string, org = orgId) =>
  `${formPath(eventId, org)}/questions/${questionId}`;
const add = (eventId: string, body: unknown, cookie = admin.cookie) =>
  h.http.post(`${formPath(eventId)}/questions`).set('cookie', cookie).send(body as object);
const patch = (eventId: string, questionId: string, body: unknown, cookie = admin.cookie) =>
  h.http.patch(questionPath(eventId, questionId)).set('cookie', cookie).send(body as object);
const reorder = (eventId: string, questionIds: unknown, cookie = admin.cookie) =>
  h.http.put(`${formPath(eventId)}/order`).set('cookie', cookie).send({ questionIds });

async function added(eventId: string, body: unknown = level()): Promise<FormQuestion> {
  return FormQuestion.parse((await add(eventId, body).expect(201)).body);
}

async function formOf(eventId: string, cookie = owner.cookie): Promise<EventForm> {
  return EventForm.parse((await h.http.get(formPath(eventId)).set('cookie', cookie).expect(200)).body);
}

async function audits(type: string, id: string) {
  const result = await h.db.orm.execute<{ action: string; actor_user_id: string; changed_fields: string[] }>(
    sql`SELECT action, actor_user_id, changed_fields FROM audit_events
        WHERE organization_id = ${orgId} AND target_type = ${type} AND target_id = ${id} ORDER BY id`,
  );
  return result.rows;
}

async function positions(eventId: string) {
  const result = await h.db.orm.execute<{ label: string; position: number }>(
    sql`SELECT label, position FROM event_form_questions WHERE event_id = ${eventId} ORDER BY position`,
  );
  return result.rows;
}

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;
const issuePaths = (body: unknown) =>
  (errorOf(body).details as { issues: { path: string }[] }).issues.map((i) => i.path);

describe('xem form', () => {
  it('Sự kiện mới: chưa có câu hỏi riêng; Owner và Admin đều đọc được', async () => {
    const event = await newEvent();
    expect(await formOf(event.id)).toEqual({ questions: [] });
    expect(await formOf(event.id, admin.cookie)).toEqual({ questions: [] });
  });
});

describe('thêm câu hỏi', () => {
  it('"Trình độ" lựa chọn, bắt buộc, 3 phương án: 201, nằm cuối, mỗi phương án có id, audit question_added', async () => {
    const event = await newEvent();
    const first = await added(event.id, club());
    const question = await added(event.id);
    expect(question).toMatchObject({ label: 'Trình độ', kind: 'choice', required: true, position: 1 });
    expect(question.options.map((o) => o.label)).toEqual(['Mới chơi', 'Trung bình', 'Khá']);
    expect(new Set(question.options.map((o) => o.id)).size).toBe(3);
    expect(first).toMatchObject({ label: 'Câu lạc bộ', kind: 'text', required: false, position: 0, options: [] });
    expect(await formOf(event.id)).toEqual({ questions: [first, question] });
    expect(await audits('event_form_question', question.id)).toEqual([
      { action: 'event_form.question_added', actor_user_id: admin.userId, changed_fields: [] },
    ]);
  });

  it('nhãn và phương án được trim; id phương án client gửi lên bị bỏ qua (server cấp id)', async () => {
    const event = await newEvent();
    const clientId = randomUUID();
    const question = await added(
      event.id,
      level({ label: '  Size áo ', options: [{ id: clientId, label: ' S ' }, { label: 'M' }] }),
    );
    expect(question.label).toBe('Size áo');
    expect(question.options.map((o) => o.label)).toEqual(['S', 'M']);
    expect(question.options.map((o) => o.id)).not.toContain(clientId);
  });

  it('lựa chọn 1 phương án → 400 VALIDATION_FAILED tại options, không lưu', async () => {
    const event = await newEvent();
    const res = await add(event.id, level({ options: [{ label: 'Khá' }] })).expect(400);
    expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
    expect(issuePaths(res.body)).toEqual(['options']);
    expect(await formOf(event.id)).toEqual({ questions: [] });
  });

  it('phương án trùng ["Khá", " khá "] → 400 tại options; câu văn bản có phương án → 400 tại options', async () => {
    const event = await newEvent();
    const dup = await add(event.id, level({ options: [{ label: 'Khá' }, { label: ' khá ' }] })).expect(400);
    expect(issuePaths(dup.body)).toEqual(['options']);
    const text = await add(event.id, club({ options: [{ label: 'A' }, { label: 'B' }] })).expect(400);
    expect(issuePaths(text.body)).toEqual(['options']);
    const label = await add(event.id, level({ label: ' ' })).expect(400);
    expect(issuePaths(label.body)).toEqual(['label']);
    expect(await formOf(event.id)).toEqual({ questions: [] });
  });

  it('Sự kiện đã có 20 câu → 409 FORM_QUESTION_LIMIT_REACHED, không lưu', async () => {
    const event = await newEvent();
    for (let i = 0; i < 20; i++) await added(event.id, club({ label: `Câu ${i + 1}` }));
    const res = await add(event.id, club({ label: 'Câu 21' })).expect(409);
    expect(errorOf(res.body)).toMatchObject({ code: 'FORM_QUESTION_LIMIT_REACHED', details: { limit: 20 } });
    const form = await formOf(event.id);
    expect(form.questions).toHaveLength(20);
    expect(form.questions.map((q) => q.position)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('hai request thêm câu cùng lúc khi còn 1 chỗ → đúng một request thành công, position không trùng', async () => {
    const event = await newEvent();
    for (let i = 0; i < 19; i++) await added(event.id, club({ label: `Câu ${i + 1}` }));
    const results = await Promise.all([add(event.id, club({ label: 'A' })), add(event.id, club({ label: 'B' }))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const rows = await positions(event.id);
    expect(rows.map((r) => r.position)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('thêm song song khi còn chỗ → position liền nhau, không trùng', async () => {
    const event = await newEvent();
    await Promise.all(Array.from({ length: 5 }, (_, i) => add(event.id, club({ label: `Câu ${i}` })).expect(201)));
    expect((await positions(event.id)).map((r) => r.position)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('sửa câu hỏi', () => {
  it('đổi nhãn: id câu hỏi và id phương án giữ nguyên; audit changedFields [label]', async () => {
    const event = await newEvent();
    const question = await added(event.id);
    const res = await patch(event.id, question.id, { ...level({ label: 'Trình độ cầu lông' }), options: question.options }).expect(200);
    const updated = FormQuestion.parse(res.body);
    expect(updated).toEqual({ ...question, label: 'Trình độ cầu lông' });
    expect(await audits('event_form_question', question.id)).toEqual([
      { action: 'event_form.question_added', actor_user_id: admin.userId, changed_fields: [] },
      { action: 'event_form.question_updated', actor_user_id: admin.userId, changed_fields: ['label'] },
    ]);
  });

  it('gửi lại đúng giá trị → 200, không ghi audit', async () => {
    const event = await newEvent();
    const question = await added(event.id);
    const res = await patch(event.id, question.id, { ...level(), options: question.options }, owner.cookie).expect(200);
    expect(FormQuestion.parse(res.body)).toEqual(question);
    expect(await audits('event_form_question', question.id)).toHaveLength(1);
  });

  it('đổi nhãn một phương án, bớt một, thêm một: phương án cũ giữ id, phương án mới có id mới; audit [options]', async () => {
    const event = await newEvent();
    const question = await added(event.id);
    const [beginner, middle] = question.options;
    const res = await patch(event.id, question.id, {
      ...level(),
      options: [{ id: middle!.id, label: 'Trung bình khá' }, { id: beginner!.id, label: 'Mới chơi' }, { label: 'Giỏi' }],
    }).expect(200);
    const updated = FormQuestion.parse(res.body);
    expect(updated.options.map((o) => o.label)).toEqual(['Trung bình khá', 'Mới chơi', 'Giỏi']);
    expect(updated.options[0]?.id).toBe(middle!.id);
    expect(updated.options[1]?.id).toBe(beginner!.id);
    expect(question.options.map((o) => o.id)).not.toContain(updated.options[2]?.id);
    expect((await audits('event_form_question', question.id)).at(-1)?.changed_fields).toEqual(['options']);
  });

  it('id phương án lạ (của câu khác) → coi là phương án mới, không lấy id đó', async () => {
    const event = await newEvent();
    const a = await added(event.id);
    const b = await added(event.id, level({ label: 'Size áo', options: [{ label: 'S' }, { label: 'M' }] }));
    const res = await patch(event.id, b.id, {
      ...level({ label: 'Size áo' }),
      options: [{ id: b.options[0]!.id, label: 'S' }, { id: a.options[0]!.id, label: 'L' }],
    }).expect(200);
    const updated = FormQuestion.parse(res.body);
    expect(updated.options[0]?.id).toBe(b.options[0]!.id);
    expect(updated.options[1]?.id).not.toBe(a.options[0]!.id);
  });

  it('đổi loại choice → text: phương án bỏ; audit [kind, required, options]', async () => {
    const event = await newEvent();
    const question = await added(event.id);
    const res = await patch(event.id, question.id, club({ label: 'Trình độ' })).expect(200);
    expect(FormQuestion.parse(res.body)).toMatchObject({ id: question.id, kind: 'text', required: false, options: [] });
    expect((await audits('event_form_question', question.id)).at(-1)?.changed_fields).toEqual([
      'kind',
      'required',
      'options',
    ]);
  });

  it('phương án trùng khi sửa → 400 tại options, không đổi gì', async () => {
    const event = await newEvent();
    const question = await added(event.id);
    const res = await patch(event.id, question.id, level({ options: [{ label: 'Khá' }, { label: ' khá ' }] })).expect(400);
    expect(issuePaths(res.body)).toEqual(['options']);
    expect((await formOf(event.id)).questions).toEqual([question]);
  });

  it('câu hỏi lạ, sai dạng hoặc của Sự kiện khác → 404 FORM_QUESTION_NOT_FOUND', async () => {
    const event = await newEvent();
    const other = await newEvent();
    const question = await added(other.id);
    for (const id of [randomUUID(), 'abc', question.id]) {
      const res = await patch(event.id, id, level()).expect(404);
      expect(errorOf(res.body).code, id).toBe('FORM_QUESTION_NOT_FOUND');
    }
  });
});

describe('xóa câu hỏi', () => {
  it('204; các câu sau dồn position; audit question_removed', async () => {
    const event = await newEvent();
    const a = await added(event.id, club({ label: 'A' }));
    const b = await added(event.id, club({ label: 'B' }));
    const c = await added(event.id, club({ label: 'C' }));
    await h.http.delete(questionPath(event.id, b.id)).set('cookie', admin.cookie).expect(204);
    const form = await formOf(event.id);
    expect(form.questions.map((q) => [q.id, q.position])).toEqual([
      [a.id, 0],
      [c.id, 1],
    ]);
    expect((await audits('event_form_question', b.id)).map((r) => r.action)).toEqual([
      'event_form.question_added',
      'event_form.question_removed',
    ]);
    // Thêm sau khi xóa: nằm cuối, position liền nhau.
    const d = await added(event.id, club({ label: 'D' }));
    expect(d.position).toBe(2);
  });

  it('câu hỏi lạ → 404 FORM_QUESTION_NOT_FOUND', async () => {
    const event = await newEvent();
    const res = await h.http.delete(questionPath(event.id, randomUUID())).set('cookie', admin.cookie).expect(404);
    expect(errorOf(res.body).code).toBe('FORM_QUESTION_NOT_FOUND');
  });
});

describe('sắp thứ tự', () => {
  it('PUT …/form/order đúng tập id → thứ tự mới; audit reordered (đối tượng: Sự kiện)', async () => {
    const event = await newEvent();
    const a = await added(event.id, club({ label: 'A' }));
    const b = await added(event.id, level());
    const c = await added(event.id, club({ label: 'C' }));
    const res = await reorder(event.id, [b.id, a.id, c.id]).expect(200);
    const form = EventForm.parse(res.body);
    expect(form.questions.map((q) => [q.id, q.position])).toEqual([
      [b.id, 0],
      [a.id, 1],
      [c.id, 2],
    ]);
    // Phương án và id không đổi khi đổi thứ tự.
    expect(form.questions[0]).toEqual({ ...b, position: 0 });
    expect(await formOf(event.id)).toEqual(form);
    expect(await audits('event', event.id)).toEqual([
      { action: 'event.created', actor_user_id: admin.userId, changed_fields: [] },
      { action: 'event_form.reordered', actor_user_id: admin.userId, changed_fields: [] },
    ]);
  });

  it('thứ tự không đổi → 200, không ghi audit', async () => {
    const event = await newEvent();
    const a = await added(event.id, club({ label: 'A' }));
    const b = await added(event.id, club({ label: 'B' }));
    await reorder(event.id, [a.id, b.id]).expect(200);
    expect((await audits('event', event.id)).map((r) => r.action)).toEqual(['event.created']);
  });

  it('thiếu, thừa hoặc trùng id → 400 tại questionIds, thứ tự giữ nguyên', async () => {
    const event = await newEvent();
    const a = await added(event.id, club({ label: 'A' }));
    const b = await added(event.id, club({ label: 'B' }));
    const other = await added(await newEvent().then((e) => e.id), club({ label: 'X' }));
    for (const ids of [[a.id], [a.id, b.id, randomUUID()], [b.id, a.id, other.id], [a.id, a.id], [b.id, other.id]]) {
      const res = await reorder(event.id, ids).expect(400);
      expect(errorOf(res.body).code).toBe('VALIDATION_FAILED');
      expect(issuePaths(res.body), JSON.stringify(ids)).toEqual(['questionIds']);
    }
    expect((await formOf(event.id)).questions.map((q) => q.id)).toEqual([a.id, b.id]);
  });
});

describe('cách ly và id sai dạng', () => {
  it('câu hỏi thật của BTC B qua /orgs/A/… → 404, câu hỏi của B không đổi', async () => {
    const eventA = await newEvent(owner.cookie);
    const eventB = await newEvent(ownerB.cookie, orgB);
    const questionB = FormQuestion.parse(
      (await h.http.post(`${formPath(eventB.id, orgB)}/questions`).set('cookie', ownerB.cookie).send(level()).expect(201))
        .body,
    );
    const cases = [
      { eventId: eventA.id, code: 'FORM_QUESTION_NOT_FOUND' },
      { eventId: eventB.id, code: 'EVENT_NOT_FOUND' },
    ];
    for (const { eventId, code } of cases) {
      const url = questionPath(eventId, questionB.id);
      const patched = await h.http.patch(url).set('cookie', owner.cookie).send(level({ label: 'Bị sửa' }));
      expect(patched.status, url).toBe(404);
      expect(errorOf(patched.body).code, url).toBe(code);
      const deleted = await h.http.delete(url).set('cookie', owner.cookie);
      expect(deleted.status, url).toBe(404);
      expect(errorOf(deleted.body).code, url).toBe(code);
    }
    for (const request of [
      () => h.http.get(formPath(eventB.id)).set('cookie', owner.cookie),
      () => h.http.post(`${formPath(eventB.id)}/questions`).set('cookie', owner.cookie).send(level()),
      () => h.http.put(`${formPath(eventB.id)}/order`).set('cookie', owner.cookie).send({ questionIds: [questionB.id] }),
    ]) {
      const res = await request();
      expect(res.status).toBe(404);
      expect(errorOf(res.body).code).toBe('EVENT_NOT_FOUND');
    }
    // Sắp thứ tự Sự kiện A bằng id câu hỏi của B: không khớp tập câu hỏi của A.
    const mixed = await reorder(eventA.id, [questionB.id], owner.cookie).expect(400);
    expect(issuePaths(mixed.body)).toEqual(['questionIds']);
    const own = await h.http.get(formPath(eventB.id, orgB)).set('cookie', ownerB.cookie).expect(200);
    expect(EventForm.parse(own.body)).toEqual({ questions: [questionB] });
  });

  it('eventId sai dạng với body hợp lệ → 404 EVENT_NOT_FOUND ở mọi route', async () => {
    const bad = 'khong-phai-uuid';
    const requests = [
      () => h.http.get(formPath(bad)).set('cookie', admin.cookie),
      () => h.http.post(`${formPath(bad)}/questions`).set('cookie', admin.cookie).send(level()),
      () => h.http.patch(questionPath(bad, randomUUID())).set('cookie', admin.cookie).send(level()),
      () => h.http.delete(questionPath(bad, randomUUID())).set('cookie', admin.cookie),
      () => h.http.put(`${formPath(bad)}/order`).set('cookie', admin.cookie).send({ questionIds: [] }),
    ];
    for (const [index, request] of requests.entries()) {
      const res = await request();
      expect(res.status, String(index)).toBe(404);
      expect(errorOf(res.body).code, String(index)).toBe('EVENT_NOT_FOUND');
    }
  });
});
