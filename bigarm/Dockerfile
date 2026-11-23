FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3200
COPY --chown=node:node package.json ./
COPY --chown=node:node rules ./rules
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
USER node
EXPOSE 3200
CMD ["node", "server/index.js"]
