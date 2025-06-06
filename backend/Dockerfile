# Use Node.js 20 slim as the base image (LTS version, supported until April 2026)
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    vim \
    nano \
    traceroute \
    iputils-ping \
    telnet \
    curl \
    jq \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user for security
RUN useradd -m -s /bin/bash appuser

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker caching
COPY package.json package-lock.json ./

# Install Node.js dependencies (only production dependencies)
RUN npm install --production

# Copy the rest of the backend files
COPY . .

# Create directories specified in the .env file
# These will be used for logs and other purposes
RUN mkdir -p /app/logs /data/Sample_Audio /data/Chat_Dump /models/DeepSeek-R1-Distill-Qwen-1.5B

# Change ownership of the app directory to the non-root user
RUN chown -R appuser:appuser /app /data /models

# Switch to the non-root user
USER appuser

# Expose ports for the Express server (WebSocket is integrated on the same port)
EXPOSE 5000

# Command to start the Express server
CMD ["node", "server.js"]