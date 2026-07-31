import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { runAgentLoop } from '../services/agent-loop.js';
import { normalizeAgentError } from '../utils/agent-errors.js';
import fs from 'node:fs/promises';

const agentRouter = new Hono();

agentRouter.post('/run', async (c) => {
  const body = await c.req.json<{
    messages: Array<{ role: 'user' | 'model'; content: string }>;
    workingDir: string;
    turnId?: string;
  }>();

  const { messages, workingDir, turnId } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: 'messages array is required' }, 400);
  }

  if (!workingDir || !workingDir.startsWith('/')) {
    return c.json({ error: 'workingDir must be an absolute path' }, 400);
  }

  try {
    await fs.access(workingDir);
  } catch {
    return c.json({ error: `workingDir does not exist: ${workingDir}` }, 400);
  }

  return streamSSE(c, async (stream) => {
    let id = 0;
    let capturedTurnId: string | undefined;

    const write = (event: string, data: unknown) =>
      stream.writeSSE({ event, data: JSON.stringify(data), id: String(id++) });

    try {
      for await (const event of runAgentLoop({ messages, workingDir, turnId })) {
        const { type, ...payload } = event;
        if (type === 'turn') capturedTurnId = (event as any).turnId;
        await write(type, payload);
        if (stream.aborted) break;
      }
    } catch (err) {
      console.error('Agent run error:', err);
      const normalized = normalizeAgentError(err);
      await write('error', { ...normalized, turnId: capturedTurnId });
    }
  });
});

// Deprecated — returns 410 so callers know to update
agentRouter.post('/chat', (c) =>
  c.json({ error: 'Deprecated. Use POST /api/agent/run instead.' }, 410)
);

export { agentRouter };
