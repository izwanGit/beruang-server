# Use Node.js LTS
FROM node:20-slim

# Install dependencies for TensorFlow and common build tools
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
# We use --build-from-source for @tensorflow/tfjs-node if needed, 
# but usually slim is enough if build-essential is present
RUN npm install

# Copy app source
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
