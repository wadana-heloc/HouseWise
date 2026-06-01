# Image-scan flow

Pass-through endpoint that lets the mobile client extract `{name, brand, size}` from a product photo. The backend forwards the image to the image-analysis agent (EasyOCR + Claude) and returns the structured result. **Nothing is persisted.** Upstream contract: [ai_agents/image-agent/BACKEND_CONTRACT.md](../ai_agents/image-agent/BACKEND_CONTRACT.md). Endpoint code: [backend/app/items/router.py](../backend/app/items/router.py) `scan_image`.

---

## Endpoint

| Property | Value |
| --- | --- |
| Method | `POST` |
| Path | `/items/scan-image` |
| Auth | bearer (any household member) |
| Body | `{ "image_base64": "...", "media_type": "image/jpeg" }` |
| Response | `{ "name": ..., "brand": ..., "size": ..., "reason": ... }` |

`media_type` must be one of `image/jpeg`, `image/png`, `image/webp`, `image/gif`.

`image_base64` is the raw base64 (no `data:image/...;base64,` prefix), capped at `SCAN_IMAGE_MAX_BASE64` chars (default 7_500_000 ≈ 5 MB image). The constant lives at the top of [backend/app/items/schemas.py](../backend/app/items/schemas.py) — bump it there if the mobile client needs to send larger photos.

The HTTP status is **always 200** for both success and agent failure. The failure shape lives in the response body via the `reason` field — this matches the agent's "never raises" contract.

---

## Response interpretation

| `reason` | Meaning | Mobile UI |
| --- | --- | --- |
| `null` | Scan succeeded (fully or partially) | Show confirmation form pre-filled with whatever fields came back. Nulls are fine — let the user fill them in. |
| `"No text detected in image"` | Image blank or too blurry | Show a retake button. |
| `"Agent error: ..."` | Anthropic API or system failure | Show a generic error with retry. |

Any of `name`, `brand`, `size` can be `null` independently when `reason` is also `null` — that's a *partial* read, not a failure.

---

## Sequence

```
Mobile               Backend                       Agent                       Anthropic
  | photo -> base64 (strip data: prefix)            |                            |
  | POST /items/scan-image                          |                            |
  | { image_base64, media_type }                    |                            |
  |--------------------------> current_user (JWT verify)
  |                            _user_household       |                            |
  |                            run_in_threadpool ->|                            |
  |                            analyze_product_image                              |
  |                                                  | EasyOCR (local, free)     |
  |                                                  |  extracts raw text         |
  |                                                  |--------------------------->|
  |                                                  |   Claude text API          |
  |                                                  |   structures into JSON     |
  |                                                  |<---------------------------|
  |                            <-- ProductAnalysisResult                          |
  |<-- 200 ProductScanResponse <-- mapped to our own schema                       |
  | confirmation screen pre-filled                  |                            |
  | user reviews + edits + taps "Add to list"       |                            |
  | -> separate POST /items (NOT this endpoint)     |                            |
```

The scan endpoint never touches the database. The mobile client decides what to do with the result; it calls `POST /items` separately to actually save.

---

## Permissions

Any authenticated household member may call this endpoint (same role bar as `POST /items`). The handler resolves the caller's household via the existing `_user_household` helper and returns **403** if the caller has no household (rare — implies an orphaned `auth.users` row).

Cost note: each successful scan costs one Claude text-API call. The agent is configured with prompt caching (per the contract), so repeated calls are cheap. There is no rate limit in this PR; if abuse becomes a concern, add a per-household token bucket later.

---

## Failure modes

| Symptom | Root cause | Where |
| --- | --- | --- |
| 422 `image_base64` too long | Payload above `SCAN_IMAGE_MAX_BASE64` (default ~7 MB) | [backend/app/items/schemas.py](../backend/app/items/schemas.py) |
| 422 `image_base64` empty | Pydantic `min_length=1` | [backend/app/items/schemas.py](../backend/app/items/schemas.py) |
| 422 `media_type` rejected | `Literal["image/jpeg", "image/png", "image/webp", "image/gif"]` doesn't match | [backend/app/items/schemas.py](../backend/app/items/schemas.py) |
| 401 missing bearer | `current_user` couldn't read the `Authorization` header | [backend/app/auth/deps.py](../backend/app/auth/deps.py) |
| 403 caller is not in a household | `_user_household` raised | [backend/app/items/router.py](../backend/app/items/router.py) |
| 503 image-analysis agent is not available | `from image_agent import ...` failed (deployment missing `ai_agents/image-agent/`, easyocr not installed, or the sys.path shim didn't resolve) | [backend/app/main.py](../backend/app/main.py) sys.path setup |
| 200 with `reason: "Agent error: ..."` | Anthropic API outage, model rejection, or unexpected exception inside the agent — agent never raises, always returns this shape | [ai_agents/image-agent/image_agent.py](../ai_agents/image-agent/image_agent.py) |
| EasyOCR cold start visibly slow on first request after deploy | The lifespan handler in main.py warms the agent on startup, but a fresh process still pays the ~30s model-load. After warmup, scans are fast for the lifetime of the process. | [backend/app/main.py](../backend/app/main.py) `lifespan` |

---

## What this endpoint does NOT do

- It does **not** persist anything. No row is written to `public.items`. The mobile client must call `POST /items` to actually save after the user confirms.
- It does **not** validate the base64 string format. The agent handles bad base64 internally and returns a `reason`. Adding a check here would duplicate work for no benefit.
- It does **not** apply any household-level rate limiting. If abuse is observed, that's a future PR.
- It does **not** chain into the price-comparison agent. That orchestration is outside this endpoint's scope.
