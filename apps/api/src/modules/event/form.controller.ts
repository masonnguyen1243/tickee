import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put } from '@nestjs/common';
import { FormOrderInput, FormQuestionInput, Permission, type EventForm, type FormQuestion } from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { parseRequest } from '../../platform/http/index.js';
import { FormService } from './form.service.js';

/**
 * Form mua vé của một Sự kiện (Story 2.9): câu hỏi riêng, thêm/sửa/xóa từng câu và sắp thứ tự. Owner và Admin
 * (`events.manage`). Body được kiểm trước khi chạm DB. Sự kiện lạ, sai dạng hoặc của BTC khác → 404 `EVENT_NOT_FOUND`;
 * câu hỏi lạ → 404 `FORM_QUESTION_NOT_FOUND`.
 */
@Controller('orgs/:orgId/events/:eventId/form')
export class FormController {
  constructor(@Inject(FormService) private readonly form: FormService) {}

  /** Câu hỏi riêng theo thứ tự (trường mặc định cố định, không trả ở đây). */
  @Get()
  @RequirePermission(Permission.EVENTS_MANAGE)
  get(@Access() ctx: AccessContext, @Param('eventId') eventId: string): Promise<EventForm> {
    return this.form.get(ctx, eventId);
  }

  /** Thêm câu hỏi vào cuối form (201). */
  @Post('questions')
  @RequirePermission(Permission.EVENTS_MANAGE)
  add(@Access() ctx: AccessContext, @Param('eventId') eventId: string, @Body() body: unknown): Promise<FormQuestion> {
    return this.form.add(ctx, eventId, parseRequest(FormQuestionInput, body));
  }

  /** Sửa câu hỏi (thay toàn bộ các trường); id câu hỏi và id phương án đã có giữ nguyên. */
  @Patch('questions/:questionId')
  @RequirePermission(Permission.EVENTS_MANAGE)
  update(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Param('questionId') questionId: string,
    @Body() body: unknown,
  ): Promise<FormQuestion> {
    return this.form.update(ctx, eventId, questionId, parseRequest(FormQuestionInput, body));
  }

  /** Xóa câu hỏi (204); Đơn đã đặt vẫn giữ câu trả lời đã chụp. */
  @Delete('questions/:questionId')
  @HttpCode(204)
  @RequirePermission(Permission.EVENTS_MANAGE)
  async remove(
    @Access() ctx: AccessContext,
    @Param('eventId') eventId: string,
    @Param('questionId') questionId: string,
  ): Promise<void> {
    await this.form.remove(ctx, eventId, questionId);
  }

  /** Sắp thứ tự: đúng tập id câu hỏi hiện có, theo thứ tự mới; trả form sau khi sắp. */
  @Put('order')
  @RequirePermission(Permission.EVENTS_MANAGE)
  reorder(@Access() ctx: AccessContext, @Param('eventId') eventId: string, @Body() body: unknown): Promise<EventForm> {
    return this.form.reorder(ctx, eventId, parseRequest(FormOrderInput, body));
  }
}
