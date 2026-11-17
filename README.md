# MLP TCG Online Simulator (mlp-tcg-engine)

An open-source, web-based My Little Pony Trading Card Game engine and online simulator engineered for real-time multiplayer state management, rule validation, and deck building.

## Core Directory Structure

- `1_frontend/`: React single-page application (components, views, state, and styles).
- `2_backend/`: Node.js & Express API server (auth, decks, shops, routes, services, and WebSockets `gameManager.ts`).
- `3_engine/`: Core TCG game rules engine (`gameRules.ts`, `effectParser.ts`, `types.ts`).
- `4_data/`: Card databases, SQL schemas, and asset synchronization/scraping scripts (`cardDBUpdater.ts`, `verifyR2Assets.ts`, `pullSDFromWiki.ts`).

## Tech Stack & Environment
- **Frontend:** React, TypeScript, Vite, Tailwind CSS.
- **Backend:** Node.js, Express, TypeScript, WebSockets.
- **Database & Storage:** PostgreSQL with UUID keys and Cloudflare R2 object storage for card assets.