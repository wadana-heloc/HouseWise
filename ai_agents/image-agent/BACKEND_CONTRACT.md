# Image Agent — Backend Contract

**Owner:** AI team  
**Consumer:** Backend engineer (FastAPI)

---

## What the agent does

The frontend sends a photo of a product. The agent extracts the product **name**, **brand**, and **size** from the label and returns a structured JSON result. The backend passes the result back to the frontend so the user can confirm and add it to their shopping list.

**Internal pipeline (backend does not need to manage this):**
1. EasyOCR runs locally on the server — extracts raw text from the image for free
2. Claude text API — structures the OCR text into the JSON response (cheap text call, not vision)

---

## Function to call

```python
from image_agent import analyze_product_image
from image_schemas import ProductAnalysisResult

result: ProductAnalysisResult = analyze_product_image(
    image_base64="...",     # str — raw base64, no data URI prefix
    media_type="image/jpeg" # str — MIME type
)
```

**Supported media types:** `image/jpeg` · `image/png` · `image/webp` · `image/gif`

---

## Response shape

```python
class ProductAnalysisResult(BaseModel):
    name:   Optional[str]   # product name from label, or null
    brand:  Optional[str]   # brand name from label, or null
    size:   Optional[str]   # size/weight e.g. "500ml", "1kg", or null
    reason: Optional[str]   # only set when scan completely failed, otherwise null
```

### Reading the response

| `reason` | Meaning | Frontend action |
|---|---|---|
| `null` | Scan succeeded (at least partially) | Show confirmation form pre-filled with returned fields |
| `"No text detected in image"` | Image blank or too blurry | Ask user to retake the photo |
| `"Agent error: ..."` | API or system failure | Show generic error, offer retry |

**Important:** Each of `name`, `brand`, `size` can be `null` independently. A null field means that specific piece of information wasn't readable — it is not a failure. Show the confirmation form with whatever fields were found and let the user fill in the blanks.

---

## How the data flows

```
[Mobile app]  takes photo → encodes to base64 → POST /api/items/scan-image
[Backend]     receives { image_base64, media_type } → calls analyze_product_image()
[Agent]       OCR → Claude → returns ProductAnalysisResult
[Backend]     returns ProductAnalysisResult as JSON response
[Mobile app]  shows confirmation form pre-filled with name / brand / size
```

The backend's only job is to receive the base64 string from the request body and pass it directly to the agent. No file storage, no image processing.

---

## FastAPI endpoint

```python
from fastapi import APIRouter
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from image_agent import analyze_product_image
from image_schemas import ProductAnalysisResult

router = APIRouter()


class ScanImageRequest(BaseModel):
    image_base64: str
    media_type: str


@router.post("/items/scan-image", response_model=ProductAnalysisResult)
async def scan_product_image(body: ScanImageRequest) -> ProductAnalysisResult:
    # analyze_product_image is synchronous (EasyOCR + Anthropic SDK are blocking).
    # run_in_threadpool prevents it from blocking FastAPI's async event loop.
    return await run_in_threadpool(
        analyze_product_image,
        body.image_base64,
        body.media_type,
    )
```

| Property | Value |
|---|---|
| Method | `POST` |
| Path | `/api/items/scan-image` |
| Auth | Supabase JWT (same as other protected item endpoints) |
| Request body | `{ "image_base64": "...", "media_type": "image/jpeg" }` |
| Response | `{ "name": "...", "brand": "...", "size": "...", "reason": null }` |

---

## Base64 — what the frontend must do

Expo's image picker returns a URI like:

```
data:image/jpeg;base64,/9j/4AAQSkZJRgAB...
```

The frontend must **strip the prefix** before sending:

```typescript
const base64Data = uri.replace(/^data:image\/\w+;base64,/, "");
```

Only the raw base64 string (`/9j/4AAQ...`) should be sent in `image_base64`.

---

## Startup behaviour

EasyOCR loads its English OCR model (~50 MB) the first time the process starts. This takes **10–30 seconds** on a CPU server. After that it is cached in memory for the lifetime of the process — all subsequent calls are fast.

**Action required:** Warm up the agent on server startup (before the first real request) so users do not experience a slow first scan:

```python
# In your FastAPI startup event
@app.on_event("startup")
async def warmup_image_agent():
    import image_agent  # importing triggers _ocr_reader initialisation
```

---

## Environment variable

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

The agent reads this automatically. Set it in your deployment environment or `.env` file (never commit it).

---

## Installation

```bash
pip install -r ai_agents/image-agent/requirements.txt
```

---

## Error behaviour summary

The function **never raises**. All failures are returned as a `ProductAnalysisResult` with `reason` set. The backend does not need a try/except around it.

| Scenario | `name` / `brand` / `size` | `reason` |
|---|---|---|
| Clean product label | populated | `null` |
| Partial label (some fields missing) | mixed null/value | `null` |
| No text in image | `null` | `"No text detected in image"` |
| Anthropic API down | `null` | `"Agent error: ..."` |
| Any unexpected exception | `null` | `"Agent error: ..."` |
