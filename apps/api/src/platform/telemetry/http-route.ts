import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { context } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import type { Observable } from 'rxjs';

/** Request Express sau khi router đã khớp route (`req.route.path`: mẫu đã đăng ký, vd. `/v1/orgs/:orgId/token`). */
interface RoutedRequest {
  route?: { path?: unknown } | null;
}

/**
 * Gán mẫu route Nest đã khớp vào `RPCMetadata` của span server mà instrumentation http đã tạo: khi response kết thúc,
 * instrumentation đặt `http.route` lên span (đổi tên thành `GET /v1/orgs/:orgId/token`) và lên metric
 * `http.server.request.duration`. Không có span (telemetry tắt, `/healthz`) thì không làm gì. Request không tới handler
 * Nest (Better Auth, 404) không có route nên span chỉ mang tên method: 404 của Nest đi qua route bắt-tất-cả `*path` dưới
 * tiền tố `/v1`, không phải route đã khớp, nên mẫu có `*` bị bỏ qua (không controller nào dùng wildcard).
 */
export function setHttpRoute(req: RoutedRequest | undefined): void {
  const path = req?.route?.path;
  if (typeof path !== 'string' || path.includes('*')) return;
  const metadata = getRPCMetadata(context.active());
  if (metadata?.type === RPCType.HTTP) metadata.route = path;
}

/**
 * Interceptor toàn cục của vai api (Story 4.6-a): đặt mẫu route cho span server trước khi handler chạy. Request bị guard
 * từ chối không tới interceptor; `ErrorFilter` đặt route cho các request đó.
 */
@Injectable()
export class HttpRouteInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() === 'http') setHttpRoute(ctx.switchToHttp().getRequest<RoutedRequest>());
    return next.handle();
  }
}
