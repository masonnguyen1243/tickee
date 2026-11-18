import type { BlockList } from 'node:net';
import { Inject, Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { ErrorCode } from '@tickee/contracts';
import type { Request, Response } from 'express';
import { cidrBlockList, isAllowedIp } from '../../platform/config/index.js';
import { AppError } from '../../platform/http/index.js';

/** Token DI của `AdminIpAllowlist` (`ADMIN_ALLOWED_CIDRS`); `null` = không giới hạn (dev/test). */
export const ADMIN_IP_ALLOWLIST = Symbol('ADMIN_IP_ALLOWLIST');

/** Danh sách IP được gọi `/v1/admin/*` và số dải theo họ địa chỉ (để log lúc khởi động, không nêu địa chỉ). */
export interface AdminIpAllowlist {
  list: BlockList;
  ipv4Ranges: number;
  ipv6Ranges: number;
}

/** `AdminIpAllowlist` từ các CIDR đã chuẩn hóa của `ADMIN_ALLOWED_CIDRS`. */
export function adminIpAllowlist(cidrs: readonly string[]): AdminIpAllowlist {
  const ipv6Ranges = cidrs.filter((cidr) => cidr.includes(':')).length;
  return { list: cidrBlockList(cidrs), ipv4Ranges: cidrs.length - ipv6Ranges, ipv6Ranges };
}

/** Marker của dòng log `warn` khi chặn một request `/v1/admin/*` theo IP. */
export const ADMIN_IP_BLOCKED = 'admin_ip_blocked';

/** Đường dẫn của request (bỏ query), nhận cả dạng tuyệt đối `http://host/…` mà router Express vẫn khớp route. */
function pathOf(req: Request): string {
  const raw = req.originalUrl ?? req.url;
  try {
    return new URL(raw, 'http://localhost').pathname;
  } catch {
    return raw.split('?', 1)[0]!;
  }
}

/**
 * Giới hạn IP của khu Quản trị Tingee (Story 4.7-a, FR-4, AD-26): `AdminModule` gắn cho mọi đường dẫn `/v1/admin` và
 * `/v1/admin/*` (kể cả route không tồn tại) khi `ADMIN_ALLOWED_CIDRS` được đặt. IP client là `req.ip` của Express (theo
 * `trust proxy` = `TRUST_PROXY_HOPS`). Ngoài danh sách → log `warn` có marker `ADMIN_IP_BLOCKED` (method và đường dẫn,
 * không có IP: PII theo AD-18) rồi `403 ADMIN_IP_NOT_ALLOWED` qua filter lỗi chung, trước `SessionGuard` và mọi truy
 * vấn DB.
 */
@Injectable()
export class AdminIpMiddleware implements NestMiddleware {
  private readonly logger = new Logger('AdminIpMiddleware');

  constructor(@Inject(ADMIN_IP_ALLOWLIST) private readonly allowlist: AdminIpAllowlist) {}

  use(req: Request, _res: Response, next: () => void): void {
    if (isAllowedIp(this.allowlist.list, req.ip)) {
      next();
      return;
    }
    this.logger.warn(
      { marker: ADMIN_IP_BLOCKED, method: req.method, path: pathOf(req) },
      'Chặn request /v1/admin/* từ IP ngoài ADMIN_ALLOWED_CIDRS',
    );
    throw new AppError(ErrorCode.ADMIN_IP_NOT_ALLOWED, 'Bạn đang truy cập từ mạng không được phép vào trang quản trị.');
  }
}
