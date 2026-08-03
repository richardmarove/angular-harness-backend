import type { Content, Part } from '@google/genai';
import { getAI } from './gemini.js';
import { TOOL_DECLARATIONS } from '../tools/index.js';
import { executeTool } from '../tools/executor.js';
import { createTurn, getTurn, saveTurnHistory, deleteTurn } from './turn-store.js';

// ---------------------------------------------------------------------------
// Event types — mirrored on the client side
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { type: 'turn'; turnId: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: string; error?: string }
  | { type: 'chunk'; text: string }
  | { type: 'done' };

// ---------------------------------------------------------------------------
// Run options
// ---------------------------------------------------------------------------

export interface RunOptions {
  messages: Array<{ role: 'user' | 'model'; content: string }>;
  workingDir: string;
  maxIterations?: number;
  turnId?: string;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_INSTRUCTION = `You are angular-harness, an expert AI coding assistant with direct access to the user's file system and shell.

Available tools:
- read_file: Read any file in the working directory
- write_file: Create or overwrite a file with new content
- list_directory: List contents of a directory
- run_command: Run a shell command (npm, git, tsc, etc.)

Working directory: {WORKING_DIR}

Guidelines:

Understanding the codebase:
1. Before making changes, understand the relevant code, its conventions, and its existing patterns. Check imports, neighboring files, and config files (package.json, etc.) before assuming a library is available.
2. Explore efficiently. Don't re-list a directory or re-read a file you've already seen in this conversation — check your own history first. Favor a small number of targeted reads over broad, repeated scanning. Stop exploring once you have enough to act or answer.

Making changes:
3. Fix problems at the root cause rather than applying surface-level patches, when possible.
4. Mimic the style, naming, and structure of the surrounding code. Keep changes minimal and focused on what was asked — don't rename, restructure, or "clean up" things you weren't asked to touch.
5. Always read a file before editing it so you understand its current state. After writing a file, trust the tool result rather than re-reading it to confirm — only re-read if something suggests the write may not have applied as expected.
6. Stay within the working directory. Don't attempt to access paths outside it.
7. Don't fix unrelated bugs you notice along the way — mention them to the user instead of acting on them.
8. Never revert changes (yours or the user's) unless explicitly asked to.
9. Never run git commit, create branches, or push, unless explicitly asked.

Running commands:
10. Before running a destructive or irreversible command (rm, git reset --hard, force-push, dropping data, etc.), explain what it does and why before running it.
11. If a command or approach fails, diagnose why and try a different approach — don't repeat the same failing action more than once or twice.

Communication:
12. If a request is ambiguous or would require action clearly beyond its scope, ask before proceeding rather than guessing.
13. Prioritize accuracy over agreement. If the user's proposed approach has a problem, say so directly and suggest the better path, rather than going along with it.
14. Your responses are rendered as Markdown. Use headers, bold, lists, and code blocks where they aid clarity.
15. Be concise. Show your reasoning where it matters, but don't over-explain.`;

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

export async function* runAgentLoop(options: RunOptions): AsyncGenerator<AgentEvent> {
  const { messages, workingDir, maxIterations = 20 } = options;

  const existing = options.turnId ? getTurn(options.turnId) : undefined;
  const turnId: string = existing ? options.turnId! : createTurn(workingDir);

  let history: Content[];
  if (existing) {
    history = existing.history; // resume where we left off
  } else {
    history = messages.map((m) => ({ role: m.role, parts: [{ text: m.content }] }));
    saveTurnHistory(turnId, history);
  }

  yield { type: 'turn', turnId };

  const systemInstruction = SYSTEM_INSTRUCTION.replace('{WORKING_DIR}', workingDir);
  const model = process.env.GEMINI_MODEL ?? 'gemma-4-31b-it';

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await getAI().models.generateContent({
      model,
      contents: history,
      config: { systemInstruction, tools: [{ functionDeclarations: TOOL_DECLARATIONS }] },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content) break;

    const parts: Part[] = candidate.content.parts ?? [];
    history.push({ role: 'model', parts });
    saveTurnHistory(turnId, history); // checkpoint after every model turn

    const functionCallParts = parts.filter((p) => p.functionCall);

    if (functionCallParts.length === 0) {
      for (const part of parts) {
        if (part.text) yield { type: 'chunk', text: part.text };
      }
      deleteTurn(turnId); // finished cleanly — nothing left to resume
      yield { type: 'done' };
      return;
    }

    const toolResultParts: Part[] = [];

    for (const part of functionCallParts) {
      const call = part.functionCall!;
      const name = call.name!;
      const args = (call.args ?? {}) as Record<string, unknown>;

      yield { type: 'tool_call', name, args };

      let result: string;
      let error: string | undefined;
      try {
        result = await executeTool(name, args, workingDir);
      } catch (err) {
        error = String(err);
        result = `Error: ${error}`;
      }

      yield { type: 'tool_result', name, result, error };
      toolResultParts.push({ functionResponse: { name, response: { output: result } } });
    }

    history.push({ role: 'user', parts: toolResultParts });
    saveTurnHistory(turnId, history); // checkpoint after every tool batch
  }

  deleteTurn(turnId);
  yield { type: 'chunk', text: '\n\n⚠️ Agent reached the maximum number of iterations.' };
  yield { type: 'done' };
}
