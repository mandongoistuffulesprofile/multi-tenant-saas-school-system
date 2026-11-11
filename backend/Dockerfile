FROM golang:1.26-alpine AS builder
WORKDIR /app
# Optional local-module proxy for air-gapped/dev builds:
#   docker build --network=host --build-arg GOPROXY=http://127.0.0.1:9096,direct .
# When using a local file proxy, also set GOSUMDB=off — the cache was already
# verified against sum.golang.org when it was populated on the host.
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=${GOSUMDB}
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o api ./cmd/api \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o migrate ./cmd/migrate

FROM alpine:3.20
RUN apk --no-cache add ca-certificates tzdata wget && adduser -D -u 10001 appuser
WORKDIR /app
COPY --chown=appuser:appuser --from=builder /app/api .
COPY --chown=appuser:appuser --from=builder /app/migrate .
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["./api"]
