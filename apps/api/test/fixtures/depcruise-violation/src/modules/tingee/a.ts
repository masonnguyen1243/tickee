// Cố ý vi phạm: vòng a ↔ b.
import { b } from './b.js';

export const a = (): string => b();
