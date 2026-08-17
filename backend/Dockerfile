FROM node:20-alpine
# Converte o áudio gravado pelo atendente para Ogg/Opus. O Chrome só grava
# WebM, container que o WhatsApp não reproduz.
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src/ ./src/
EXPOSE 3001
CMD ["node", "src/app.js"]
