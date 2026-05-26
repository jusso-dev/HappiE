FROM rust:bookworm AS builder
WORKDIR /app
COPY services/api/Cargo.toml services/api/Cargo.toml
COPY services/api/src services/api/src
COPY infra/migrations infra/migrations
RUN cd services/api && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/services/api/target/release/heylo-api /usr/local/bin/heylo-api
CMD ["heylo-api"]
