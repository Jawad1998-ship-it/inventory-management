Inventory Sync Backend (MVP)

Features
- Express API with health endpoint
- Shopify install/callback + webhook stubs
- Prisma schema for products/variants, bundles, locations, inventory levels, reservations
- Redis/BullMQ scaffold for async jobs

Getting started
1) Copy .env.example to .env and fill variables (Postgres, Redis, Shopify keys).
2) Install deps:
   npm install
3) Generate Prisma client:
   npx prisma generate
4) Create DB and run initial migration:
   npx prisma migrate dev --name init
5) Start dev server:
   npm run dev

Endpoints
- GET /health
- GET /shopify/install?shop=your-shop.myshopify.com
- GET /shopify/callback
- POST /shopify/webhook
