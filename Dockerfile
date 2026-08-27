FROM node:20-slim

WORKDIR /home

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app.js config.json ./
COPY controllers ./controllers
COPY routes ./routes
COPY utils ./utils

EXPOSE 7777

# Override via Kubernetes command; production-oriented defaults below
CMD ["node", "--trace-warnings", "--max-old-space-size=2048", "app.js"]
