# syntax=docker/dockerfile:1
FROM node:18-bullseye-slim AS base

WORKDIR /app

# System deps for sqlite3 native build
RUN apt-get update && apt-get install -y \
  python3 make g++ libsqlite3-dev sqlite3 \
  && rm -rf /var/lib/apt/lists/*

# Install only prod deps first
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Ensure runtime folders exist
RUN mkdir -p /app/data /app/static/uploads

EXPOSE 3000

CMD ["node", "server.js"]


