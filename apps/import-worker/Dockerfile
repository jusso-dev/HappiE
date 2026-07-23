FROM node:22-bookworm AS base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip curl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && python3 -m pip install --break-system-packages yt-dlp
WORKDIR /app/apps/import-worker
COPY apps/import-worker/package*.json ./
RUN npm install

# Local development: compose bind-mounts the source and runs tsx.
FROM base AS dev
COPY apps/import-worker .
CMD ["npm", "run", "dev"]

FROM base AS prod
ENV NODE_ENV=production
COPY apps/import-worker .
RUN npm run build && npm prune --omit=dev
CMD ["npm", "run", "start"]
