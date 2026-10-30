import { RequestMethod, type INestApplicationContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { Permission } from '@tickee/contracts';
import { REQUIRE_PERMISSION_KEY } from '../../src/platform/access/index.js';

export interface DiscoveredRoute {
  method: string;
  /** Đường dẫn đầy đủ kèm tiền tố `/v1`, vd. `/v1/orgs/:orgId`. */
  path: string;
  permission: Permission | undefined;
  handler: string;
}

/** Route dưới `/v1/orgs/:<tham số>` — bắt buộc mang `@RequirePermission`. */
export const ORG_ROUTE = /^\/v1\/orgs\/:[^/]+(\/|$)/;

const asArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [typeof v === 'string' ? v : '/']);
const join = (...parts: string[]) => `/${parts.flatMap((p) => p.split('/')).filter(Boolean).join('/')}`;

/**
 * Duyệt mọi route HTTP đã đăng ký bằng `DiscoveryService` + `MetadataScanner` (app phải import `DiscoveryModule`).
 * Đọc `@RequirePermission` ở cả handler lẫn controller như `PermissionGuard`.
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
      const permission = reflector.getAllAndOverride<Permission | undefined>(REQUIRE_PERMISSION_KEY, [handler, metatype]);
      for (const c of controllerPaths) {
        for (const m of asArray(methodPath)) {
          routes.push({ method, path: join('v1', c, m), permission, handler: `${metatype.name}.${name}` });
        }
      }
    }
  }
  return routes;
}
