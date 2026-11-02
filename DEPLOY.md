# Deploying Stocktake V2 on Coolify

V2 runs **alongside** the legacy app. Legacy keeps deploying from `master`; V2 deploys
from the `v2` branch into its own Coolify application with its own database.
Nothing below touches the legacy app.

## 1. Create the V2 database
Coolify → your project → **+ New → Database → PostgreSQL** (16 recommended).
Name it e.g. `stocktake-v2-db`. Copy the **internal** connection URL
(`postgres://...@<container-name>:5432/postgres`).

## 2. Create the V2 application
Coolify → **+ New → Application → (GitHub App / Public repo)** → `Blokkies/cautious-enigma`
- **Branch:** `v2`
- **Build pack:** `Dockerfile` (uses the `Dockerfile` in the repo root)
- **Ports exposed:** `3000`
- **Name:** `Stocktake V2`
- **Domain:** a new one, e.g. `https://stocktake-v2.example.com` (don't reuse legacy's)
- **Health check path:** `/api/health` (the image also has a Docker HEALTHCHECK)

## 3. Environment variables (Application → Environment Variables)
| Variable | Value |
|---|---|
| `DATABASE_URL` | internal URL from step 1 |
| `JWT_SECRET` | new random value (`openssl rand -base64 48`), **different from legacy** |
| `ADMIN_PASSWORD` | password for the first admin login |

Optional: `SKIP_MIGRATIONS=1` to stop migrations running on start.

## 4. Deploy
Click **Deploy**. On start the container runs the (idempotent) DB migrations, then
starts Next.js. Check `https://<v2-domain>/api/health` → `{"status":"ok","version":"V2"}`.

Then log in at the V2 domain as admin with `ADMIN_PASSWORD` — on an empty DB the first
login creates the admin account. The login page shows a **V2** badge.

## Notes
- **Single instance:** login rate limiting is in-memory, so keep one replica.
- **Offline data is per-domain:** phones that used legacy keep their offline queue on
  the legacy domain; V2 starts clean. The installed home-screen app is named "Stocktake V2".
- **Moving data from legacy** (optional): `pg_dump` the legacy DB and restore into the
  V2 DB *before* first use, then redeploy so migrations add the V2 columns/indexes.
