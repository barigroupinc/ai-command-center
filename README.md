# AI Command Center

A self-hosted, installable PWA that sends one prompt to a Claude "manager" agent,
which splits it into subtasks, runs them in parallel across Claude, Gemini, and
GPT, and merges the results into a single answer. Single-password login, dark
mode, mobile-first chat UI with live per-agent status badges.

## Stack

- **Backend**: Node.js, Express, `ws` (WebSocket), SQLite via `better-sqlite3`
- **Agents**: `server/agents/{claude,gemini,gpt}.js` — one file per provider, same `{ run(prompt) }` interface
- **Orchestrator**: `server/orchestrator.js` — Claude splits the task into JSON subtasks, runs them with `Promise.allSettled`, merges into a final answer
- **Auth**: single app password (bcrypt) + JWT in an httpOnly cookie
- **Frontend**: `public/` — plain HTML/CSS/vanilla JS, installable PWA (manifest + service worker)
- **Process manager**: PM2 (`ecosystem.config.js`)
- **Reverse proxy / HTTPS**: Caddy (`Caddyfile`)

## Project layout

```
server/
  index.js          Express + HTTP server bootstrap
  db.js             SQLite schema (tasks, messages, agent_runs)
  auth.js           JWT sign/verify + requireAuth middleware
  orchestrator.js    split -> parallel run -> merge
  ws.js             authenticated WebSocket broadcast
  agents/
    claude.js       Anthropic SDK, model claude-sonnet-4-6
    gemini.js       @google/genai SDK
    gpt.js          OpenAI SDK, model from OPENAI_MODEL
  routes/
    auth.js         POST /api/auth/login, /logout
    tasks.js        GET/POST /api/tasks
public/
  index.html, style.css, app.js
  manifest.json, service-worker.js, icons/
scripts/
  hash-password.js  generates a bcrypt hash for APP_PASSWORD_HASH
ecosystem.config.js  PM2 process definition
Caddyfile            HTTPS reverse proxy config
```

## Required configuration

Before running anything, copy `.env.example` to `.env` and fill in:

| Variable            | Required | Notes                                                        |
| ------------------- | -------- | ------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`  | yes      | used by the Claude agent and the orchestrator manager/merge   |
| `OPENAI_API_KEY`     | yes*     | used by the GPT agent (*task fails gracefully per-agent if missing) |
| `OPENAI_MODEL`       | no       | defaults to `gpt-4o-mini` if unset                            |
| `GEMINI_API_KEY`     | yes*     | used by the Gemini agent (*same graceful-failure behavior)    |
| `APP_PASSWORD_HASH`  | yes      | bcrypt hash of your login password — see below                |
| `JWT_SECRET`         | yes      | long random string, e.g. `openssl rand -hex 32`               |
| `PORT`               | no       | defaults to `3000`                                             |

The server refuses to start if `JWT_SECRET` or `APP_PASSWORD_HASH` is missing.
If a provider's API key is missing, that agent returns an error for its
subtask instead of crashing the whole task — the orchestrator still merges
whatever succeeded.

### Generate `APP_PASSWORD_HASH`

```bash
npm install
node scripts/hash-password.js 'your-chosen-password'
```

Paste the printed hash into `.env` as `APP_PASSWORD_HASH`.

## Local development

```bash
npm install
cp .env.example .env
# fill in .env, then generate APP_PASSWORD_HASH (see above)
npm start
```

Visit `http://localhost:3000`, enter your password, and send a task.

## Deploying to a VPS

These steps assume a fresh Ubuntu/Debian VPS with a domain already pointed at
its IP address.

### 1. Install Node.js, PM2, and Caddy

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
sudo npm install -g pm2

sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

`build-essential` is required so `better-sqlite3` can compile its native
addon during `npm install`.

### 2. Clone the app and install dependencies

```bash
cd /opt
sudo git clone <your-repo-url> ai-command-center
cd ai-command-center
sudo npm install --omit=dev
```

### 3. Configure environment

```bash
sudo cp .env.example .env
sudo nano .env
```

Fill in the API keys, `JWT_SECRET` (`openssl rand -hex 32`), and
`APP_PASSWORD_HASH` (`node scripts/hash-password.js 'your-password'`).

### 4. Start with PM2

```bash
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # follow the printed instructions to enable boot-time startup
```

Check it's running:

```bash
pm2 status
pm2 logs ai-command-center
curl -i http://127.0.0.1:3000
```

### 5. Configure Caddy for HTTPS

Edit `Caddyfile` and replace `your-domain.example.com` with your real domain,
then install it as the system Caddyfile:

```bash
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy automatically provisions and renews a Let's Encrypt TLS certificate for
the domain and reverse-proxies to the Node app on `127.0.0.1:3000`.

### 6. Verify

Visit `https://your-domain.example.com`, enter your app password, and send a
task. Install it as a PWA from your browser's "Add to Home Screen" /
"Install app" menu.

### Updating

```bash
cd /opt/ai-command-center
sudo git pull
sudo npm install --omit=dev
pm2 restart ai-command-center
```

## Data

SQLite database lives at `data/app.db` (created automatically, WAL mode).
Tables: `tasks`, `messages`, `agent_runs`. Back up `data/app.db*` for the full
chat/task history.

## Notes

- The orchestrator's split/merge steps both call the Claude agent — if
  `ANTHROPIC_API_KEY` is missing, task creation will fail at the split step.
- Subtask agent assignment is decided by the Claude manager per task; each
  agent is used at most once per task.
- WebSocket connections at `/ws` require the same auth cookie as the REST
  API — unauthenticated upgrade requests are rejected with 401.
