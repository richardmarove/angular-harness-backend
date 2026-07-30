import { GoogleGenAI } from '@google/genai';

// Lazy singleton — created on first call so process.env is already populated by dotenv
let _ai: GoogleGenAI | null = null;

export function getAI(): GoogleGenAI {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  return _ai;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}
