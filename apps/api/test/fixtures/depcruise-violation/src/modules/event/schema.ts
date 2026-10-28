// Được phép: event → organizer có trong sơ đồ và schema.ts là ngoại lệ cho khóa ngoại.
import { organizations } from '../organizer/schema.js';

export const events = organizations;
