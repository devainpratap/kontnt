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

# Build the frontend so the server can serve it same-origin in production.
# (Type-checks the server too via `npm run build`, which is a --noEmit tsc pass.)
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV SERVE_WEB=true

EXPOSE 3001

# The dev compose service overrides this with `npm run dev:server`. The default
# (production) command runs the server entry point directly via tsx and serves
# the built web dist thanks to SERVE_WEB=true.
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
