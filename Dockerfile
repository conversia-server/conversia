# =========================================
# Convers IA – Dockerfile para Fly.io
# =========================================

FROM node:18-alpine

# Atualiza e instala Chromium + dependências
RUN apk update && apk add --no-cache \
  chromium \
  chromium-chromedriver \
  udev \
  ttf-freefont \
  nss \
  harfbuzz \
  ca-certificates \
  bash \
  git

# Define variáveis para o Puppeteer/WWebJS usar o Chromium instalado
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Diretório de trabalho
WORKDIR /app

# Copia arquivos
COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 10000

CMD ["node", "server.js"]
