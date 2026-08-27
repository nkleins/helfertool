FROM node:24-slim
ENV NODE_ENV=production
ENV NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /data
EXPOSE 8080
CMD ["node", "src/server.js"]
