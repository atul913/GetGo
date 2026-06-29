# Base Node image
FROM node:20-alpine AS base
WORKDIR /usr/src/app

# Stage 1: Install all dependencies (development + production)
FROM base AS dependencies
COPY server/package*.json ./server/
WORKDIR /usr/src/app/server
RUN npm ci

# Stage 2: Development target
FROM dependencies AS development
WORKDIR /usr/src/app
COPY server/ ./server/
COPY client/ ./client/
EXPOSE 3000
WORKDIR /usr/src/app/server
CMD ["npm", "run", "dev"]

# Stage 3: Build production assets and prune devDependencies
FROM dependencies AS build
WORKDIR /usr/src/app/server
RUN npm prune --production

# Stage 4: Production runner image
FROM base AS production
COPY --from=build /usr/src/app/server/node_modules ./server/node_modules
COPY server/ ./server/
COPY client/ ./client/
EXPOSE 3000
WORKDIR /usr/src/app/server
CMD ["node", "server.js"]