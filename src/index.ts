import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { agentRouter } from './routes/agent.js';
import { sessionRouter } from './routes/session.js';



// Fail fast if the API key is missing or still set to the placeholder
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey || apiKey === 'your_api_key_here') {
  console.error('❌ GEMINI_API_KEY is not set in server/.env');
  console.error('   Get your key at: https://aistudio.google.com/apikey');
  process.exit(1);
}


const app = new Hono();

// Middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:4200',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    credentials: true,
  })
);

// Routes
app.route('/api/agent', agentRouter);
app.route('/api/session', sessionRouter);
app.get('/health', (c) =>
  c.json({ status: 'ok', model: process.env.GEMINI_MODEL ?? 'gemma-4-31b-it', version: '2.0.0' })
);

// 404 fallback
app.notFound((c) => c.json({ error: 'Not found' }, 404));

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🚀 Server running at http://localhost:${info.port}`);
  console.log(`   Model: ${process.env.GEMINI_MODEL ?? 'gemma-4-31b-it'}`);
});
