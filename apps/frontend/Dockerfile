FROM node:20-bookworm AS builder

WORKDIR /app

# Copy frontend package.json first for better layer caching
COPY apps/frontend/package.json ./package.json

# Install only frontend dependencies (no workspace, no backend deps)
RUN npm install --no-package-lock

# Copy all frontend source files
COPY apps/frontend/ ./

ARG VITE_API_URL=https://video-grabber-api.mxdhavgautam.com/api
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

FROM nginx:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1

