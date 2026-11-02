import { RequestMethod, type INestApplicationContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { Permission } from '@tickee/contracts';
import { REQUIRE_PERMISSION_KEY, REQUIRE_PLATFORM_ADMIN_KEY } from '../../src/platform/access/index.js';
import { PUBLIC_ROUTE_KEY } from '../../src/platform/http/index.js';

export interface DiscoveredRoute {
  method: string;
  /** Đường dẫn đầy đủ kèm tiền tố `/v1`, vd. `/v1/orgs/:orgId`. */
  path: string;
  permission: Permission | undefined;
  /** Mang `@RequirePlatformAdmin()` (ở handler hoặc controller). */
  platformAdmin: boolean;
  /** Mang `@Public()` / `@AllowAnonymous()`. */
  isPublic: boolean;
  handler: string;
}

/** Route dưới `/v1/orgs/:<tham số>` — bắt buộc mang `@RequirePermission`. */
export const ORG_ROUTE = /^\/v1\/orgs\/:[^/]+(\/|$)/;

/** Route dưới `/v1/admin` — bắt buộc mang `@RequirePlatformAdmin()`. */
export const ADMIN_ROUTE = /^\/v1\/admin(\/|$)/;

const asArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [typeof v === 'string' ? v : '/']);
const join = (...parts: string[]) => `/${parts.flatMap((p) => p.split('/')).filter(Boolean).join('/')}`;

/**
 * Duyệt mọi route HTTP đã đăng ký bằng `DiscoveryService` + `MetadataScanner` (app phải import `DiscoveryModule`).
 * Đọc `@RequirePermission`, `@RequirePlatformAdmin()` và `@Public()` ở cả handler lẫn controller như các guard.
 */
export function discoverRoutes(app: INestApplicationContext): DiscoveredRoute[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const routes: DiscoveredRoute[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { metatype, instance } = wrapper;
    if (!metatype || !instance) continue;
    const controllerPaths = asArray(Reflect.getMetadata(PATH_METADATA, metatype));
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name] as (...args: unknown[]) => unknown;
      const methodPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      if (methodPath === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      const targets = [handler, metatype];
      const permission = reflector.getAllAndOverride<Permission | undefined>(REQUIRE_PERMISSION_KEY, targets);
      const platformAdmin = reflector.getAllAndOverride<boolean | undefined>(REQUIRE_PLATFORM_ADMIN_KEY, targets) === true;
      const isPublic = reflector.getAllAndOverride<boolean | undefined>(PUBLIC_ROUTE_KEY, targets) === true;
      for (const c of controllerPaths) {
        for (const m of asArray(methodPath)) {
          routes.push({
            method,
            path: join('v1', c, m),
            permission,
            platformAdmin,
            isPublic,
            handler: `${metatype.name}.${name}`,
          });
        }
      }
    }
  }
  return routes;
}
