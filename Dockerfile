# Convers IA – Dockerfile para Fly.io

FROM node:18-slim

# Configurações essenciais
ENV NODE_ENV production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Instalar dependências do Chromium (whatsapp-web.js)
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    ca-certificates \
    fonts-liberation \
    libatk1.0-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Criar diretório do app
WORKDIR /app

# Copiar arquivos
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 10000

CMD ["node", "server.js"]
