# Deployment flow — Cloud Run

The backend runs as a single container on **Google Cloud Run**, fronted by Cloud
Build for CI. Push to `main` → image rebuilds → a new Cloud Run revision rolls out.

## Why the build context is the repo root

`app/main.py` adds `ai_agents/<folder>` (resolved as `parents[2]`, i.e. the repo
root) to `sys.path` so the hyphenated agent folders import. The image therefore
ships **both** `backend/` and `ai_agents/` in their relative layout:
`/app/backend` + `/app/ai_agents`. The [`Dockerfile`](../Dockerfile) and
[`.dockerignore`](../.dockerignore) live at the repo root for this reason.

The `scan-image` OCR path pulls in `easyocr` → torch. The image installs the
**CPU-only** torch wheels and **bakes the EasyOCR English model** into a layer, so
the blocking startup warm-up in `main.py`'s lifespan is fast (no runtime download).

## Service shape

| Setting | Value | Why |
| --- | --- | --- |
| memory | `4Gi` | torch + the OCR model need headroom |
| cpu | `2` | OCR inference |
| min-instances | `1` | keep one warm so cold start + model load never hit a request |
| max-instances | `4` | cap fan-out |
| cpu-boost | on | faster startup warm-up |
| timeout | `120s` | scan-image can be slow |
| ingress auth | `--allow-unauthenticated` | the mobile client has no Google identity; the API enforces its own Supabase JWT auth |

> **`--allow-unauthenticated`** opens the *Cloud Run platform* layer (grants
> `roles/run.invoker` to `allUsers`). This is **not** app auth — every endpoint except
> `/health` still requires a valid Supabase bearer, verified in
> [`app/auth/deps.py`](../backend/app/auth/deps.py). It's set this way because the mobile
> client calls Cloud Run directly over the internet with a Supabase token, not a Google
> identity, so it can't satisfy platform IAM. If an org policy
> (`iam.allowedPolicyMemberDomains`) blocks `allUsers`, the deploy step fails and you'd
> front the service with an authenticating proxy / API gateway instead.

## Configuration → where it lives

App config is read from environment variables by
[`app/settings.py`](../backend/app/settings.py) (pydantic-settings). No `.env` ships
in the image — Cloud Run injects everything.

**Secret Manager** (referenced via `--set-secrets`, never printed in logs — CLAUDE.md §7.7/§7.8):

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `ANTHROPIC_API_KEY`

**Plain env** (`--set-env-vars`, from trigger substitutions):

- `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`,
  `SUPABASE_JWT_AUDIENCE` (`authenticated`), `APP_DEEP_LINK`

## One-time setup

Run once per GCP project. These create cloud resources — review before running.

```bash
PROJECT_ID=<your-project>
REGION=me-central1            # Dammam; pick the region closest to the Supabase project
REPO=housewise
RUNTIME_SA=housewise-run

gcloud config set project "$PROJECT_ID"

# 1. Enable APIs.
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

# 2. Artifact Registry repo for the image.
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker --location="$REGION"

# 3. Secrets (paste values when prompted; --data-file=- reads stdin).
printf '%s' '<service_role_key>' | gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=-
printf '%s' '<anon_key>'         | gcloud secrets create SUPABASE_ANON_KEY         --data-file=-
printf '%s' '<anthropic_key>'    | gcloud secrets create ANTHROPIC_API_KEY         --data-file=-

# 4. Least-privilege runtime service account (only reads secrets).
gcloud iam service-accounts create "$RUNTIME_SA" --display-name="HouseWise Cloud Run"
SA_EMAIL="$RUNTIME_SA@$PROJECT_ID.iam.gserviceaccount.com"
for S in SUPABASE_SERVICE_ROLE_KEY SUPABASE_ANON_KEY ANTHROPIC_API_KEY; do
  gcloud secrets add-iam-policy-binding "$S" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/secretmanager.secretAccessor"
done

# 5. Let the Cloud Build service account deploy to Run + act as the runtime SA.
PROJECT_NUM=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
CB_SA="$PROJECT_NUM@cloudbuild.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$CB_SA" --role="roles/run.admin"
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="serviceAccount:$CB_SA" --role="roles/iam.serviceAccountUser"
```

Then connect the GitHub repo (`wadana-heloc/HouseWise`) to Cloud Build and create a
**push trigger on `main`** using [`cloudbuild.yaml`](../cloudbuild.yaml). In the
trigger's substitutions, set the non-secret values to the real project:
`_SUPABASE_URL`, `_SUPABASE_JWKS_URL`, `_SUPABASE_JWT_ISSUER`, `_APP_DEEP_LINK`
(and `_REGION`/`_REPO` if you changed them).

## The redeploy loop — "what if I change code?"

- **App code:** commit and push to `main`. The trigger rebuilds and deploys a new
  revision; traffic shifts once it passes the startup probe. The previous revision
  stays addressable, so rollback is just shifting traffic back — no rebuild:

  ```bash
  gcloud run services update-traffic housewise-backend \
    --region=me-central1 --to-revisions=<previous-revision>=100
  ```

- **Manual / out-of-band deploy** (hotfix without a push):

  ```bash
  gcloud builds submit --config=cloudbuild.yaml .
  ```

- **DB / schema change:** **not** automated. Migrations are still applied by hand in
  the Supabase SQL Editor (production-only, no staging — CLAUDE.md §8). Apply the
  migration **before** deploying code that depends on it.

## Verify after a deploy

```bash
URL=$(gcloud run services describe housewise-backend --region=me-central1 --format='value(status.url)')
curl -s "$URL/health"            # -> {"ok": true}
```

1. `/health` returns `{"ok": true}`.
2. Startup logs show `image_agent warmed (EasyOCR model loaded)` (baked model loaded,
   warm-up didn't time out).
3. `POST /auth/login` against prod Supabase → 200 + session (JWKS/issuer/audience wired).
4. An authed read (`GET /me`) → 200.
5. `POST /items/scan-image` with a sample photo → 200 (torch + `ai_agents/` layout OK
   inside the container).
6. Push a trivial commit → trigger builds and rolls a new revision automatically.
