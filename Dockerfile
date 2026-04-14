FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data
ENV UPLOADS_DIR=/data/uploads

RUN mkdir -p /data/uploads

EXPOSE 8080
CMD ["node", "server/index.js"]

