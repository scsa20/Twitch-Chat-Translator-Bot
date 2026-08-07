FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile && yarn cache clean

COPY . .
RUN yarn build

# Production stage
FROM node:24-alpine

ENV NODE_ENV=production
ENV IGNORE_USERS_PATH=/data/ignore-users.json
ENV IGNORE_USERS_DIR=/data

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

COPY --from=builder /app/dist ./dist

RUN mkdir -p /data && chown -R node:node /app /data

USER node

VOLUME ["/data"]

CMD ["yarn", "start"]