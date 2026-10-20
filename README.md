<div dir="rtl">

# CLAUDE FUN · لوحة كلاود

**محرك بصري خفيف يوضع داخل أي مستودع:** يرسل كلاود تحديثات JSON صغيرة، فتظهر أمامك لوحة تفاعلية حيّة على شكل شجرة تطوير، وأنت من يعتمد كل خطوة.

[English below ↓](#english)

![لوحة كلاود بالعربية](docs/board-ar.png)

## لماذا؟

في جلسات Claude Code تذهب نسبة كبيرة من التوكنز في فقرات تشرح الخطة وما تم إنجازه، وتضيع المتابعة بين سطور الطرفية. هذه الأداة تفصل **العرض** عن **البيانات**:

- الواجهة مبنية مسبقاً وتعمل محلياً، فلا يولّد كلاود أي واجهات أو شروحات.
- كلاود يرسل فروقات قصيرة فقط (Delta)، مثل `{"id":"S2.1","s":"done","n":"تم ربط قاعدة البيانات","t":"pass"}` بتكلفة 15 إلى 25 توكن تقريباً.
- عند العودة في اليوم التالي يقرأ كلاود ملخصاً واحداً أقل من 100 توكن بدلاً من المحادثات السابقة.
- لا يبدأ كلاود أي خطوة إلا بعد اعتمادك لها من اللوحة، والمحرك نفسه يرفض غير ذلك.

## كيف يعمل

```mermaid
flowchart LR
  C[Claude Code] -- "MCP: resume / plan / update" --> E[المحرك المحلي<br/>Hono + MCP]
  E <--> S[(.claude-board/state.json)]
  S -- "chokidar → SSE" --> B[اللوحة في المتصفح<br/>React Flow]
  B -- "اعتماد / تقسيم / ترتيب / ملاحظة" --> E
  E -- "توجيهات صامتة" --> C
  H[Hooks] -- "سياق الاستئناف + حارس التعديلات + إيقاظ كلاود عند الضغط" --> C
```

## البدء السريع

> تستخدم تطبيق Claude على الكمبيوتر بدون طرفية، أو جديد على Claude Code؟ ابدأ من [دليل التشغيل للمبتدئين](docs/GUIDE-ar.md): كل خطواته بالكلام مع كلاود والضغط على اللوحة.
>
> أو دع كلاود يثبّتها لك: انسخ المجلد [`skills/claude-board-setup`](skills/claude-board-setup) إلى `~/.claude/skills/`، ثم قل لكلاود داخل مشروعك «ثبّت لوحة كلاود».

```bash
npm i -g https://github.com/AKH3/CLAUDE_FUN/archive/refs/heads/main.tar.gz
```

```bash
cd my-project
claude-fun init
claude
```

شغّل `init` **داخل مجلد المشروع** وليس في مجلد المستخدم؛ الأداة ترفض مجلد المستخدم وجذر القرص لأن `.claude/settings.json` هناك هو إعدادات Claude Code العامة. يجهّز `init` المشروع، ثم يشغّل Claude Code خادم MCP تلقائياً ومعه اللوحة، وتكون عادةً على `http://localhost:3000`. قد يختلف المنفذ إذا كان 3000 مشغولاً أو إذا ضبطته بـ `--port`، فيعرض كلاود الرابط الصحيح عند أول `resume`. ويمكنك فتح اللوحة يدوياً متى شئت بالأمر `claude-fun`، وهو يفتح اللوحة الشغّالة للمشروع أياً كان منفذها ولا يشغّل لوحة ثانية.

لتجربة اللوحة بدون مشروع:

```bash
claude-fun demo --simulate
```

يفتح هذا الأمر مشروعاً تجريبياً، وفيه "كلاود وهمي" ينفّذ الخطوات التي تعتمدها، فترى البطاقات تتحرك وتضيء أمامك.

> يتطلب Node.js 22 أو أحدث، و git لعرض التعديلات (Diff). نثبّت من رابط الأرشيف وليس من `github:` لأن npm يترك رابطاً مكسوراً عند التثبيت العام من git.

> **على Windows (PowerShell):** إذا ظهر خطأ `UnauthorizedAccess` / `PSSecurityException` فسببه سياسة تشغيل السكربتات في PowerShell، وليس الأداة. الحل الأسرع أن تكتب `npm.cmd` بدل `npm` و `claude-fun.cmd` بدل `claude-fun`. أو اسمح بالسكربتات الموقّعة لحسابك مرة واحدة بالأمر `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`، وهذا قرارك لأنه إعداد أمان.

## ما الذي تراه في اللوحة

| الميزة | ماذا تفعل |
|---|---|
| **شجرة المراحل** | كل مرحلة عمود (من اليمين لليسار بالعربية)، والخطوات تحتها، والمهام الفرعية متفرعة منها. العقد تضيء عند الإنجاز، والمرحلة المكتملة تتحول للذهبي. |
| **اللوحة توقظ كلاود** | أي ضغطة تحتاج كلاود (ابدأ، سؤال، رسالة، تقسيم، إعادة) توصله خلال ثواني حتى لو كان واقف، بدون ما تكتب له في المحادثة. أعلى اللوحة يقول لك دائماً: «كلاود يشتغل» أو «كلاود جاهز» أو «كلاود مو مفتوح». وإذا ما قدر يوصل، يطلع شريط يقول لك وش تكتب بالضبط. |
| **بوابات الإذن** | البطاقة بانتظار موافقتك تنبض، وفيها زر «ابدأ». يوجد أيضاً «ابدأ المرحلة كلها» على بطاقة المرحلة. التقسيم والرفض والإعادة داخل البطاقة (اضغط عليها). |
| **ترتيب البدء** | كل خطوة توافق عليها تدخل دوراً يظهر على بطاقتها («التالي»، «الدور 2»…). «ابدأ» يضعها آخر الدور، و«ابدأ بالترتيب» (بعد اختيار البطاقات بـ `#`) يضعها أول الدور بالترتيب الذي اخترته. المحرك يرفض أي خطوة قبل دورها، وخطوتين في نفس الوقت، فلا يتخطى كلاود الترتيب. و«رجّعها للانتظار» يخرج خطوة من الدور. |
| **وش هذي الخطوة؟ ❔** | زر `?` على كل بطاقة يعرض فوراً شرحاً قصيراً لما تفعله الخطوة وفائدتها، يكتبه كلاود مع الخطة نفسها (ويظهر أيضاً عند مرور الماوس). الخطوات القديمة بدون شرح: يُسأل كلاود عند الضغط، وتُحفظ الإجابة. |
| **الجهد المتوقع** | يقدّر كلاود جهد كل خطوة (خفيف / متوسط / كبير) ويظهر كأعمدة صغيرة بجانب رقمها، برقم واحد فقط في الخطة. |
| **طي المراحل** | اضغط على بطاقة المرحلة لتطوي خطواتها أو تعرضها. زر ⓘ يفتح تفاصيل المرحلة. |
| **مهمة جديدة من اللوحة** | مربع «+ مهمة جديدة» أسفل كل مرحلة يفتح نافذة فيها العنوان والتفاصيل، وتختار هل تبدأ مباشرة أو تنتظر اعتمادك. ومربع «+ مرحلة جديدة» بعد آخر مرحلة. |
| **الأرشيف** | أرشف مرحلة مكتملة بزر 🗃 على بطاقتها، أو حدّد عدة مهام بـ `#` واضغط «أرشفة». تختفي من اللوحة ومن ملخص كلاود فيقلّ ما يقرأه، وتبقى محفوظة في `.claude-board/state.json` وتسترجعها من زر الأرشيف بالأعلى. |
| **اكتب لكلاود** | زر «اكتب لكلاود» بالأعلى: تكتب طلبك وترسله، فيصل كلاود ويبدأ بدون ما تفتح المحادثة. فيه أفكار جاهزة تضغطها وتعدّلها، وشرح مختصر لأزرار اللوحة. واللوحة الفارغة تسألك «وش تبي تبني؟» وترسل فكرتك لكلاود ليرسم الخطة. |
| **كبسولة النتائج** | لكل خطوة منجزة: عدد الملفات، والأسطر المضافة والمحذوفة، وحالة الاختبار، والمدة، والتوكنز. يحسبها المحرك من git بنفسه، فلا تكلّف كلاود شيئاً. |
| **عرض التعديلات** | زر واحد يفتح diff الخطوة بالضبط، حتى بدون commits، لأن المحرك يلتقط شجرة العمل عند بداية الخطوة وعند نهايتها. |
| **عدّاد كفاءة التوكنز** | أرقام حقيقية من سجلات Claude Code، موزعة على المراحل والخطوات ومقارنة بالميزانية. |
| **أوامر صامتة** | عندما تسحب بطاقة لتغيير أولويتها أو تكتب ملاحظة، يتحول ذلك إلى سطر قصير يصل كلاود مع خطوته التالية، مثل `S3.1 prio 1; S2.4 note:"استخدم zod v4"`. |
| **حارس التعديلات** | في وضع «صارم» يمنع الهوك أي تعديل ملف، وأي أمر Bash يكتب ملفات (`>` و `sed -i` و `rm` و `git checkout` و `npm install`…)، ما لم تكن هناك خطوة معتمدة قيد التنفيذ. وضع «الحساس» يحمي `.env` والترحيلات وما شابهها فقط، ووضع «مطفأ» يلغي الحماية. |
| **الإعدادات** | زر الإعدادات بالأعلى فيه اللغة (عربي / English) والمظهر (داكن / فاتح) وحارس التعديلات والاعتماد التلقائي. اللغة والمظهر يمكن ضبطهما من الرابط أيضاً: `?lang=en&theme=light`. |

## بروتوكول التوكنز الصفري

أربع أدوات MCP فقط، وأوصافها قصيرة عمداً (تعريفاتها كلها نحو 600 توكن):

| الأداة | الاستخدام |
|---|---|
| `resume` | ملخص الحالة مع توجيهاتك غير المقروءة. أول ما يستدعيه كلاود. |
| `plan` | إضافة مراحل وخطوات دفعة واحدة. التقسيم يتم بتمرير `parent`. الخطوات الجديدة تنتظر اعتمادك. |
| `update` | الفروقات: `s:"run"` قبل العمل، ثم `done` أو `fail` بعده، مع ملاحظة لا تتجاوز 8 كلمات. |
| `await` | نادراً ما يُحتاج: ينتظر ضغطة منك. الأصل أن ينهي كلاود دوره، واللوحة توقظه عند الضغط. |

مثال على ما يقرأه كلاود عند الاستئناف:

```
متجر إلكتروني r42 | P3 "واجهة API" 2/4 | all 9/14 | tok 79k/250k
next S3.4 "التحقق من المدخلات بـ Zod"
wait S3.3 "رفع صور المنتجات" +3 need approval
msg S3.4 note:"use zod v4"; S3.3 prio 2
board http://localhost:3000
```

## ما الذي يضيفه `init`

لا يغيّر `init` شيئاً في كود مشروعك، ويمكن تشغيله أكثر من مرة بأمان:

- `.claude-board/state.json`: الخطة والحالة. يمكنك إضافته لـ git لتشاركه مع فريقك.
- `.claude-board/.gitignore`: يتجاهل ملفات التشغيل المؤقتة.
- `.mcp.json`: يضيف الخادم `board`.
- `.claude/settings.json`: يضيف الهوكس (`SessionStart` و`UserPromptSubmit` و`PreToolUse` على أدوات التعديل و Bash)، ومعها هوك `watch` على `SessionStart` و`UserPromptSubmit` و`Stop`. هذا الأخير يعمل في الخلفية (`asyncRewake`) وينتظر ضغطتك على اللوحة، فإذا جاءت أيقظ كلاود. ويسمح بأدوات `mcp__board` حتى لا يُطلب إذنك عند كل تحديث، ويضبط `MCP_TOOL_TIMEOUT=600000` (10 دقائق) إن لم يكن مضبوطاً.
- `CLAUDE.md`: مقطع من 5 أسطر يذكّر كلاود بالبروتوكول.

خيارات مفيدة: `--guard sensitive` و `--no-hooks` و `--no-claude-md`.

## الأوامر

| الأمر | الوظيفة |
|---|---|
| `claude-fun` | يفتح لوحة المشروع الحالي في المتصفح: يستخدم اللوحة الشغّالة أياً كان منفذها، ويشغّل واحدة إذا لم تكن هناك لوحة. |
| `claude-fun init` | يجهّز المستودع. |
| `claude-fun remove` | يلغي ما أضافه `init` بعد أخذ نسخة احتياطية. `--purge` يحذف اللوحة أيضاً، و `--backup <dir>` يحدد مكان النسخة. |
| `claude-fun status` | يطبع ملخص الاستئناف في الطرفية. |
| `claude-fun mcp` | خادم MCP عبر stdio. يستدعيه Claude Code بنفسه. |
| `claude-fun hook <name>` | معالجات الهوكس: `session-start` و `prompt` و `guard` و `watch`. |
| `claude-fun demo --simulate` | لوحة تجريبية تتحرك وحدها. |

## الأمان

- الخادم يستمع على `127.0.0.1` فقط، ويرفض أي Host غير localhost، وهذا يحمي من هجمات DNS rebinding.
- أوامر الكتابة تتطلب ترويسة `x-board`، وتُرفض الطلبات القادمة من مواقع أخرى.
- الحارس يراقب أدوات `Edit` و`Write` و`MultiEdit` و`NotebookEdit`، وأوامر Bash التي تكتب ملفات. **حدّ معروف:** فحص Bash تقريبي يعتمد على أنماط شائعة، وليس عزلاً كاملاً.

## حل المشكلات

- **أعلى اللوحة يقول «كلاود ما يسمع اللوحة»:** الجلسة مفتوحة لكن هوك `watch` غير موجود (مشروع جُهّز بنسخة قبل 0.4.0)، أو نسخة Claude Code قديمة. أعد `claude-fun init` في المشروع، أو قل لكلاود «حدّث لوحة كلاود»، ثم افتح جلسة جديدة.
- **أعلى اللوحة يقول «كلاود مو مفتوح»:** لا توجد جلسة Claude Code مفتوحة على المشروع. ضغطاتك محفوظة، وتصل كلاود أول ما تفتح جلسة وتكتب له.
- **كلاود لا يوقظه إلا ما يحتاجه:** «ابدأ» والسؤال والرسالة والتقسيم والإعادة توقظه. أما السحب لتغيير الترتيب، وتغيير الاسم، والأرشفة، والملاحظة على خطوة لم تبدأ، فتنتظر دوره التالي حتى لا تُصرف توكنز بلا داعٍ.
- **مسار فيه مسافات** مثل `D:\Program Files x86`: يكتب `init` المسار بشرطات أمامية وبين علامتي تنصيص، فيعمل في bash وفي cmd.
- **المنفذ 3000 مشغول:** المحرك يجرّب المنافذ التالية تلقائياً، ويكتب المنفذ المستخدم في `.claude-board/.runtime.json`. يقرأ `claude-fun` هذا الملف أولاً ويتأكد أن اللوحة تردّ فعلاً، فيفتح نفس اللوحة بدل تشغيل نسخة ثانية.
- **نقلت الأداة إلى مكان آخر:** أعد تشغيل `claude-fun init`، لأن الهوكس تشير إلى المسار المطلق للأداة.
- **بطاقة باقية «قيد التنفيذ» بعد انتهاء العمل:** اللوحة تعرض ما يبلّغ عنه كلاود فقط، فإذا انتهت الجلسة قبل أن يبلّغ بقيت الخطوة معلّقة. عند بداية كل جلسة جديدة ينبّه المحرك كلاود (في هوك `SessionStart` وفي أول `resume`) إلى الخطوات المعلّقة، فيتحقق منها ثم يعلّمها منجزة أو فاشلة.

## التطوير

```bash
npm install
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

مجلد `dist/` محفوظ في المستودع حتى يعمل التثبيت من GitHub بدون أي بناء، لذلك شغّل `npm run build` قبل كل commit يغيّر الكود.

البنية: `src/core` (الحالة والانتقالات والقفل والملخص و git والتوكنز)، و `src/server` (Hono مع SSE)، و `src/mcp` (الأدوات الأربع)، و `src/hooks`، و `ui/` (React Flow مع Zustand و Tailwind).

</div>

---

<a id="english"></a>

## English

**A drop-in visual board for Claude Code.** Claude sends tiny JSON deltas through four MCP tools, and a local engine turns them into a live, game-like skill tree. You approve every step from the board.

![Claude Board in English, light theme](docs/board-en-light.png)

### Why

Long progress narration burns tokens and buries the plan in terminal scrollback. Claude Board separates **view** from **data**:

- The UI is prebuilt, so Claude never generates UI or prose for status.
- Claude reports deltas such as `{"id":"S2.1","s":"done","n":"db wired","t":"pass"}`, about 15–25 tokens each.
- A resume summary under 100 tokens replaces re-reading old chats.
- Steps an earlier session left in "run" are flagged as `stale` when a new session starts, so Claude verifies them and reports done or fail instead of leaving them hanging.
- Steps only run after you approve them on the board. The engine enforces this, so it doesn't depend on the prompt.

### Quick start

```bash
npm i -g https://github.com/AKH3/CLAUDE_FUN/archive/refs/heads/main.tar.gz
```

```bash
cd my-project
claude-fun init
claude
```

Run `init` inside a project folder: it refuses your home folder and drive roots, because `.claude/settings.json` there is your global Claude Code config. `claude-fun remove` undoes `init` (backing files up first; `--purge` also deletes the board). Claude Code launches the `board` MCP server, which also hosts the board, usually at `http://localhost:3000` (the port can differ: the next free one if 3000 is busy, or whatever `--port` sets). `claude-fun` opens whichever board is already running for the project, on any port, and starts one only if none is. To try it without a project, run `claude-fun demo --simulate`. Requires Node.js 22+, plus git for diffs.

**Windows PowerShell:** an `UnauthorizedAccess` error comes from PowerShell's script execution policy, not from this tool. Use `npm.cmd` and `claude-fun.cmd`, or allow signed scripts for your account with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (your call, since it is a security setting).

### Features

- **Skill-tree canvas:** phases as columns (mirrored in Arabic), steps beneath them, substeps branching off, and deps drawn as links. Nodes light up as they finish, and completed phases turn gold.
- **The board wakes Claude:** a click that needs Claude (Start, a question, a message, Split, Retry) reaches it within seconds even when it is idle, with no need to type in the chat. A background `watch` hook (`asyncRewake`) waits for the click and starts a new turn. The top bar always says whether Claude is working, ready, or not open, and when a click can't reach it, a banner says exactly what to type.
- **Permission checkpoints:** a *Start* button on every waiting card, plus *Start the whole phase*. Split, Reject and Retry are inside the card.
- **Start order:** every approved step gets a place in line, shown on its card (*Next*, *Place 2*…). *Start* joins the end; *Start in order* (after picking cards with `#`) puts the picks at the front in the picked order. The engine refuses a step before its turn and a second step while one runs, so Claude can't skip or reorder. *Put back on hold* takes a step out of line.
- **What is this step? (`?`):** a short explanation of what a step does and why, written by Claude with the plan, so it opens instantly (and shows on hover). Older steps without one ask Claude on click, and the answer is cached.
- **Expected effort:** Claude rates each step small/medium/large (one digit in the plan), shown as bars next to its id.
- **Collapsible phases:** click a phase card to fold or unfold its steps; ⓘ opens the phase details.
- **Add from the board:** a *+ New task* box closes every phase column and opens a dialog for a title and details; you choose whether Claude may start it right away. *+ New phase* sits after the last column.
- **Archive:** archive a finished phase from its card, or pick tasks with `#` and press *Archive*. They leave the board and Claude's summary, stay in `.claude-board/state.json`, and come back from the archive panel.
- **Message Claude:** write a request on the board and send it; it reaches Claude without opening the chat. Ready-made ideas to click and edit, and a short guide to the board's buttons. An empty board asks "What do you want to build?" and sends your idea to Claude to plan.
- **Result capsules:** files changed, +/− lines, test status, duration and tokens, all computed by the engine from git snapshots taken in a throwaway index. No commits are needed and Claude spends zero tokens on them.
- **One-click diff** for exactly what a step changed.
- **Token efficiency meter:** real usage parsed from Claude Code's session logs, attributed to phases and steps, against a budget.
- **Silent directives:** dragging a card or writing a note becomes a one-line directive delivered with Claude's next tool call or prompt.
- **Edit guard hook:** `strict` (no file edits, and no file-writing Bash commands such as redirects, `sed -i`, `rm`, `git checkout` or `npm install`, unless an approved step is running), `sensitive` (protect `.env*`, migrations and similar) or `off`. The Bash check is a pattern heuristic, not a sandbox.
- **Settings menu:** language (Arabic/English), theme (dark/light), the edit guard and auto-approve. Language and theme can also be set from the URL with `?lang=en&theme=light`.

### MCP tools

| Tool | Purpose |
|---|---|
| `resume` | Compact status plus unread user directives. Claude calls it first. |
| `plan` | Add phases and steps; pass `parent` to split. New steps await approval. |
| `update` | Deltas: `s:"run"` before work, `done`/`fail` after, a note of 8 words or fewer, and test status. |
| `await` | Rarely needed: long-poll for a click. Normally Claude ends its turn and a click wakes it. |

### What `init` writes

`.claude-board/` (state plus its own `.gitignore`), the `board` server in `.mcp.json`, hooks (including the background `watch` hook on `SessionStart`, `UserPromptSubmit` and `Stop` that lets a click wake Claude), an `mcp__board` allow rule and `MCP_TOOL_TIMEOUT=600000` (unless already set) in `.claude/settings.json`, and a 5-line snippet in `CLAUDE.md`. Hook commands use a quoted forward-slash path, so install folders with spaces work in both bash and cmd. All files are merged, never overwritten, and re-running is safe.

### Development

`dist/` is committed so installing from GitHub needs no build step; run `npm run build` before committing code changes. `npm install`, then `npm run dev` (engine on 4317 plus Vite), `npm test` (unit tests and an end-to-end MCP/HTTP/SSE/hooks suite), and `npm run build`.

## License

MIT
