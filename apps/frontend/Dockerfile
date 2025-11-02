FROM node:20-bookworm AS builder

WORKDIR /app

COPY package.json ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/package.json apps/backend/package.json

# Install all dependencies without package-lock to avoid optional deps bug
RUN npm install --no-package-lock

COPY apps/frontend ./apps/frontend

WORKDIR /app/apps/frontend

ARG VITE_API_URL=https://video-grabber-api.mxdhavgautam.com/api
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

FROM nginx:1.27-alpine

COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1

