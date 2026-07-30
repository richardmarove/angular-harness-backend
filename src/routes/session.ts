import { Hono } from 'hono';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export interface Session {
  id: string;
  workingDir: string;
  createdAt: string;
}

// In-memory session store — replace with SQLite/Redis for persistence
const sessions = new Map<string, Session>();

const sessionRouter = new Hono();

/** POST /api/session — create a new session with a working directory */
sessionRouter.post('/', async (c) => {
  const body = await c.req.json<{ workingDir: string }>();
  const { workingDir } = body;

  if (!workingDir || !workingDir.startsWith('/')) {
    return c.json({ error: 'workingDir must be an absolute path' }, 400);
  }

  try {
    const stat = await fs.stat(workingDir);
    if (!stat.isDirectory()) {
      return c.json({ error: `Not a directory: ${workingDir}` }, 400);
    }
  } catch {
    return c.json({ error: `Directory not found: ${workingDir}` }, 404);
  }

  const session: Session = {
    id: randomUUID(),
    workingDir,
    createdAt: new Date().toISOString(),
  };

  sessions.set(session.id, session);
  console.log(`📂 Session created: ${session.id} → ${workingDir}`);
  return c.json(session, 201);
});

/** GET /api/session/:id — retrieve session info */
sessionRouter.get('/:id', (c) => {
  const session = sessions.get(c.req.param('id'));
  if (!session) return c.json({ error: 'Session not found' }, 404);
  return c.json(session);
});

/** DELETE /api/session/:id — close a session */
sessionRouter.delete('/:id', (c) => {
  const existed = sessions.delete(c.req.param('id'));
  if (!existed) return c.json({ error: 'Session not found' }, 404);
  return c.json({ ok: true });
});

export { sessionRouter };
