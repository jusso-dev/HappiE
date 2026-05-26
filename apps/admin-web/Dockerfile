FROM node:22-bookworm AS deps
WORKDIR /app
COPY apps/admin-web/package.json apps/admin-web/package.json
RUN cd apps/admin-web && npm install

FROM node:22-bookworm AS runner
WORKDIR /app/apps/admin-web
COPY --from=deps /app/apps/admin-web/node_modules ./node_modules
COPY apps/admin-web .
EXPOSE 3000
CMD ["npm", "run", "dev"]
