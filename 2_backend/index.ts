import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { initDatabase, pool } from '../4_data/db.ts';
import { GameManager } from '../3_engine/gameManager.ts';

// Import modular backend routes
import authRouter from './routes/auth.ts';
import cardsRouter from './routes/cards.ts';
import decksRouter from './routes/decks.ts';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Initialize Database connection check
initDatabase();

// Mount REST API endpoints
app.use('/api/auth', authRouter);
app.use('/api/cards', cardsRouter);
app.use('/api/decks', decksRouter);

// Site configuration announcement endpoint
app.get('/api/site/announcement', async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM site_config WHERE key = 'announcement'");
    const message = result.rows.length > 0 ? result.rows[0].value : null;
    res.json({ message });
  } catch {
    res.json({ message: null });
  }
});

// Create HTTP server and bind WebSocket GameManager
const server = createServer(app);
new GameManager(server);

server.listen(PORT, () => {
  console.log(`[SERVER] MLP TCG Backend active on port ${PORT}`);
});