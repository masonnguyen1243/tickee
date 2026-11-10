import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { IDEMPOTENCY_KEY_HEADER, type BuyerOrder, type CheckoutForm } from '@tickee/contracts';
import type { Request, Response } from 'express';
import { OrdersService, type Buyer } from './orders.service.js';

/**
 * Request đã qua guard session (route không `@Public`): `req.user` là user của session. Đọc trực tiếp, không import
 * `identity` (AD-10).
 */
type BuyerRequest = Request & { user: { id: string; email: string; name?: string | null } };

const buyerOf = (req: BuyerRequest): Buyer => ({
  id: req.user.id,
  email: req.user.email,
  name: req.user.name?.trim() ? req.user.name.trim() : null,
});

/** IP của request (`req.ip` theo `TRUST_PROXY_HOPS`), như bộ đếm OTP. */
const clientIp = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';

/**
 * Checkout và Đơn của Người mua (Story 3.2). Cần đăng nhập, đã đồng ý NĐ 13 và đã qua lớp hai (nếu bật 2FA): guard toàn
 * cục của `identity`. Mọi response có thông tin cá nhân (tên, SĐT, email, câu trả lời) nên `cache-control: no-store`.
 */
@Controller()
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  /** `GET /v1/events/:slug/checkout`: câu hỏi form mua + tự điền tên, SĐT, email. */
  @Get('events/:slug/checkout')
  @Header('cache-control', 'no-store')
  checkout(@Param('slug') slug: string, @Req() req: BuyerRequest): Promise<CheckoutForm> {
    return this.orders.checkoutForm(buyerOf(req), slug);
  }

  /**
   * `POST /v1/events/:slug/orders` (header `Idempotency-Key`): `201` Đơn mới `pending`; `200` Đơn đã tạo trước đó với
   * cùng khóa. Lỗi: `400 VALIDATION_FAILED`, `404 EVENT_NOT_FOUND`, `409 TICKET_TYPE_SOLD_OUT` / `NOT_ON_SALE` /
   * `PENDING_ORDER_EXISTS`, `429 ORDER_RATE_LIMITED`.
   */
  @Post('events/:slug/orders')
  @Header('cache-control', 'no-store')
  async create(
    @Param('slug') slug: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @Body() body: unknown,
    @Req() req: BuyerRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BuyerOrder> {
    const { order, created } = await this.orders.create(buyerOf(req), clientIp(req), slug, key, body);
    res.status(created ? 201 : 200);
    return order;
  }

  /** `GET /v1/me/orders/:code`: Đơn của chính Người mua; không có hoặc của người khác → `404 ORDER_NOT_FOUND`. */
  @Get('me/orders/:code')
  @Header('cache-control', 'no-store')
  mine(@Param('code') code: string, @Req() req: BuyerRequest): Promise<BuyerOrder> {
    return this.orders.mine(buyerOf(req), code);
  }
}
