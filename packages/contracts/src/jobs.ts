/** Tên queue pg-boss (vai `worker`). Tên chỉ gồm chữ, số, `_`, `-`, `.`, `/` (luật của pg-boss). */
export const JobQueue = {
  /** Dọn rác hết hạn của `identity` (bộ đếm giới hạn, verification, session), chạy định kỳ. */
  IDENTITY_PURGE_EXPIRED: 'identity.purge-expired',
} as const;
export type JobQueue = (typeof JobQueue)[keyof typeof JobQueue];
