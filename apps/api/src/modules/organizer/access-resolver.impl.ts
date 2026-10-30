import { Inject, Injectable } from '@nestjs/common';
import type { Role } from '@tickee/contracts';
import type { AccessResolver } from '../../platform/access/index.js';
import { OrganizerService } from './organizer.service.js';

/** Cài đặt cổng `AccessResolver` của `platform/access` bằng bảng `members`. */
@Injectable()
export class MemberAccessResolver implements AccessResolver {
  constructor(@Inject(OrganizerService) private readonly organizer: OrganizerService) {}

  resolve(userId: string, organizationId: string): Promise<{ role: Role } | null> {
    return this.organizer.roleOf(userId, organizationId);
  }
}
