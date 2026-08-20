# ── estágio 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
# VITE_API_URL é passado como build arg pelo Coolify
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
# Idem SOURCE_COMMIT — sem ele a versão publicada sai como "dev", já que não há
# git dentro desta imagem para descobrir o commit sozinho.
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=$SOURCE_COMMIT
RUN npm run build

# ── estágio 2: servir com Nginx ───────────────────────────────────────────────
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
