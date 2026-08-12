# DC Bypass

DoubleCounter verification bypass — paste a link, get a result.

Two parts deployed separately:

- `backend/` — FastAPI + async httpx. Streams solve progress over SSE. Calls your Turnstile solver and the residential proxy. Host on Railway / a VPS / any server that runs Python.
- `frontend/` — Static SPA (React + Vite + TanStack Router). Single input field, live step labels. Hosted free on **GitHub Pages** (or any static host).

The Turnstile **solver** is NOT in this repo — you host it yourself and point the backend at it via `SOLVER_URL`.

## Architecture

```
Frontend (GitHub Pages, static) ──SSE──▶ Backend (Railway/VPS) ──▶ Solver (you host, SOLVER_URL)
                                            │
                                            └──▶ Residential proxy (PROXY_URL) for GET verify + POST token
```

The frontend is a pure client-side app: it talks to the backend over `fetch` + `EventSource`. No server functions, no SSR. Routing uses hash history so deep links / refresh never 404 on a static host.

## Deploy the frontend — GitHub Pages

The repo includes `.github/workflows/deploy.yml`. On every push to `main` it builds `frontend/` and publishes `dist/` to GitHub Pages.

1. **Repo settings → Pages:** set **Source = GitHub Actions**.
2. **Add the backend URL as a repository Actions *variable*** (Settings → Secrets and variables → Actions → Variables, not Secrets — it must be readable at build time):
   - `VITE_API_BASE` — your backend's public URL, e.g. `https://dc-bypass-production-3408.up.railway.app`
   The value is baked into the build at compile time, so after changing it, trigger a redeploy (push to `main` or run the workflow manually).
3. Push to `main`. The workflow builds and deploys. Your site appears at `https://<user>.github.io/<repo>/` (or `https://<user>.github.io/` for a `<user>.github.io` repo).

> **Custom domain** (optional, set up last): add a `CNAME` file in `frontend/public/` containing just the hostname, point your DNS at GitHub Pages (A records for an apex, CNAME for a subdomain), and enter the domain in repo Settings → Pages → Custom domain. With a custom domain the site is served from the domain root, and the relative `base` already handles both that and the `/<repo>/` path.

> The build uses `base: "./"` (relative asset paths) + hash routing, so the same build works at both `https://<user>.github.io/` and `https://<user>.github.io/<repo>/`.

## Deploy the backend — Railway (or any server)

- **Root Directory:** `backend`
- **Build:** Dockerfile (auto-detected)
- **Variables:**
  - `SOLVER_URL` — your solver's public URL, e.g. `http://<solver-host>:6767`
  - `PROXY_URL` — rotating residential proxy, `http://user:pass@host:port`
  - `CORS_ORIGINS` — **your frontend's origin(s)**, comma-separated. For GitHub Pages: `https://<user>.github.io` (or `https://<user>.github.io,<https://<repo>>` if needed). Add your custom domain too when you set one.
  - `MAX_CONCURRENT` — `3` (how many solves hit the solver at once)
  - `SOLVER_NAV_TIMEOUT_MS` — `60000` (optional, default 60000)

> The browser calls the backend cross-origin from GitHub Pages, so `CORS_ORIGINS` MUST include the Pages origin (and later the custom domain). Without it, `fetch` and `EventSource` requests are blocked by the browser.

## Run locally

1. **Solver** — run your Turnstile solver on `http://localhost:6767`

2. **Backend:**
   ```sh
   cd backend
   pip install -r requirements.txt
   $env:SOLVER_URL="http://localhost:6767"
   $env:PROXY_URL="http://user:pass@host:port"
   $env:CORS_ORIGINS="http://localhost:5173"
   uvicorn main:app --port 8000 --reload
   ```

3. **Frontend:**
   ```sh
   cd frontend
   npm install
   $env:VITE_API_BASE="http://localhost:8000"
   npm run dev
   ```
   To preview the static build locally (the same artifact Pages serves):
   ```sh
   npm run build
   npm run preview
   ```

## Endpoints (backend)

- `GET /api/solve?link=<verify-url>` → `text/event-stream` of JSON step events:
  `loading` → `solving` → `verifying` → `done` (with `success`, `userid`)
- `GET /api/stats` → `{ count }` (total solves)
- `GET /api/health` → `{ ok, solver, max_concurrent }`

## Notes

- Per-request rotating proxy (no sticky session needed — verified). Each request is independent → concurrent-safe.
- `asyncio.Semaphore(MAX_CONCURRENT)` caps concurrent solver calls; extra requests queue with a `queued` SSE event.
- No credentials are baked into the images — all secrets via env vars.
- The frontend has no server runtime: everything in `frontend/` is compiled to static `dist/` by Vite.
