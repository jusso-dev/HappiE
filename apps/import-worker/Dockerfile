FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip curl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && python3 -m pip install --break-system-packages yt-dlp
WORKDIR /app/apps/import-worker
COPY apps/import-worker/package*.json ./
RUN npm install
COPY apps/import-worker .
CMD ["npm", "run", "dev"]
