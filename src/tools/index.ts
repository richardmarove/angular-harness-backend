import { Type, type FunctionDeclaration } from '@google/genai';

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'read_file',
    description:
      'Read the full contents of a file. Use this before editing to understand the current state.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Relative file path from the working directory, e.g. "src/app.ts"',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Write content to a file, creating it (and any parent directories) if it does not exist. This overwrites the whole file.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Relative file path from the working directory',
        },
        content: {
          type: Type.STRING,
          description: 'Complete new content for the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description:
      'List the files and subdirectories at a given path. Pass an empty string to list the working directory root.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Relative directory path (empty string for root)',
        },
      },
    },
  },
  {
    name: 'run_command',
    description:
      'Execute a shell command inside the working directory and return its output (stdout + stderr). Use for running tests, installing packages, building, etc.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: 'Shell command to run, e.g. "npm test" or "cat package.json"',
        },
        timeout_ms: {
          type: Type.NUMBER,
          description: 'Max execution time in milliseconds. Defaults to 30000.',
        },
      },
      required: ['command'],
    },
  },
];
