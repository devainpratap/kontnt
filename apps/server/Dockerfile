FROM node:22-bookworm-slim

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates bubblewrap \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm install
RUN npm install -g @openai/codex

COPY . .

EXPOSE 3001

CMD ["npm", "run", "dev:server"]
