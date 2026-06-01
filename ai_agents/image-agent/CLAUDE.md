# Image Product Identification Agent

## What This Agent Does

A single Python function `analyze_product_image(image_base64: str, media_type: str) -> ProductAnalysisResult` that identifies a product from a photo of its packaging and returns structured name/brand/size information.

**Pipeline (two stages):**
1. **EasyOCR (free, local)** — extracts raw text from the image on-device, no API cost
2. **Claude text API (cheap)** — structures the OCR text into JSON; text tokens cost a fraction of vision tokens

The backend calls this function after receiving an image from the mobile app.

---

## Function Signature

```python
def analyze_product_image(image_base64: str, media_type: str) -> ProductAnalysisResult
```

**Input:**
- `image_base64` — base64-encoded image string (no data URI prefix, just the raw base64 data)
- `media_type` — MIME type of the image, must be one of: `image/jpeg`, `image/png`, `image/webp`, `image/gif`

**Output:** `ProductAnalysisResult` — see Output Schema section.

---

## Output Schema

```python
class ProductAnalysisResult(BaseModel):
    name: Optional[str]     # product name as printed on the packaging
    brand: Optional[str]    # brand name as printed on the packaging
    size: Optional[str]     # size/weight (e.g. "500ml", "1kg", "12 pack")
    reason: Optional[str]   # populated only when the product cannot be identified
```

**Rules:**
- All fields can be `None`.
- `reason` is `None` when at least partial extraction succeeded.
- `reason` is populated when the image is unreadable or contains no product label.
- The agent **never raises** — on any error it returns null fields with a reason string.

---

## Module Structure

| File | Purpose |
|---|---|
| `image_agent.py` | Main logic. Public entry point: `analyze_product_image()` |
| `image_config.py` | All literals — model name, token budget, system prompt, user prompt |
| `image_schemas.py` | Pydantic models: `ProductAnalysisResult`, `ImageAnalysisRequest` |
| `test_image_agent.py` | Unit tests for every function (Anthropic client is mocked) |
| `BACKEND_CONTRACT.md` | Public API contract for the backend engineer |
| `requirements.txt` | Pinned dependencies |

---

## Implementation Decisions

### OCR + Text API — Not Vision
EasyOCR extracts text from the image locally for free. Claude receives plain text (not the image) and structures it into JSON. This is significantly cheaper than Claude's vision API because text tokens cost a fraction of image tokens.

EasyOCR's `Reader` is initialised once at module level (`_ocr_reader`) so the ~50 MB English model is loaded only once per process, not on every call.

### Prompt Caching
The system prompt is passed with `cache_control: {"type": "ephemeral"}` so repeated calls are charged at 10% of normal input token cost on cache hits.

### JSON Cleaning Pipeline
The three-step pipeline from `coding-agent.md` is adapted for JSON objects instead of arrays:
1. `_extract_text_from_response()` — get the last text block
2. `_strip_markdown_fences()` — remove accidental ` ```json ... ``` ` wrapping
3. `_extract_json_object()` — slice from first `{` to last `}` to strip leading prose

### Error Fallback
Every failure path (API error, parse error, unexpected exception) returns:
```python
ProductAnalysisResult(name=None, brand=None, size=None, reason="<description>")
```
The caller never receives an exception.

---

## Environment Variable

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

The `anthropic.Anthropic()` client reads this automatically. Store it in `.env` (never commit it).

---

## Running Tests

```bash
cd ai_agents/image-agent
pip install -r requirements.txt
python -m pytest test_image_agent.py -v
```

All tests use mocked API calls — no real API key needed for unit tests.

---

## What This Agent Does NOT Do

- It does not store results — storage is the backend's responsibility.
- It does not validate whether the media type is supported before calling the API — pass a valid type from the backend.
- It does not chain into the price agent — that orchestration is outside this agent's scope.
- It does not maintain conversation history — fully stateless, one image in, one result out.
