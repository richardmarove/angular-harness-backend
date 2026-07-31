import type { Content } from '@google/genai';

interface TurnState {
  history: Content[];
  workingDir: string;
  updatedAt: number;
}

const TTL_MS = 10 * 60 * 1000; // abandoned turns expire after 10 min
const store = new Map<string, TurnState>();

setInterval(() => {
  const now = Date.now();
  for (const [id, state] of store) {
    if (now - state.updatedAt > TTL_MS) store.delete(id);
  }
}, 60 * 1000).unref?.();

export function createTurn(workingDir: string): string {
  const id = crypto.randomUUID();
  store.set(id, { history: [], workingDir, updatedAt: Date.now() });
  return id;
}

export function getTurn(id: string): TurnState | undefined {
  return store.get(id);
}

export function saveTurnHistory(id: string, history: Content[]): void {
  const state = store.get(id);
  if (!state) return;
  state.history = history;
  state.updatedAt = Date.now();
}

export function deleteTurn(id: string): void {
  store.delete(id);
}
