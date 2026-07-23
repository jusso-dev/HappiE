FROM node:22-bookworm AS deps
WORKDIR /app
COPY apps/admin-web/package.json apps/admin-web/package.json
RUN cd apps/admin-web && npm install

# Local development: compose bind-mounts the source and runs the dev server.
FROM node:22-bookworm AS dev
WORKDIR /app/apps/admin-web
COPY --from=deps /app/apps/admin-web/node_modules ./node_modules
COPY apps/admin-web .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM node:22-bookworm AS build
WORKDIR /app/apps/admin-web
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so the
# browser-reachable API URL must be baked here (set via CI build-arg).
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:18080
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
COPY --from=deps /app/apps/admin-web/node_modules ./node_modules
COPY apps/admin-web .
RUN npm run build

FROM node:22-bookworm-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /app/apps/admin-web/.next/standalone ./
COPY --from=build /app/apps/admin-web/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
