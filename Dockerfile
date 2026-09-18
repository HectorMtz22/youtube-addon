FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

ARG YTDLP_VERSION
RUN test -n "$YTDLP_VERSION" \
 && curl -fsSL -o yt-dlp \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" \
 && curl -fsSL \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/SHA2-256SUMS" \
      | grep -E "  yt-dlp$" | sha256sum -c - \
 && install -m 0755 yt-dlp /usr/local/bin/yt-dlp \
 && rm -f yt-dlp

# bgutil poToken provider plugin (see POT_PROVIDER_URL in compose/env)
RUN mkdir -p /home/node/.config/yt-dlp/plugins \
 && curl -fsSL -o /home/node/.config/yt-dlp/plugins/bgutil-ytdlp-pot-provider.zip \
      "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip" \
 && chown -R node:node /home/node/.config

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

USER node
EXPOSE 7000
CMD ["node", "src/index.js"]
