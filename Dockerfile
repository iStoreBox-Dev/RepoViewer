FROM node:22-alpine AS builder
WORKDIR /build
COPY package.json vite.config.js app.html ipa.html utilities.html ./
COPY src ./src
RUN npm install --no-audit --no-fund && npm run build

FROM node:22-alpine
WORKDIR /app
COPY server.js ./server.js
COPY public ./public
COPY --from=builder /build/dist ./dist
ENV NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
CMD ["node", "server.js"]
