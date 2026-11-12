# Backend image. Static binary (CGO_ENABLED=0) so we don't need Alpine at all —
# distroless/static ships CA certs (M-Pesa callbacks) and tzdata (Africa/Nairobi)
# that `scratch` would omit. Non-root by default, minimal attack surface.
#
# BuildKit cache mounts: enable them for faster repeated local builds.
#   export DOCKER_BUILDKIT=1
#   docker buildx build --build-cache .
# Without BuildKit the module download layer still caches on go.mod changes;
# only the per-source recompile penalty is lost (acceptable in CI).
ARG GOLANG_VERSION=1.26
FROM golang:${GOLANG_VERSION}-alpine AS builder
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
# BuildKit cache mounts (optional — silently ignored by the legacy builder):
#   RUN --mount=type=cache,target=/go/pkg/mod \
#       --mount=type=cache,target=/root/.cache/go-build \
#       CGO_ENABLED=0 GOOS=linux go build ...
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -buildvcs=false \
    -o /out/api ./cmd/api \
 && CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -buildvcs=false \
    -o /out/migrate ./cmd/migrate \
 && CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -buildvcs=false \
    -o /out/healthcheck ./cmd/healthcheck

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/api /api
COPY --from=builder /out/migrate /migrate
COPY --from=builder /out/healthcheck /healthcheck
EXPOSE 8080
ENTRYPOINT ["/api"]