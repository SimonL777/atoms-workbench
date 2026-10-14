export type Mode = 'brainstorm' | 'build';
export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_user'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export type Question = { id: string; text: string; options?: string[]; tool_call_id: string };
export type Project = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  mode: Mode;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
};
export type Message = {
  id: string;
  project_id: string;
  run_id: string | null;
  role: 'user' | 'assistant';
  kind: 'text' | 'question' | 'spec' | 'version' | 'error';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
export type Spec = {
  id: string;
  project_id: string;
  content: string;
  confirmed_at: string | null;
  created_at: string;
};
export type Run = {
  id: string;
  project_id: string;
  kind: Mode;
  input: string;
  status: RunStatus;
  phase: string;
  question: Question | null;
  error: string | null;
  base_version_id: string | null;
  spec_id: string | null;
  created_at: string;
};
export type RunEvent = {
  id: number;
  project_id: string;
  run_id: string;
  kind: string;
  summary: string;
  created_at: string;
};
export type Version = {
  id: string;
  project_id: string;
  run_id: string;
  parent_id: string | null;
  summary: string;
  artifact_path: string;
  checks: Record<string, unknown>;
  created_at: string;
};
export type Snapshot = { files: Record<string, string>; html: string; summary: string };
export type ProjectDetail = {
  project: Project;
  messages: Message[];
  specs: Spec[];
  runs: Run[];
  versions: Version[];
  events: RunEvent[];
};
export type PublicConfig = {
  supabaseUrl: string;
  supabaseKey: string;
  demoEnabled: boolean;
  configured: boolean;
  // Model settings service readiness, not the current user's saved configuration.
  modelReady: boolean;
  build: string;
};
// Authenticated summary only; the saved API key is never returned to the browser.
export type ModelSettings = {
  configured: boolean;
  baseUrl: string;
  modelName: string;
  apiKeyConfigured: boolean;
  updatedAt: string | null;
};
export const ACTIVE_STATUSES: RunStatus[] = ['queued', 'running', 'waiting_for_user'];
