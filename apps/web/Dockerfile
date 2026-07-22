FROM node:22-bookworm-slim

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm install

COPY . .

# Build the production bundle. In the single-port production model the server
# container serves this dist; this standalone image serves it via `vite preview`.
RUN npm run build:web

EXPOSE 4173

# The dev compose service overrides this with `npm run dev ... --port 5173`.
# The default (production) command serves the built dist.
CMD ["npm", "exec", "--workspace", "@semantic-seo/web", "--", "vite", "preview", "--host", "0.0.0.0", "--port", "4173"]
