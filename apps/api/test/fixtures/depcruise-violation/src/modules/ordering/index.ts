// Cố ý vi phạm: ordering → event được phép, nhưng chỉ schema.ts mới được import schema.ts của mô-đun khác.
import { events } from '../event/schema.js';

export const o = events;
