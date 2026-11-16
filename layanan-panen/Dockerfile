FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json .
RUN npm install --omit=dev && npm cache clean --force
COPY server.js .
# folder foto produk (dipasang sebagai volume, dibaca gateway di /uploads/)
RUN mkdir -p /data/uploads/produk && chown -R node:node /data/uploads
USER node
EXPOSE 3000
CMD ["node", "server.js"]
