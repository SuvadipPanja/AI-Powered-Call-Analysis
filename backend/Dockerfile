###############################################################################
# 1) BUILD STAGE – installs & compiles native modules (e.g. bcrypt) for Linux #
###############################################################################
FROM node:18-alpine AS builder

# Tools needed to compile native Node addons (bcrypt only — Docker prod uses tedious, not msnodesqlv8)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy only dependency manifests first, to maximise Docker cache use
COPY package*.json ./

# Skip msnodesqlv8 native compile (needs ODBC; not used when DB_USE_WINDOWS_AUTH=false)
RUN npm ci --production --ignore-scripts

# Copy your full source tree (routes, controllers, etc.).
# NOTE: .env is excluded via .dockerignore — provide secrets at runtime
# (docker run --env-file / -e, or your orchestrator's secret store).
COPY . .

# Rebuild bcrypt native module only
RUN npm rebuild bcrypt --build-from-source

###############################################################################
# 2) RUNTIME STAGE – slim image, no build toolchain, ready for production     #
###############################################################################
FROM node:18-alpine

WORKDIR /app

# Copy everything from the builder stage (code + pre-built node_modules)
COPY --from=builder /app /app

# Create runtime directories expected by server.js and .env
RUN mkdir -p \
      /app/data/Sample_Audio \
      /app/data/Chat_Dump   \
      /app/logs             \
      /app/license

# Expose Express and WebSocket ports (from your .env)
EXPOSE 5000 8080

ENV NODE_ENV=production

# Start your backend
CMD ["node", "server.js"]
