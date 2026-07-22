FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg git python3 \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && git clone --depth 1 --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /root/bgutil-ytdlp-pot-provider \
  && cd /root/bgutil-ytdlp-pot-provider/server \
  && npm ci \
  && npx tsc \
  && npm prune --omit=dev \
  && mkdir -p /root/.config/yt-dlp/plugins \
  && curl -fsSL https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/1.3.1/bgutil-ytdlp-pot-provider.zip -o /root/.config/yt-dlp/plugins/bgutil.zip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY public ./public
COPY server.mjs ./

ENV NODE_ENV=production \
    YT_DLP_EXTRACTOR_ARGS=youtube:player_client=mweb
EXPOSE 3000
CMD ["npm", "start"]
