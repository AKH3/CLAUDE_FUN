import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAction, applyDeltas, applyPlan, emptyState } from '../src/core/ops.js';
import { guardDecision, shellWrites } from '../src/hooks/index.js';

const ROOT = 'D:\\Program Files x86\\my proj';

function planned(guard: 'strict' | 'sensitive' | 'off' = 'strict') {
  const s = emptyState('G');
  applyPlan(s, { phases: [{ t: 'A', steps: ['one'] }] });
  s.cfg.guard = guard;
  return s;
}

const edit = (file: string) => ({ tool_name: 'Edit', tool_input: { file_path: file } });
const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });

describe('shellWrites heuristic', () => {
  it.each([
    'echo hi > notes.txt',
    'cat a >> b.log',
    "sed -i 's/a/b/' src/x.ts",
    'rm -rf dist',
    'mv a.ts b.ts',
    'git checkout -- src/app.ts',
    'git commit -m wip',
    'npm install lodash',
    'Set-Content -Path a.txt -Value 1',
    'echo x | tee out.txt',
    'cd src && touch new.ts',
  ])('flags %s', (cmd) => expect(shellWrites(cmd)).toBe(true));

  it.each([
    'ls -la',
    'git status',
    'git diff --stat',
    'npm test',
    'cat package.json',
    'node -e "[1,2].map(x => x * 2)"',
    'npm run build 2>&1 | tail -5',
    'grep -rn foo src > /dev/null',
    'Get-ChildItem | Select-Object -First 3',
  ])('allows %s', (cmd) => expect(shellWrites(cmd)).toBe(false));
});

describe('guardDecision', () => {
  it('strict: blocks edits and writing shell commands until a step runs', () => {
    const s = planned('strict');
    expect(guardDecision(s, ROOT, edit(join(ROOT, 'src', 'a.ts')))).toMatch(/no step is running/);
    expect(guardDecision(s, ROOT, bash('echo x > src/a.ts'))).toMatch(/changes files/);
    expect(guardDecision(s, ROOT, bash('npm test'))).toBeUndefined();
    expect(guardDecision(s, ROOT, edit(join(ROOT, '.claude-board', 'state.json')))).toBeUndefined();
    expect(guardDecision(s, ROOT, edit('C:\\elsewhere\\x.ts'))).toBeUndefined();

    applyAction(s, { type: 'approve', id: 'S1.1' });
    applyDeltas(s, [{ id: 'S1.1', s: 'run' }]);
    expect(guardDecision(s, ROOT, edit(join(ROOT, 'src', 'a.ts')))).toBeUndefined();
    expect(guardDecision(s, ROOT, bash('rm -rf dist'))).toBeUndefined();
  });

  it('handles drive-letter case and forward slashes on Windows paths', () => {
    const s = planned('strict');
    expect(guardDecision(s, ROOT, edit('d:/program files x86/my proj/src/a.ts'))).toMatch(/no step is running/);
  });

  it('sensitive: only protected paths, for edits and shell', () => {
    const s = planned('sensitive');
    expect(guardDecision(s, ROOT, edit(join(ROOT, 'src', 'a.ts')))).toBeUndefined();
    expect(guardDecision(s, ROOT, edit(join(ROOT, '.env.local')))).toMatch(/\.env\.local is protected/);
    expect(guardDecision(s, ROOT, bash('echo SECRET=1 >> .env'))).toMatch(/protected \.env/);
    expect(guardDecision(s, ROOT, bash('rm db/migrations/0001.sql'))).toMatch(/protected db\/migrations\/0001\.sql/);
    expect(guardDecision(s, ROOT, bash('rm dist/a.js'))).toBeUndefined();
  });

  it('off, or no plan yet: never blocks', () => {
    expect(guardDecision(planned('off'), ROOT, bash('rm -rf src'))).toBeUndefined();
    expect(guardDecision(emptyState('x'), ROOT, edit(join(ROOT, 'a.ts')))).toBeUndefined();
  });
});
