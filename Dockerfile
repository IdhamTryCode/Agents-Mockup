# --- deps ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

# --- build ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runtime (standalone) ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3090
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# public/ (figure SVGs) is NOT bundled into standalone output — copy it explicitly.
COPY --from=builder /app/public ./public
# the corpus is read at runtime via fs (not traced by next build), so copy it in
COPY --from=builder /app/data ./data
EXPOSE 3090
CMD ["node", "server.js"]
