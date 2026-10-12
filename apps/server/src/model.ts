import { config } from './config.ts';
export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};
const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  },
});
const text = { type: 'string' };
export const brainstormTools = [
  tool(
    'ask_user_question',
    'Ask exactly one consequential question. Call this alone, then wait. Options are optional.',
    { question: text, options: { type: 'array', items: text, maxItems: 4 } },
    ['question'],
  ),
  tool(
    'save_spec',
    'Save the complete requirement brief for the user to review. This ends clarification; do not generate product code.',
    { content: text },
    ['content'],
  ),
];
export const buildTools = [
  tool('save_plan', 'Record a short implementation plan before editing files.', { content: text }, [
    'content',
  ]),
  tool('list_files', 'List available project source files.', {}),
  tool('read_file', 'Read a project source file.', { path: text }, ['path']),
  tool(
    'write_file',
    'Write a complete project source file. Only src files; platform data helper is read-only.',
    { path: text, content: text },
    ['path', 'content'],
  ),
  tool(
    'run_build',
    'Run TypeScript checking and build in an isolated container. Fix actual errors before delivery.',
    {},
  ),
  tool(
    'publish',
    'Deliver a version only after run_build has passed for the current files.',
    { summary: text },
    ['summary'],
  ),
];
export async function model(
  messages: ChatMessage[],
  tools: unknown[],
  signal: AbortSignal,
): Promise<ChatMessage> {
  const url = `${config.modelUrl.replace(/\/$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.modelKey}` },
    body: JSON.stringify({
      model: config.model,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.35,
    }),
  });
  if (!response.ok) throw new Error(`模型调用失败（HTTP ${response.status}）。请检查服务端配置。`);
  const result = (await response.json()) as { choices?: { message?: ChatMessage }[] };
  const message = result.choices?.[0]?.message;
  if (!message || message.role !== 'assistant') throw new Error('模型没有返回有效回复。');
  return message;
}
