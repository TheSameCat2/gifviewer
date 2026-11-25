# Build stage
FROM node:20-bookworm AS builder

WORKDIR /app

# Build dependencies for native addons (e.g. better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --prefer-offline

COPY . .
RUN npm run build

# Official FFmpeg 9.1. Debian bookworm, trixie, and sid still ship ffmpeg
# older than 9.1 and mark CVE-2026-135736 unfixed, so the runtime image does
# not install the distro package. 9.1 rejects the deband coupling command that
# caused the heap out-of-bounds write.
FROM debian:bookworm AS ffmpeg

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    nasm \
    pkg-config \
    xz-utils \
    libdav1d-dev \
    libwebp-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

ARG FFMPEG_VERSION=9.1
ARG FFMPEG_SHA256=1a4d394ae63d190a526cd052eb4415c156b5c5e2df37efab41a7de0b8fde2433

RUN curl -fsSL -o ffmpeg.tar.xz "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
    && echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c - \
    && tar -xJf ffmpeg.tar.xz \
    && cd "ffmpeg-${FFMPEG_VERSION}" \
    && ./configure \
        --prefix=/usr/local \
        --disable-debug \
        --disable-doc \
        --disable-ffplay \
        --disable-shared \
        --enable-static \
        --enable-libdav1d \
        --enable-libwebp \
        --pkg-config-flags=--static \
    && make -j"$(nproc)" \
    && make install \
    && strip /usr/local/bin/ffmpeg /usr/local/bin/ffprobe \
    && strings /usr/local/bin/ffmpeg | grep -F "coupling needs a pixel format without chroma subsampling" >/dev/null

# Production stage
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Shared libraries for the FFmpeg build above. libdav1d decodes AV1 WebM
# (the built-in AV1 decoder does not), and libwebp encodes video thumbnails.
# The distro ffmpeg package is not installed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libdav1d6 \
    libwebp7 \
    libwebpmux3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ffmpeg /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /usr/local/bin/ffprobe /usr/local/bin/ffprobe

RUN ffmpeg -version && ffprobe -version

ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
