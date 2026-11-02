import { Module } from '@nestjs/common';
import { ClosedBetaController } from './closed-beta.controller.js';

/**
 * Khu Quản trị Tingee `/v1/admin/*` (AD-26). Mọi controller ở đây mang `@RequirePlatformAdmin()`; guard nằm ở
 * `identity` (đăng ký toàn cục), nên `admin` không phụ thuộc `identity`. Cần `DbModule` (toàn cục) ở gốc DI.
 */
@Module({ controllers: [ClosedBetaController] })
export class AdminModule {}
