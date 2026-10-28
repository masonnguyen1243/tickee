/**
 * Ranh giới của apps/web (AD-11): web chỉ render và gọi REST /v1 —
 * không driver DB, không job queue, không import code của apps/api.
 */
const DB_PACKAGES = '(pg|pg-[^/]+|drizzle-orm|pg-boss)';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'web-no-db-driver',
      comment: 'apps/web không được dùng driver DB hay pg-boss; dữ liệu chỉ lấy qua REST /v1.',
      severity: 'error',
      from: {},
      to: { path: [`^${DB_PACKAGES}(/|$)`, `(^|/)node_modules/${DB_PACKAGES}/`] },
    },
    {
      name: 'web-no-api-import',
      comment: 'apps/web không import @tickee/api hay đường dẫn apps/api; dùng chung qua @tickee/contracts.',
      severity: 'error',
      from: { pathNot: '^\\.\\./' },
      to: { path: ['^@tickee/api(/|$)', '(^|/)apps/api/', '^\\.\\./api/'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules', '^\\.\\./api/'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.mjs'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
