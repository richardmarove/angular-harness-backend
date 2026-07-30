import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Resolve a relative path against workingDir and validate it doesn't
 * escape the working directory (path traversal prevention).
 */
function safePath(workingDir: string, relativePath: string): string {
  const base = path.resolve(workingDir);
  const resolved = path.resolve(workingDir, relativePath || '.');
  if (!resolved.startsWith(base)) {
    throw new Error(`Path traversal denied: "${relativePath}" escapes the working directory`);
  }
  return resolved;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  workingDir: string
): Promise<string> {
  switch (name) {
    case 'read_file': {
      const abs = safePath(workingDir, args['path'] as string);
      try {
        const content = await fs.readFile(abs, 'utf-8');
        return content;
      } catch (err: any) {
        if (err.code === 'ENOENT') throw new Error(`File not found: ${args['path']}`);
        throw err;
      }
    }

    case 'write_file': {
      const abs = safePath(workingDir, args['path'] as string);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, args['content'] as string, 'utf-8');
      return `✅ Written: ${args['path']}`;
    }

    case 'list_directory': {
      const rel = (args['path'] as string) ?? '';
      const abs = safePath(workingDir, rel);
      try {
        const entries = await fs.readdir(abs, { withFileTypes: true });
        if (entries.length === 0) return '(empty directory)';
        return entries
          .map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
          .join('\n');
      } catch (err: any) {
        if (err.code === 'ENOENT') throw new Error(`Directory not found: ${rel || '.'}`);
        throw err;
      }
    }

    case 'run_command': {
      const command = args['command'] as string;
      const timeout = (args['timeout_ms'] as number) ?? 30_000;

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: workingDir,
          timeout,
          maxBuffer: 1024 * 1024, // 1 MB output limit
        });
        const out = [stdout?.trim(), stderr?.trim()].filter(Boolean).join('\n');
        return out || '(command exited with no output)';
      } catch (err: any) {
        // exec throws on non-zero exit code — include the output anyway
        const out = [err.stdout?.trim(), err.stderr?.trim()].filter(Boolean).join('\n');
        return `Exit code ${err.code ?? 1}:\n${out || err.message}`;
      }
    }

    default:
      throw new Error(`Unknown tool: "${name}"`);
  }
}
