FROM node:22-trixie-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-trixie-slim AS production-deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-trixie-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/package*.json ./
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/db ./db

USER node
CMD ["node", "dist/src/cli.js", "scheduler"]
