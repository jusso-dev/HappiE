FROM node:22-alpine
WORKDIR /app
COPY apps/mcp/package*.json ./
RUN npm ci --omit=dev
COPY apps/mcp/src ./src
USER node
EXPOSE 3001
CMD ["node", "src/index.js"]
