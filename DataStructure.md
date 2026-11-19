mlp-tcg-online/

├── 1_frontend/

|   └── dist/

|   └──node\_modules/

│   ├── public/

│   └── src/

│       ├── components/

│       │   ├── AdminPanel.css / tsx

│       │   ├── AuthModal.css / tsx

│       │   ├── BackgroundUploader.css / tsx

│       │   ├── CardPreviewModal.css / tsx

│       │   ├── DeckBuilder.css / tsx

│       │   ├── FanPageHub.css / tsx

│       │   ├── GameBoard.css / tsx

│       │   ├── Login.tsx

│       │   ├── MainHub.css / tsx

│       │   ├── Navbar.css / tsx

│       │   ├── RulesGlossaryTab.css / tsx

│       │   ├── ShopView.css / tsx

│       │   ├── Signup.tsx

│       │   ├── StableHub.css / tsx

│       │   ├── StandingsHub.css / tsx

│       │   └── VerifyEmail.tsx

│       ├── context/

│       │   └── AuthContext.tsx

│       ├── App.tsx

│       ├── config.ts

│       ├── index.css

│       └── main.tsx

|   └──index.html

|   └──package.json

|   └──package-lock.json

|   └──vite.config.ts

├── 2_backend/

│   ├── middleware/

│       └── authMiddleware.ts

│   ├──  node_modules

│   ├── routes/

│       ├── admin.ts

│       ├── auth.ts

│       ├── cards.ts

│       ├── decks.ts

│       ├── forum.ts

│       ├── media.ts

│       ├── ranked.ts

│       └── shops.ts

│   ├── services/

│       └── mailer.ts

│   ├── utils

│       └── contentModerator.ts

│   ├── websocket/

│       └── gameManager.ts

│   └── index.ts

│   └── package.json

│   └── package-lock.json

├── 3_engine/

│       ├── gameRules.ts

│       ├── effectParser.ts

│       ├── types.ts

│       ├── gameManager.ts

├── 4_data/

├── .env

├── .gitignore

├── package.json

├── package-lock.json

└── tsconfig.json

