FROM node:26-alpine AS frontend

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm test
RUN npm run build && npm run build:examples

FROM node:26-alpine AS server

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server ./
RUN npm test
RUN npm run build

FROM node:26-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV STATIC_DIR=/app/dist-examples

COPY --from=server /app/server/package*.json ./server/
COPY --from=server /app/server/node_modules ./server/node_modules
COPY --from=server /app/server/dist ./server/dist
COPY --from=frontend /app/dist-examples ./dist-examples

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
