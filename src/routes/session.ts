import { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Session {
  id: string;
  workingDir: string;
  createdAt: string;
}

export interface FileNode {
  name: string;
  type: 'file' | 'folder';
  path: string;
  children?: FileNode[];
}

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.angular',
  'dist',
  '.vscode',
  '.idea',
  'build',
  'coverage',
  '.next',
]);

function safePath(workingDir: string, relativePath: string): string {
  const base = path.resolve(workingDir);
  const resolved = path.resolve(workingDir, relativePath || '.');
  if (!resolved.startsWith(base)) {
    throw new Error(`Path traversal denied: "${relativePath}" escapes the working directory`);
  }
  return resolved;
}

async function buildTree(workingDir: string, relativeDir: string = ''): Promise<FileNode[]> {
  const absPath = safePath(workingDir, relativeDir);
  const entries = await fs.readdir(absPath, { withFileTypes: true });

  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;

    const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = await buildTree(workingDir, rel);
      nodes.push({
        name: entry.name,
        type: 'folder',
        path: rel,
        children,
      });
    } else {
      nodes.push({
        name: entry.name,
        type: 'file',
        path: rel,
      });
    }
  }

  nodes.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'folder' ? -1 : 1;
  });

  return nodes;
}

// In-memory session store
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

/** GET /api/session/:id/tree — retrieve recursive file tree for session */
sessionRouter.get('/:id/tree', async (c) => {
  const session = sessions.get(c.req.param('id'));
  if (!session) return c.json({ error: 'Session not found' }, 404);

  try {
    const tree = await buildTree(session.workingDir);
    return c.json({ tree });
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to build file tree' }, 500);
  }
});

/** GET /api/session/:id/file?path=... — read file content */
sessionRouter.get('/:id/file', async (c) => {
  const session = sessions.get(c.req.param('id'));
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const relPath = c.req.query('path');
  if (!relPath) return c.json({ error: 'path query parameter required' }, 400);

  try {
    const abs = safePath(session.workingDir, relPath);
    const content = await fs.readFile(abs, 'utf-8');
    return c.json({ path: relPath, content });
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return c.json({ error: `File not found: ${relPath}` }, 404);
    }
    return c.json({ error: err.message ?? 'Failed to read file' }, 500);
  }
});

/** POST /api/session/:id/file — save/write file content */
sessionRouter.post('/:id/file', async (c) => {
  const session = sessions.get(c.req.param('id'));
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const body = await c.req.json<{ path: string; content: string }>();
  const { path: relPath, content } = body;

  if (!relPath) return c.json({ error: 'path is required' }, 400);

  try {
    const abs = safePath(session.workingDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content ?? '', 'utf-8');
    console.log(`💾 Saved file: ${relPath}`);
    return c.json({ ok: true, path: relPath });
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to write file' }, 500);
  }
});

/** POST /api/session/:id/create — create new file or folder */
sessionRouter.post('/:id/create', async (c) => {
  const session = sessions.get(c.req.param('id'));
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const body = await c.req.json<{ path: string; type: 'file' | 'folder' }>();
  const { path: relPath, type } = body;

  if (!relPath) return c.json({ error: 'path is required' }, 400);

  try {
    const abs = safePath(session.workingDir, relPath);
    if (type === 'folder') {
      await fs.mkdir(abs, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, '', 'utf-8');
    }
    return c.json({ ok: true, path: relPath, type });
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to create file/folder' }, 500);
  }
});

/** DELETE /api/session/:id/file — delete file or folder */
sessionRouter.delete('/:id/file', async (c) => {
  const session = sessions.get(c.req.param('id'));
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const relPath = c.req.query('path');
  if (!relPath) return c.json({ error: 'path query parameter required' }, 400);

  try {
    const abs = safePath(session.workingDir, relPath);
    await fs.rm(abs, { recursive: true, force: true });
    return c.json({ ok: true, path: relPath });
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to delete file/folder' }, 500);
  }
});

export { sessionRouter };
