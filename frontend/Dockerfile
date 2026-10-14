FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json server.js index.html app.js styles.css ./
ENV HOST=0.0.0.0 FRONTEND_PORT=5173
EXPOSE 5173
CMD ["node", "server.js"]
