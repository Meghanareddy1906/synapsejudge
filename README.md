# SynapseJudge

A MERN competitive-programming platform: queued code execution in ephemeral Docker
containers, timed arenas with live ICPC-style standings, and embedding-based plagiarism
detection with human review.

**Live:** <https://synapsejudge.onrender.com> · **Deploy it yourself:**
[DEPLOY.md](DEPLOY.md) (a VM) · [RENDER.md](RENDER.md) (free)

> **What this repository is.** A complete, self-contained implementation of the
> SynapseJudge concept, built from scratch in this repo. It is **not** the code running at
> `synapsejudge.duckdns.org` — that is a separate Next.js application.
>
> **About the live instance.** It runs on Render's free tier, which does not expose a
> Docker daemon, so submissions there are executed by a hosted Judge0 rather than by the
> container sandbox described below. The sandbox is the default and is what runs on a VM
> deployment; see [RENDER.md](RENDER.md) for why the two are not equivalent. The free
> instance also sleeps after 15 minutes idle, so the first request may take ~30 seconds.

Three surfaces share one API:

- **User portal** — browse and solve problems, track submissions, climb the leaderboard,
  compete in timed arenas.
- **Arenas** — scheduled contests with a hidden problem set before the start, contest-local
  scoring, penalty-based tie-breaking and a scoreboard that refreshes while you compete.
- **Admin portal** — problem authoring and rejudging, arena scheduling, plagiarism review,
  and user/role management.

```
React (Vite)  ──HTTP──>  Express API  ──enqueue──>  Redis / BullMQ
                              │                          │
                              │                          ▼
                              │                    Judge worker
                              │                          │
                              ▼                          ▼
                           MongoDB  <───results───  Docker containers
                                                    (one per test case,
                                                     no network, no root)
```

> **A note on the stack.** The frontend is React on **Vite**, not Next.js. Everything here
> is a client-rendered SPA behind Nginx talking to a separate Express API — there is no
> server-rendered page or Next API route, so Vite is the honest description of what is
> deployed and what the Nginx config serves.

The core design principle from the spec is that **submission and execution are
decoupled**. `POST /api/submissions` writes a row, pushes a job, and returns `202`
immediately. A traffic spike queues up in Redis instead of spawning an unbounded
number of containers, and the judge worker scales independently of the API.

---

## Quick start

Prerequisites: **Node 20+** and **Docker** (Desktop or `dockerd`) running.

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # paste into JWT_SECRET

# 3. Start MongoDB + Redis
npm run infra:up

# 4. Build the language sandbox images (once, ~2 min)
npm run runners:build

# 5. Seed problems and accounts
npm run seed

# 6. Run API + judge worker + web app together
npm run dev
```

Then open <http://localhost:5173>.

The seed creates two accounts — change the passwords before exposing this anywhere.
Sign in with either the handle or the email address:

| Handle  | Email              | Password     | Role  |
| ------- | ------------------ | ------------ | ----- |
| `admin` | `admin@judge.local`| `admin12345` | admin |
| `demo`  | `demo@judge.local` | `demo12345`  | user  |

It also seeds 7 problems and 3 arenas positioned relative to seed time — one live, one
upcoming, one finished — so a fresh instance has something to demo immediately.

Processes can also be run individually: `npm run dev:api`, `npm run dev:worker`,
`npm run dev:web`.

---

## Execution sandbox

Every test case runs in its own throwaway container. The flags below are applied to
**every** container, compile and run alike — see
[`server/src/runner/docker.runner.js`](server/src/runner/docker.runner.js).

| Control | Flag | What it stops |
| --- | --- | --- |
| Network isolation | `--network none` | Exfiltration, callbacks, fetching a solution mid-run |
| No privileges | `--cap-drop ALL`, `--security-opt no-new-privileges` | Capability abuse, setuid escalation |
| Non-root | `--user 65534:65534` | Anything that assumes root inside the container |
| Immutable rootfs | `--read-only` | Tampering with the image or planting state between tests |
| Memory ceiling | `--memory`, `--memory-swap` equal | Swap-thrashing past the limit; OOM-kill is the MLE signal |
| Process ceiling | `--pids-limit 96` | Fork bombs |
| CPU ceiling | `--cpus` | One submission starving the judge host |
| Wall clock | host-side `docker rm --force` | Infinite loops (`--timeout` in the container is not trusted) |
| Ephemeral | `--rm` | Any state surviving the run |
| Output cap | 1 MB, then kill | A print-loop exhausting the *judge's* heap before the timer fires |

**Killing the client is not killing the container.** The timeout path stops the container
*on the daemon* by name (`docker rm --force`), not by signalling the local `docker run`
process. Sending `SIGKILL` to the CLI leaves the container running — and since the
container is an infinite loop by definition, it holds a full core indefinitely. A handful
of time-limit-exceeded submissions during a contest would be enough to take the host down.
The CLI is only killed as a fallback, after a 3-second grace period, in case the daemon
itself is wedged.

For the same reason the worker **sweeps orphaned containers on boot**: a worker killed
mid-judge — a deploy, an OOM, a `pm2 restart` — never runs its own reaper, so its
containers outlive it. Every judge container is named `sj-judge-<uuid>`, and only that
prefix is ever swept, so nothing else on the host is touched.

**Mount layout.** Submitted source is bind-mounted read-only at `/sandbox`. The only
writable location during execution is `/tmp`, a 64 MB `tmpfs`.

Compiled languages need one exception, handled deliberately: a binary compiled inside a
container cannot survive into the next container, because `/tmp` is per-container. So a
second mount, `/build`, is **writable during the compile step only** and re-mounted
**read-only for every test run**. The writable window is scoped to `g++` operating on the
source — untrusted code never executes with a writable host mount.

Adding a language means one entry in
[`server/src/runner/languages.js`](server/src/runner/languages.js) plus a Dockerfile in
[`runners/`](runners/). Currently: Python 3.11, C++17, Node 20.

### Verdicts

`accepted` · `wrong_answer` · `time_limit_exceeded` · `memory_limit_exceeded` ·
`runtime_error` · `compilation_error` · `internal_error`

Judging stops at the first failing test. Output comparison ignores trailing whitespace,
trailing blank lines, and CRLF/LF differences — leading whitespace and interior blank
lines are significant.

---

## Arenas

An arena is a scheduled contest over a set of already-published problems. Scoring is
contest-local: an organiser can weight an easy problem at 300 points in a beginner arena
without changing what it is worth in the practice leaderboard.

**The problem set is withheld until the start.** Returning it early would let anyone read
the problems, prepare offline, and submit the moment it opens — so `GET /contests/:slug`
returns `problems: null` while the contest is `upcoming`, for everyone except admins.

### Scoring

Standings are ICPC-style, computed in
[`server/src/services/standings.service.js`](server/src/services/standings.service.js):

- A problem scores its full contest points on the **first accepted** submission, and only
  if that submission landed inside the window.
- Penalty = minutes from the contest start to the solve, **plus** `penaltyMinutes`
  (default 20) for every rejected attempt made *before* it. Attempts after the solve are
  free — there is nothing left to gain.
- `pending`, `running` and `internal_error` count as neither a solve nor a rejection.
  Charging a competitor for a slow judge queue or a judge crash would be wrong.
- Rank is score ↓, then penalty ↑, then time of last solve ↑.
- Registered-but-inactive participants still appear at zero. An empty row is a truer
  picture of a contest than a missing one.

### Submission attribution

A submission carries a `contest` reference only when it is made from a live arena — the
problem page enters arena mode via `?arena=<slug>`. Practice submissions on the same
problem stay `null` and never touch the standings, so grinding a problem after the
contest cannot rewrite history.

Submitting to an arena that has not started, or has already finished, is refused with a
`409` rather than silently downgraded to practice: a competitor who thinks they are
submitting to the contest should never quietly lose the solve. Registration happens
automatically on first submit — a missed Register click should not cost anyone a problem.

---

## Plagiarism detection

On every accepted submission, the code is embedded and compared by cosine similarity
against other users' accepted submissions for the same problem. Pairs above
`PLAGIARISM_THRESHOLD` are written to a review queue.

**Nothing is actioned automatically.** A flag is advisory input for a moderator, who sees
both submissions side by side at `/admin/plagiarism` and records a decision. This is
deliberate: two correct solutions to an easy problem legitimately look alike, so
similarity is a signal, not a verdict.

### On the embedding provider

No hosted embedding provider is required, so the default provider is a
**deterministic local vectoriser** rather than a hosted model — no API key, no network
call on the judging path. It is a good fit here because code plagiarism is a structural
question, not a semantic one:

1. Strip comments and string literals.
2. Normalise tokens — keywords and operators kept verbatim, identifiers → `ID`,
   numbers → `NUM`. This is what defeats renaming.
3. Signed feature-hashing over token 4-grams into 256 dimensions, log-weighted.
4. L2-normalise, so cosine similarity is a plain dot product.

Measured separation on the same task:

| Comparison against the original | Similarity |
| --- | ---: |
| Identical copy | 100.0% |
| Every identifier renamed, comments added | 100.0% |
| Different algorithm (sort + two pointers vs. hash map) | 27.8% |
| Unrelated program | ~0% |

The default 90% threshold sits in a wide gap between "copied" and "independently
written". Set `EMBEDDING_PROVIDER=voyage` with a `VOYAGE_API_KEY` to swap in a hosted
code-embedding model; the interface is identical and it falls back to local on error
rather than failing the submission.

---

## API

All routes are under `/api`. Authentication is a bearer JWT.

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | — | Liveness + feature flags |
| `POST` | `/auth/register` · `/auth/login` | — | Returns `{ token, user }` |
| `GET` | `/auth/me` | user | Current account |
| `GET` | `/problems` | optional | List; filters: `difficulty`, `topic`, `search`, `status`, `page`, `limit` |
| `GET` | `/problems/topics` | — | Distinct topic list |
| `GET` | `/problems/:slug` | optional | Statement + samples (hidden tests never serialised) |
| `GET` | `/problems/:slug/submissions` | user | Caller's attempts on one problem |
| `GET` | `/submissions/languages` | — | Supported languages |
| `POST` | `/submissions` | user | Enqueue a judge job → `202` |
| `GET` | `/submissions` | user | Own submissions (paginated) |
| `GET` | `/submissions/:id` | owner/admin | Full detail incl. source |
| `GET` | `/submissions/queue` | user | Live queue depth |
| `GET` | `/leaderboard` | — | Ranked; `since=all\|week\|month` |
| `GET` | `/leaderboard/stats` | — | Dashboard aggregates |
| `GET` | `/contests` | optional | Arena list; `status=live\|upcoming\|past\|all` |
| `GET` | `/contests/:slug` | optional | Arena detail; problems withheld before the start |
| `POST` | `/contests/:slug/register` | user | Join an arena |
| `GET` | `/contests/:slug/standings` | optional | Live ICPC standings |
| `GET` | `/contests/:slug/my-submissions` | user | Caller's attempts in one arena |
| `GET/POST/PUT/DELETE` | `/admin/contests…` | admin | Arena CRUD |
| `GET/POST/PUT/DELETE` | `/admin/problems…` | admin | Problem CRUD |
| `POST` | `/admin/problems/:id/rejudge` | admin | Re-queue every submission |
| `GET` | `/admin/plagiarism` | admin | Review queue |
| `POST` | `/admin/plagiarism/:id/review` | admin | Confirm or dismiss a flag |
| `GET/PATCH` | `/admin/users…` | admin | User list and role changes |

### Access-control rules worth stating explicitly

- Hidden test cases are stripped in `Problem.toPublic()` and never leave the server.
  Admins reading `/admin/problems/:id` get the full document; solvers cannot.
- On a failing submission, sample-test I/O is returned but **hidden-test I/O is withheld**.
- `GET /submissions/:id` is owner-or-admin. Non-admins cannot list other users'
  submissions even by passing `mine=false`.
- Unpublished problems 404 for everyone except admins.
- Unpublished arenas 404 for everyone except admins, and a published arena still withholds
  its problem set until it starts.
- `?status=` on the plagiarism queue is validated against an enum rather than passed
  through, so `?status[$ne]=x` cannot reach Mongo as an operator object.
- Login accepts a handle or an email. The handle is matched case-insensitively via an
  **anchored, escaped** pattern, so a handle cannot be smuggled in as a regex, and the
  failure message does not distinguish an unknown account from a wrong password.

---

## Scoring

Points are awarded **once per distinct problem solved**, computed by aggregating accepted
submissions rather than incrementing a counter. Resubmitting an accepted solution does not
farm the leaderboard, and a rejudge that turns an AC into a WA correctly *lowers* the
score instead of leaving it inflated. Difficulty sets the value: easy 100, medium 250,
hard 500.

---

## Configuration

Everything is in `.env` (see `.env.example`). The ones that matter:

| Variable | Default | Notes |
| --- | --- | --- |
| `JWT_SECRET` | — | **Required in production**; the server refuses to start without it |
| `MONGO_URI` / `REDIS_URL` | localhost | Redis **6.2+** recommended by BullMQ |
| `JUDGE_CONCURRENCY` | `2` | Containers in flight per worker; scale with host cores |
| `DEFAULT_TIME_LIMIT_MS` / `DEFAULT_MEMORY_LIMIT_MB` | `2000` / `256` | Per-problem values override these |
| `SANDBOX_HOST_DIR` | `./.tmp-submissions` | Staging dir bind-mounted into containers |
| `EMBEDDING_PROVIDER` | `local` | `local` or `voyage` |
| `PLAGIARISM_THRESHOLD` | `0.90` | Cosine similarity above which a pair is flagged |

Rate limits: 300 req/min per IP globally, 20/15 min on auth, 10/min per user on submit.

---

## Deployment

Two supported targets, and the choice is really a choice about the sandbox:

| | **A VM** — [DEPLOY.md](DEPLOY.md) | **Render** — [RENDER.md](RENDER.md) |
| --- | --- | --- |
| Execution | Every submission in its own locked-down container, here | Delegated to a hosted Judge0 |
| Sandbox guarantees | This project's, and verified | Judge0's |
| Untrusted code leaves your infra | No | Yes |
| Cost | A server | Free |

Render and every other managed container platform refuse to expose the Docker
daemon to your process — which is the correct decision on their part, and it
means the sandbox this project is built around cannot run there. Hence the second
execution provider. If the containerised sandbox is the point, deploy to a VM.

Full step-by-step guide: **[DEPLOY.md](DEPLOY.md)**. Short version, on an Ubuntu EC2 host:

```bash
cp .env.production.example .env       # set JWT_SECRET, CLIENT_ORIGIN, SANDBOX_HOST_DIR
./deploy/deploy.sh --seed             # infra, runner images, client build, PM2
sudo cp deploy/nginx/synapsejudge.conf /etc/nginx/sites-available/synapsejudge
sudo certbot --nginx -d your-domain
```

```
Nginx (TLS, reverse proxy, rate limiting)
  ├── /            → client/dist            (static, immutable asset caching)
  └── /api         → synapsejudge-api       (PM2)
                     synapsejudge-worker    (PM2, owns the Docker socket)
                       ├── MongoDB  (127.0.0.1 only)
                       └── Redis    (127.0.0.1 only)
```

Shipped for this:

| File | Purpose |
| --- | --- |
| [`DEPLOY.md`](DEPLOY.md) | Host setup → TLS → reboot survival, with a troubleshooting table |
| [`deploy/deploy.sh`](deploy/deploy.sh) | Idempotent deploy: preflight, build, migrate, restart, health-check |
| [`deploy/nginx/synapsejudge.conf`](deploy/nginx/synapsejudge.conf) | Reverse proxy, SPA fallback, asset caching, per-IP rate limits |
| [`ecosystem.config.cjs`](ecosystem.config.cjs) | PM2 definitions for the API and the judge worker |
| [`.env.production.example`](.env.production.example) | Annotated production configuration |

Three things worth calling out:

- **Mongo and Redis are bound to `127.0.0.1`, not `0.0.0.0`.** A bare `27017:27017` in
  compose publishes on every interface, and Docker writes its own iptables rules that
  *bypass ufw* — on a public host that is an unauthenticated MongoDB open to the internet
  no matter what the firewall claims.
- **`deploy.sh` refuses to deploy with a placeholder `JWT_SECRET`**, and the server
  refuses to boot without one in production. A default signing key is a full
  authentication bypass, not a warning.
- **`index.html` is served `no-cache` while `/assets/*` is immutable.** Vite content-hashes
  asset filenames, so this is safe — and it stops a deploy from leaving browsers pinned to
  the previous bundle while the API has already moved on.

The judge worker needs the Docker socket, which is root-equivalent on the host. The
sandbox flags constrain *submitted code*, not the worker. On this single-host layout the
API and worker share a machine, which is fine for a demo; for real users, run the worker
on a separate instance with no inbound access.

Scaling: API and worker are already separate processes sharing only Mongo and Redis, so
both scale horizontally without code changes.

---

## Verified

The full stack was run end to end against live MongoDB, Redis and Docker — **75 checks
across 4 suites, all passing**. Not a dry run: real containers, real verdicts.

**Judging (all three languages, live containers)**

| Check | Result |
| --- | --- |
| Python accepted | `accepted` 5/5, 280 ms |
| C++ compile → static binary → read-only `/build` run | `accepted` 5/5, 258 ms |
| JavaScript accepted | `accepted` 5/5 |
| Wrong answer | `wrong_answer` 0/5 |
| C++ syntax error | `compilation_error`, compiler diagnostics returned to the author |
| `while True: pass` | `time_limit_exceeded` |

**Sandbox isolation (attempted from inside real submissions)**

| Attack | Result |
| --- | --- |
| `socket.create_connection(("1.1.1.1", 53))` | blocked — `runtime_error`, no egress |
| `open("/etc/passwd", "a")` | blocked — `runtime_error`, read-only rootfs |

**Container lifecycle (the leak found and fixed during this pass)**

Three consecutive infinite loops → 3 × `time_limit_exceeded`, **0 containers stranded** ·
output flood → rejected, 0 stranded · a normal accepted run leaves nothing behind · two
planted orphans were swept on worker boot (`reaped 2 orphaned judge container(s)`).

Before the fix, each of those TLE submissions left a container running at 100% CPU
permanently — measured at 99.97% and 99.95% on two stranded containers.

**Arenas**

Problem set withheld while `upcoming` · labels auto-assigned A/B/C · registration on a
finished arena refused `409` · submitting to a not-yet-started arena refused `409` ·
penalty correctly charged for a rejection before the solve (score 100, 2 attempts,
penalty 82) · practice submissions excluded from standings · two competitors ranked
correctly on score-then-penalty · standings sort order verified.

**Access control**

Hidden-test I/O withheld from the author on a hidden-test failure · hidden test data absent
from `GET /problems/:slug` · `mine=false` leaks nothing to a non-admin · cross-user
submission read `403`, admin read `200` · non-admin blocked from `/admin/*` `403` ·
draft arena invisible publicly, visible to admin · self-demotion refused `400` ·
`?status[$ne]=x` operator injection rejected `400` · regex injection on login rejected.

**Plagiarism**

An identical algorithm with **every identifier renamed and comments added** was flagged at
**100.0% similarity**, left at `pending_review` rather than auto-actioned, rendered
side-by-side for the reviewer, and the review decision persisted.

**Scoring**

Re-solving an already-accepted problem does not farm points (100 → 100) · contest-local
points stay independent of practice points · dashboard aggregates correct.

**Validation**

Inverted contest window → `400` (previously a `500`; fixed — see below) · nonexistent
problem id in an arena → `400` · duplicate handle → `409`.

## Not verified here, and why

**No browser-level UI test.** Pages were verified by building (53 modules, no errors) and
by exercising every endpoint they call. Click-through of the React views themselves was
not automated.

## Known limitations

- **Per-test memory is not measured.** `maxMemoryKb` is always `0`; enforcement works
  (cgroup limit + OOM-kill → `memory_limit_exceeded`) but actual usage is not reported.
  Reporting it needs `docker stats` sampling or a cgroup read per run.
- **Timing includes container startup.** The wall clock allows `timeLimit + 1500 ms` of
  slack so startup isn't charged to the author, but reported times are noisier than a
  `ptrace`/cgroup-based judge. Fine for practice, not for rated contests.
- **The editor is a textarea**, not Monaco — no syntax highlighting. `CodeEditor`'s
  contract is `(value, onChange, language)`, so swapping in CodeMirror is a drop-in change.
- **Arena problems must be published problems.** A contest-exclusive problem set would need
  contest-scoped read access on unpublished problems.
- **Standings are computed per request**, not cached. Fine to a few hundred participants;
  beyond that the aggregation wants a short-TTL Redis cache.
- **No automated test suite.** The 75 checks above were run as scripts, not committed as
  tests. `node:test` plus `mongodb-memory-server` would be the natural next step.
