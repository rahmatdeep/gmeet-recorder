FROM mcr.microsoft.com/playwright:v1.57.0-jammy

# Install dependencies
RUN apt-get update && apt-get install -y \
    xvfb \
    unzip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
# Install Bun
RUN curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /app

# Copy dependency files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install

# Copy source code
COPY . .

# Copy and setup entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Set display environment variable
ENV DISPLAY=:99

ENTRYPOINT ["/entrypoint.sh"]
