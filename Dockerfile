FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY frontend ./frontend
COPY assets ./assets
# Headless-Chrome PDF pipeline (perfect Devanagari/IAST shaping) + Latin fallback fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-dejavu-core fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium
# data/ is mounted or copied; copy if present at build time
COPY data ./data
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
