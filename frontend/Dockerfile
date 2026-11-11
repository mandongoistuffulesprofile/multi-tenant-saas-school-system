FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# npm/cli#4828: the checked-in lockfile was generated on a glibc host and may
# only carry the linux-x64-gnu optional binaries, so a musl image ships without
# the native rollup module. Install exactly once, then re-add the missing
# musl binary at the resolved rollup version.
# Registry fetch retries: CI/staging networks are flaky and a single timeout
# should not fail an image build.
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && (npm ci --include=optional --no-audit --no-fund \
  || (rm -f package-lock.json && npm install --include=optional --no-audit --no-fund)) \
 && ROLLUP_V="$(node -e "console.log(require('rollup/package.json').version)")" \
 && npm install --no-save --no-audit --no-fund "@rollup/rollup-linux-x64-musl@$ROLLUP_V"
COPY . .
RUN npm run build

# nginx-mod-http-brotli serves the precompressed .br/.gz variants Vite emits,
# skipping per-request CPU on every response.
FROM nginx:1.27-alpine
RUN apk --no-cache add nginx-mod-http-brotli
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80