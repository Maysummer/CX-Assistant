# GTCO TECH 16 — Topic 2: Instagram CX Assistant

Node.js + Express service that automates **Instagram DM** customer support for **GTCO SME** merchants who sell through the **micro-business digital storefront** ecosystem (**Topic 1: AI StoreBuilder** provides the canonical catalogue and published store configuration).

## How Topic 1 and Topic 2 connect

| Concern | Owner | This repo (Topic 2) |
|--------|--------|---------------------|
| Product catalogue, storefront copy, structured merchandising | **Topic 1 — AI StoreBuilder** | Consumes **`STOREFRONT_API_BASE_URL`** (`storefrontApi.js`) |
| DM automation, tone, session memory, escalation, owner reminders | **Topic 2 — Instagram CX** | `bot.js`, `webhook.js`, `ownerFollowUps.js` |
| Optional cache / demo data | Supabase | `sql/schema.sql` when Topic 1 API is not wired yet |

Set `STOREFRONT_API_BASE_URL` (and `STOREFRONT_API_KEY`) in production so answers always match what the merchant published in StoreBuilder. Without it, the bot uses Supabase fallback rows (labelled in context for demos).

## Quick start

1. Copy `.env.example` to `.env`.
2. Run `sql/schema.sql` on a new project, **or** run `sql/migration_gtco_topic2.sql` if you already applied an older single-tenant schema.
3. `npm install` && `npm start` (default port **3000**).
4. Expose HTTPS and register Meta webhook `https://<host>/webhook`.

## Behaviour (Topic 2 brief)

- Fast, consistent answers from **Topic 1** context when configured.
- **`ESCALATE`** line (model-internal): stripped before the customer sees the reply; logged for human handoff.
- **`OWNER_TASK:`** lines: stripped from the DM; stored in **`owner_follow_ups`** for merchant reminders (wire to SME dashboard / push).

## Layout

- `storefrontApi.js` — HTTP client for **Topic 1** catalogue/context (and optional order POST stub).
- `context.js` — Builds Claude context from Topic 1 API, else Supabase fallback.
- `webhook.js` — Uses **`entry.id`** as `merchantScopedId` for multi-merchant routing.
- `bot.js` — Claude system prompt aligned to GTCO SME Instagram CX.
- `ownerFollowUps.js` — Parses and persists owner reminder lines.
- `supabase.js` — Sessions keyed by **`(merchant_scoped_id, instagram_user_id)`**.

## Escalation & owner tasks

See inline comments in `bot.js` and `ownerFollowUps.js`.
