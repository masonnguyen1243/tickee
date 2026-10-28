# syntax=docker/dockerfile:1
# Một image cho ba vai: APP_ROLE=api | worker | migrate.
# Build từ gốc repo: docker build -f apps/api/Dockerfile -t tickee-api:<sha> .

ARG NODE_IMAGE=node:26.12.1-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@12.15.0 && pnpm --version

FROM base AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @tickee/api... --filter tickee
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm turbo build --filter @tickee/api...
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @tickee/api deploy --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
