import { randomUUIDv7 } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  FORM_QUESTION_FIELDS,
  FORM_QUESTIONS_MAX,
  FormOrderInput,
  FormQuestionInput,
  FormQuestionKind,
  type EventForm,
  type FormOption,
  type FormQuestion,
  type FormQuestionField,
} from '@tickee/contracts';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import { DATABASE, type Database, type DbExecutor, type Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { UUID } from './event.service.js';
import { eventFormQuestions } from './schema.js';
import { assertEventOfOrganization, lockEventForTicketTypes } from './ticket-type.service.js';

/*
 * Form mua vé (FR-9, Story 2.9): `event` sở hữu `event_form_questions`. Owner và Admin thêm, sửa, xóa và sắp thứ tự
 * câu hỏi riêng; trường mặc định (Tên, SĐT, email) cố định, không lưu. Mọi truy vấn qua `orgScope(ctx)`. Mỗi lần ghi là
 * một transaction: khóa dòng `events` `FOR UPDATE` trước (như Hạng vé), nên các thao tác trên form của cùng Sự kiện chạy
 * tuần tự (đếm trần 20 câu, cấp `position`, dồn `position` khi xóa không bị chen ngang), rồi ghi audit `event_form.*`
 * chỉ kèm tên trường đổi. Không kiểm `status`/khóa Sự kiện (2.10/2.12 thêm guard).
 */

type QuestionRow = typeof eventFormQuestions.$inferSelect;
type QuestionValues = z.output<typeof FormQuestionInput>;
type OrderValues = z.output<typeof FormOrderInput>;

export const formQuestionNotFound = () =>
  new AppError(ErrorCode.FORM_QUESTION_NOT_FOUND, 'Không tìm thấy câu hỏi này.');

const limitReached = () =>
  new AppError(ErrorCode.FORM_QUESTION_LIMIT_REACHED, `Mỗi Sự kiện tối đa ${FORM_QUESTIONS_MAX} câu hỏi.`, {
    details: { limit: FORM_QUESTIONS_MAX },
  });

/** Tập id gửi lên không khớp đúng tập câu hỏi hiện có (thiếu hoặc thừa): cùng dạng lỗi với `parseRequest`. */
const orderMismatch = () =>
  new AppError(ErrorCode.VALIDATION_FAILED, 'Yêu cầu không hợp lệ.', {
    details: { issues: [{ path: 'questionIds', code: 'custom' }] },
  });

const questionOf = (row: QuestionRow): FormQuestion => ({
  id: row.id,
  position: row.position,
  label: row.label,
  kind: row.kind,
  required: row.required,
  options: row.kind === FormQuestionKind.CHOICE ? row.options.map((o) => ({ id: o.id, label: o.label })) : [],
});

/**
 * Phương án sẽ lưu. Câu `text`: `[]`. Câu `choice`: phương án có `id` trùng một phương án hiện có của chính câu này giữ
 * id đó; còn lại (không có id, id lạ hoặc của câu khác) là phương án mới, server cấp id (UUIDv7). Client không tự đặt id.
 */
function optionsOf(input: QuestionValues, current: readonly FormOption[] = []): FormOption[] {
  if (input.kind !== FormQuestionKind.CHOICE) return [];
  const existing = new Set(current.map((o) => o.id));
  return input.options.map((o) => {
    const id = o.id?.toLowerCase();
    return { id: id && existing.has(id) ? id : randomUUIDv7(), label: o.label };
  });
}

const sameOptions = (a: readonly FormOption[], b: readonly FormOption[]) =>
  a.length === b.length && a.every((o, i) => o.id === b[i]?.id && o.label === b[i]?.label);

/** Tên các trường đổi (theo `FORM_QUESTION_FIELDS`); `options` đổi khi thêm, bớt, đổi nhãn hay đổi thứ tự phương án. */
function changedFieldsOf(row: QuestionRow, input: QuestionValues, options: readonly FormOption[]): FormQuestionField[] {
  const changed: Record<FormQuestionField, boolean> = {
    label: row.label !== input.label,
    kind: row.kind !== input.kind,
    required: row.required !== input.required,
    options: !sameOptions(row.kind === FormQuestionKind.CHOICE ? row.options : [], options),
  };
  return FORM_QUESTION_FIELDS.filter((field) => changed[field]);
}

/** Câu hỏi của một Sự kiện thuộc BTC, theo thứ tự. Người gọi đã kiểm Sự kiện. */
function questionsOf(db: DbExecutor, ctx: AccessContext, eventId: string): Promise<QuestionRow[]> {
  return db
    .select()
    .from(eventFormQuestions)
    .where(and(orgScope(ctx)(eventFormQuestions), eq(eventFormQuestions.eventId, eventId)))
    .orderBy(asc(eventFormQuestions.position), asc(eventFormQuestions.id));
}

/**
 * Câu hỏi riêng của form mua theo thứ tự hiện cho Người mua (`position`), đọc theo `eventId` không cần `AccessContext`:
 * Checkout (`GET /v1/events/:slug/checkout`) và tạo Đơn (TX1, sau khi khóa Sự kiện `FOR SHARE` nên không đổi giữa
 * chừng). Người gọi đã tra Sự kiện công khai.
 */
export async function buyerFormQuestions(db: DbExecutor, eventId: string): Promise<FormQuestion[]> {
  const rows = await db
    .select()
    .from(eventFormQuestions)
    .where(eq(eventFormQuestions.eventId, eventId))
    .orderBy(asc(eventFormQuestions.position), asc(eventFormQuestions.id));
  return rows.map(questionOf);
}

/** Câu hỏi `questionId` của Sự kiện (đã khóa); id sai dạng, lạ hoặc thuộc Sự kiện khác → `404 FORM_QUESTION_NOT_FOUND`. */
async function questionIn(tx: Tx, ctx: AccessContext, eventId: string, questionId: string): Promise<QuestionRow> {
  if (!UUID.test(questionId)) throw formQuestionNotFound();
  const [row] = await tx
    .select()
    .from(eventFormQuestions)
    .where(
      and(
        orgScope(ctx)(eventFormQuestions),
        eq(eventFormQuestions.eventId, eventId),
        eq(eventFormQuestions.id, questionId.toLowerCase()),
      ),
    );
  if (!row) throw formQuestionNotFound();
  return row;
}

@Injectable()
export class FormService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Câu hỏi riêng của Sự kiện theo thứ tự; Sự kiện lạ hoặc của BTC khác → `404 EVENT_NOT_FOUND`. */
  async get(ctx: AccessContext, eventId: string): Promise<EventForm> {
    await assertEventOfOrganization(this.db.orm, ctx, eventId);
    const rows = await questionsOf(this.db.orm, ctx, eventId);
    return { questions: rows.map(questionOf) };
  }

  /**
   * Thêm câu hỏi vào cuối form, audit `event_form.question_added`. Sự kiện đã có `FORM_QUESTIONS_MAX` câu →
   * `409 FORM_QUESTION_LIMIT_REACHED`.
   */
  async add(ctx: AccessContext, eventId: string, input: QuestionValues): Promise<FormQuestion> {
    return this.db.transaction(async (tx) => {
      await lockEventForTicketTypes(tx, ctx, eventId);
      const rows = await questionsOf(tx, ctx, eventId);
      if (rows.length >= FORM_QUESTIONS_MAX) throw limitReached();
      const last = rows.at(-1);
      const [row] = await tx
        .insert(eventFormQuestions)
        .values({
          organizationId: ctx.organizationId,
          eventId: eventId.toLowerCase(),
          position: last ? last.position + 1 : 0,
          kind: input.kind,
          label: input.label,
          required: input.required,
          options: optionsOf(input),
        })
        .returning();
      if (!row) throw new Error('INSERT event_form_questions không trả về dòng nào');
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'event_form.question_added',
        target: { type: 'event_form_question', id: row.id },
      });
      return questionOf(row);
    });
  }

  /**
   * Sửa câu hỏi (thay toàn bộ các trường). Id câu hỏi và id phương án đã có không đổi. Audit
   * `event_form.question_updated` chỉ khi có trường đổi, `changedFields` là tên trường.
   */
  async update(ctx: AccessContext, eventId: string, questionId: string, input: QuestionValues): Promise<FormQuestion> {
    return this.db.transaction(async (tx) => {
      await lockEventForTicketTypes(tx, ctx, eventId);
      const current = await questionIn(tx, ctx, eventId, questionId);
      const options = optionsOf(input, current.kind === FormQuestionKind.CHOICE ? current.options : []);
      const changedFields = changedFieldsOf(current, input, options);
      if (changedFields.length === 0) return questionOf(current);
      const [row] = await tx
        .update(eventFormQuestions)
        .set({ label: input.label, kind: input.kind, required: input.required, options })
        .where(and(orgScope(ctx)(eventFormQuestions), eq(eventFormQuestions.id, current.id)))
        .returning();
      if (!row) throw formQuestionNotFound();
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'event_form.question_updated',
        target: { type: 'event_form_question', id: row.id },
        changedFields,
      });
      return questionOf(row);
    });
  }

  /** Xóa câu hỏi rồi dồn `position` của các câu sau lên một bậc, audit `event_form.question_removed`. */
  async remove(ctx: AccessContext, eventId: string, questionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockEventForTicketTypes(tx, ctx, eventId);
      const current = await questionIn(tx, ctx, eventId, questionId);
      await tx
        .delete(eventFormQuestions)
        .where(and(orgScope(ctx)(eventFormQuestions), eq(eventFormQuestions.id, current.id)));
      await tx
        .update(eventFormQuestions)
        .set({ position: sql`${eventFormQuestions.position} - 1` })
        .where(
          and(
            orgScope(ctx)(eventFormQuestions),
            eq(eventFormQuestions.eventId, current.eventId),
            gt(eventFormQuestions.position, current.position),
          ),
        );
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'event_form.question_removed',
        target: { type: 'event_form_question', id: current.id },
      });
    });
  }

  /**
   * Sắp lại thứ tự theo `questionIds` (phải đúng tập câu hỏi hiện có: thiếu hoặc thừa → `400 VALIDATION_FAILED` tại
   * `questionIds`; trùng đã lỗi ở contracts). Audit `event_form.reordered` (đối tượng: Sự kiện) chỉ khi thứ tự đổi.
   */
  async reorder(ctx: AccessContext, eventId: string, input: OrderValues): Promise<EventForm> {
    return this.db.transaction(async (tx) => {
      await lockEventForTicketTypes(tx, ctx, eventId);
      const rows = await questionsOf(tx, ctx, eventId);
      const ids = input.questionIds.map((id) => id.toLowerCase());
      const byId = new Map(rows.map((row) => [row.id, row]));
      if (ids.length !== rows.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) {
        throw orderMismatch();
      }
      const moved = ids.flatMap((id, position) => {
        const row = byId.get(id)!;
        return row.position === position ? [] : [{ id, position }];
      });
      if (moved.length === 0) return { questions: rows.map(questionOf) };
      for (const { id, position } of moved) {
        await tx
          .update(eventFormQuestions)
          .set({ position })
          .where(and(orgScope(ctx)(eventFormQuestions), eq(eventFormQuestions.id, id)));
      }
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'event_form.reordered',
        target: { type: 'event', id: eventId.toLowerCase() },
      });
      const reordered = await questionsOf(tx, ctx, eventId);
      return { questions: reordered.map(questionOf) };
    });
  }
}
