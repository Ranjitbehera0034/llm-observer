FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY packages/database/package.json packages/database/
COPY packages/proxy/package.json packages/proxy/
COPY packages/dashboard/package.json packages/dashboard/

RUN npm install

COPY . .

# Dist build for typescript projects, Vite UI bundle for dashboard
RUN npm run build 

FROM node:20-alpine
WORKDIR /app
# We run out of the built builder for monorepo resolution
COPY --from=builder /app /app

# Ensure database target volumes exist for permissions
RUN mkdir -p /root/.llm-observer && chmod 777 /root/.llm-observer

EXPOSE 4000 4001

CMD ["npm", "run", "dev:all"]
