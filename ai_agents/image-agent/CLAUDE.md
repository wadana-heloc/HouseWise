# Image Product Identification Agent

## What This Agent Does

A single Python function `analyze_product_image(image_base64: str, media_type: str) -> ProductAnalysisResult` that identifies a product or item from a photo and returns structured name/brand/size information.

**Pipeline (one stage):**
1. **Claude Haiku Vision** — image is sent directly to Claude; it reads label text for packaged products and visually identifies unpackaged items (fruit, vegetables, eggs, etc.)

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
    name: Optional[str]     # product or item name (e.g. "Full Fat Milk", "Apple", "Egg")
    brand: Optional[str]    # brand name from the label, or null for unpackaged items
    size: Optional[str]     # size/weight (e.g. "500ml", "1kg", "12 pack"), or null
    reason: Optional[str]   # populated only when the item cannot be identified at all
```

**Rules:**
- All fields can be `None`.
- `reason` is `None` when at least the name was identified.
- `reason` is populated when the image is unreadable or the item is completely unidentifiable.
- For unpackaged items (produce, eggs, etc.), `brand` and `size` will typically be `None` while `name` is set.
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

### Claude Vision — Not OCR + Text
The previous pipeline used EasyOCR to extract text from labels, then sent that text to Claude. This failed entirely for unpackaged items (apples, eggs, vegetables) that have no label text.

Claude Haiku Vision receives the image directly and handles both cases in one pass:
- **Packaged products**: reads the label to extract name, brand, and size
- **Unpackaged items**: visually identifies the item by appearance (e.g. returns `"Apple"` for a photo of an apple)

Haiku is used instead of Sonnet to keep vision costs low (~6x cheaper per image). Product identification is a simple one-shot scan, so Haiku accuracy is sufficient.

### Prompt Caching
The system prompt is passed as the first content block with `cache_control: {"type": "ephemeral"}` so repeated calls are charged at 10% of normal input token cost on cache hits.

### JSON Cleaning Pipeline
Three-step pipeline applied to every model response:
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
