FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o api ./cmd/api

FROM alpine:3.20
RUN apk --no-cache add ca-certificates tzdata wget
WORKDIR /root/
COPY --from=builder /app/api .
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["./api"]
