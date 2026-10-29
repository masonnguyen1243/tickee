/** Luật ranh giới mô-đun (AD-10, AD-25), sinh từ `module-graph.cjs`. */
const graph = require('./module-graph.cjs');

const modules = Object.keys(graph);
for (const [from, targets] of Object.entries(graph)) {
  for (const to of targets) {
    if (!modules.includes(to)) throw new Error(`module-graph: ${from} → ${to} không phải mô-đun đã khai báo`);
    if (to === from) throw new Error(`module-graph: ${from} tự trỏ vào chính nó`);
  }
}

const alt = (names) => `(${names.join('|')})`;

/** Gói Better Auth (kể cả adapter NestJS) — chỉ `identity` được import. */
const AUTH_PACKAGES = '(better-auth|@better-auth/[^/]+|@thallesp/nestjs-better-auth)';

/** Với mỗi A: cấm import modules/B khi B ∉ graph[A]. */
const directionRules = modules
  .map((from) => {
    const forbidden = modules.filter((to) => to !== from && !graph[from].includes(to));
    if (forbidden.length === 0) return null;
    return {
      name: `module-direction-${from}`,
      comment: `${from} chỉ được gọi: ${graph[from].join(', ') || '(không mô-đun nào)'} (module-graph.cjs)`,
      severity: 'error',
      from: { path: `^src/modules/${from}/` },
      to: { path: `^src/modules/${alt(forbidden)}/` },
    };
  })
  .filter(Boolean);

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...directionRules,
    {
      name: 'module-public-api-only',
      comment: 'Gọi mô-đun khác chỉ qua modules/<name>/index.ts.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/', pathNot: '/schema\\.ts$' },
      to: {
        path: '^src/modules/[^/]+/.+',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'module-schema-public-api-only',
      comment: 'Ngoại lệ AD-10: schema.ts chỉ được import schema.ts (khai báo khóa ngoại) hoặc index.ts của mô-đun khác.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/schema\\.ts$' },
      to: {
        path: '^src/modules/[^/]+/.+',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/(index|schema)\\.ts$'],
      },
    },
    {
      name: 'outside-public-api-only',
      comment: 'flows, platform, roles gọi mô-đun chỉ qua modules/<name>/index.ts.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/modules/' },
      to: { path: '^src/modules/[^/]+/.+', pathNot: '^src/modules/[^/]+/index\\.ts$' },
    },
    {
      name: 'module-not-to-flows',
      comment: 'Mô-đun không bao giờ gọi flows (AD-25).',
      severity: 'error',
      from: { path: '^src/modules/' },
      to: { path: '^src/flows/' },
    },
    {
      name: 'platform-not-to-domain',
      comment: 'platform là shared kernel, không phụ thuộc mô-đun miền hay flows.',
      severity: 'error',
      from: { path: '^src/platform/' },
      to: { path: '^src/(modules|flows)/' },
    },
    {
      name: 'better-auth-only-in-identity',
      comment: 'Better Auth chỉ được dùng trong modules/identity (AD-19); nơi khác đi qua modules/identity/index.ts.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/modules/identity/' },
      to: {
        path: [`^${AUTH_PACKAGES}(/|$)`, `(^|/)node_modules/${AUTH_PACKAGES}/`],
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.js'] },
  },
};
