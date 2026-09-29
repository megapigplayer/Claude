# Apify-maintained base image: Node.js plus the tooling the platform expects (no browser).
# Tag matches the Node version this monorepo is developed against (Node 22).
# NOTE: this image could not be pulled/built in the offline dev sandbox (no Docker
# daemon there); verify with `docker build .` in an environment with registry access
# before relying on it. See CONVENTIONS.md.
FROM apify/actor-node:22 AS builder

COPY package*.json ./
# Full install (incl. devDependencies) so `npm run build` below has TypeScript available.
RUN npm install --include=dev --audit=false

COPY . ./
RUN npm run build

# Drop devDependencies now that dist/ exists, to keep the final image small.
RUN npm prune --omit=dev --audit=false

FROM apify/actor-node:22

COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/.actor ./.actor

# Actor.init() detects the platform through env vars Apify injects at runtime;
# nothing platform-specific needs to happen at build time.
CMD npm start --silent
