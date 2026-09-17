FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY lib ./lib
COPY services ./services
COPY views ./views
COPY public ./public
COPY server.js ./

EXPOSE 3000
CMD ["node", "server.js"]
