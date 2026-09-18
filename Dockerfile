FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

ARG YTDLP_VERSION
RUN test -n "$YTDLP_VERSION" \
 && curl -fsSL -o /usr/local/bin/yt-dlp \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" \
 && curl -fsSL \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/SHA2-256SUMS" \
      | grep -E "  yt-dlp$" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/yt-dlp

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

USER node
EXPOSE 7000
CMD ["node", "src/index.js"]
