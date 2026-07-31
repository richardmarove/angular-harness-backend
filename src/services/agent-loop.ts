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
1. Always read a file before editing it so you understand the current state.
2. After writing a file, verify the change by reading it back.
3. Prefer small, targeted edits. Don't rewrite files unnecessarily.
4. When running commands, explain what you're doing and why.
5. If something fails, diagnose it and try again — don't give up.
6. Be concise in your explanations. Show your reasoning but don't over-explain.`;

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
