import { z } from 'zod';

// Step lifecycle: todo (proposed, awaiting approval) -> ok (approved) -> run -> done | fail.
// block = stuck, skip = rejected by the user.
export const STEP_STATUS = ['todo', 'ok', 'run', 'done', 'fail', 'block', 'skip'] as const;
export const CLAUDE_STATUS = ['run', 'done', 'fail', 'block'] as const;
export const GUARD_MODES = ['strict', 'sensitive', 'off'] as const;
export const TEST_STATUS = ['pass', 'fail', 'none'] as const;
export const DIRECTIVE_KINDS = ['ok', 'no', 'split', 'note', 'prio', 'edit', 'add', 'retry', 'guard'] as const;

export const DEFAULT_PROTECT = [
  '.env*',
  '**/.env*',
  '**/migrations/**',
  '**/*.pem',
  '**/*.key',
  'package-lock.json',
  '.github/**',
];

export const ResultSchema = z.object({
  f: z.number().int().optional(), // files changed
  files: z.array(z.string()).optional(),
  ins: z.number().int().optional(),
  del: z.number().int().optional(),
  t: z.enum(TEST_STATUS).optional(),
});

export const StepSchema = z.object({
  id: z.string(),
  p: z.string(), // phase id
  parent: z.string().nullable().default(null),
  t: z.string(), // title
  s: z.enum(STEP_STATUS).default('todo'),
  o: z.number().default(0), // order among siblings
  deps: z.array(z.string()).default([]),
  n: z.string().optional(), // latest note from Claude
  un: z.string().optional(), // latest note from the user
  d: z.string().optional(), // optional detail
  by: z.enum(['claude', 'user']).optional(),
  r: ResultSchema.optional(),
  base: z.string().optional(), // git tree when the step started
  head: z.string().optional(), // git tree when the step ended
  at: z
    .object({ run: z.string().optional(), end: z.string().optional() })
    .prefault({}),
});

export const PhaseSchema = z.object({
  id: z.string(),
  t: z.string(),
  o: z.number().default(0),
  d: z.string().optional(),
  budget: z.number().optional(),
});

export const DirectiveSchema = z.object({
  id: z.string(),
  k: z.enum(DIRECTIVE_KINDS),
  s: z.string().optional(), // target step / phase
  x: z.string().optional(), // payload text
  at: z.string(),
  ack: z.boolean().default(false),
});

export const LogSchema = z.object({ at: z.string(), m: z.string(), k: z.string().optional() });

export const CfgSchema = z.object({
  budget: z.number().default(250_000),
  guard: z.enum(GUARD_MODES).default('strict'),
  autoApprove: z.boolean().default(false),
  protect: z.array(z.string()).default(DEFAULT_PROTECT),
});

export const StateSchema = z.object({
  v: z.literal(1).default(1),
  rev: z.number().default(0),
  seq: z.number().default(0),
  project: z
    .object({ name: z.string(), goal: z.string().optional(), since: z.string().optional() })
    .prefault({ name: 'Project' }),
  cfg: CfgSchema.prefault({}),
  phases: z.array(PhaseSchema).default([]),
  steps: z.array(StepSchema).default([]),
  inbox: z.array(DirectiveSchema).default([]),
  log: z.array(LogSchema).default([]),
});

// ---- MCP tool inputs (kept terse: every schema byte is paid for in context) ----

export const StepInSchema = z.union([
  z.string(),
  z.object({
    t: z.string(),
    deps: z.array(z.string()).optional().describe('ids, or "#n" = nth step in this list'),
    d: z.string().optional(),
  }),
]);

export const PlanInput = {
  name: z.string().optional().describe('project name'),
  goal: z.string().optional(),
  phases: z
    .array(z.object({ t: z.string(), steps: z.array(StepInSchema).optional() }))
    .optional()
    .describe('new phases'),
  phase: z.string().optional().describe('add steps to this phase id'),
  parent: z.string().optional().describe('split: add substeps under this step id'),
  steps: z.array(StepInSchema).optional(),
};

export const DeltaSchema = z.object({
  id: z.string(),
  s: z.enum(CLAUDE_STATUS).optional(),
  n: z.string().max(160).optional().describe('<=8 words'),
  t: z.enum(TEST_STATUS).optional().describe('tests'),
});

export const UpdateInput = { ops: z.array(DeltaSchema).min(1) };

export const AwaitInput = {
  id: z.string().optional().describe('step to wait for'),
  sec: z.number().int().min(5).max(3600).optional(),
};

// ---- UI actions ----

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('approve'), id: z.string() }),
  z.object({ type: z.literal('approvePhase'), id: z.string() }),
  z.object({ type: z.literal('reject'), id: z.string() }),
  z.object({ type: z.literal('retry'), id: z.string() }),
  z.object({ type: z.literal('split'), id: z.string() }),
  z.object({
    type: z.literal('addStep'),
    phase: z.string().optional(),
    parent: z.string().optional(),
    t: z.string().min(1).max(200),
  }),
  z.object({ type: z.literal('addPhase'), t: z.string().min(1).max(120) }),
  z.object({ type: z.literal('note'), id: z.string().optional(), x: z.string().min(1).max(500) }),
  z.object({ type: z.literal('reorder'), id: z.string(), to: z.number().int().min(0) }),
  z.object({ type: z.literal('edit'), id: z.string(), t: z.string().min(1).max(200) }),
  z.object({ type: z.literal('setGuard'), mode: z.enum(GUARD_MODES) }),
  z.object({
    type: z.literal('setCfg'),
    budget: z.number().int().min(1000).optional(),
    autoApprove: z.boolean().optional(),
  }),
]);

export type StepStatus = (typeof STEP_STATUS)[number];
export type GuardMode = (typeof GUARD_MODES)[number];
export type Result = z.infer<typeof ResultSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type Directive = z.infer<typeof DirectiveSchema>;
export type LogEntry = z.infer<typeof LogSchema>;
export type State = z.infer<typeof StateSchema>;
export type StepIn = z.infer<typeof StepInSchema>;
export type Delta = z.infer<typeof DeltaSchema>;
export type Action = z.infer<typeof ActionSchema>;

export interface PlanArgs {
  name?: string;
  goal?: string;
  phases?: { t: string; steps?: StepIn[] }[];
  phase?: string;
  parent?: string;
  steps?: StepIn[];
}

export interface Usage {
  session?: string;
  total: { in: number; out: number; cw: number; cr: number };
  steps: Record<string, number>;
  phases: Record<string, number>;
  updated?: string;
}
