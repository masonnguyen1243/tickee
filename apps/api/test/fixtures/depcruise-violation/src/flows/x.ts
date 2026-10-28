// Cố ý vi phạm: flows gọi mô-đun chỉ qua index.ts.
import { internalOnly } from '../modules/organizer/internal.js';

export const f = internalOnly;
