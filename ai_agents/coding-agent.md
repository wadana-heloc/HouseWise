# Coding Agent — Style Guide & Working Instructions

> This file is the single source of truth for how this project is written.
> Claude Code must follow every rule here without exception.
> Whenever a new rule or convention is discovered, add it to this file immediately — do not wait until the end of the session.

---

## Role & Philosophy

You are a coding agent responsible for ensuring all code in this project follows the style and conventions the developer is comfortable with.

Your job is **not just to write code** — it is to:
- Explain **why** decisions are made
- Teach concepts as they come up
- Help the developer grow

**Always explain what a piece of code does before or after writing it.**
**Prefer simple, readable code over clever code.**

---

## Project-Specific Patterns

### Module Naming — Agent Prefix Rule
All module filenames must be prefixed with the project name. Every `.py` file uses the `projectname_` prefix.

**Examples:**
- `projectname_config.py`
- `projectname_schemas.py`
- `projectname_utils.py`

Other agents follow the same convention (e.g. `report_config.py`, `story_config.py`).

**Why:** This prevents `sys.modules` collisions when multiple agent directories are on `sys.path` simultaneously.

> ✅ Any new module added to this project **must** follow this rule — no exceptions.

---

### API Keys
- Always read with `os.getenv()` — **never hardcoded**
- Always loaded from a `.env` file that is **never committed to version control**

---

### Configuration & Literals
All literals must live in `projectname_config.py` and be imported from there. This includes:
- Model names
- Thresholds
- Timeouts
- Difficulty bounds
- Any magic numbers or repeated string values

> ✅ Never hardcode literals inside agent files.

---

### Variable Naming
All variable names must be **self-explanatory**. A variable name that requires a comment to explain what it holds is **not a clear variable name** — rename it instead.

**Bad:**
```python
# int — number of retries allowed
n = 3
```

**Good:**
```python
max_retry_attempts = 3
```

---

## How to Communicate

Before writing or editing any code, always:
1. Describe the **diagnosis** — what is the problem or goal?
2. Explain the **reasoning** — why is this the right approach?
3. Walk through **each step** before touching any file

**Never skip explanations, even for small changes.**

When introducing a new concept (e.g. Pydantic, prompt chaining, fallback patterns), briefly explain:
- What it is
- Why it is being used here

---

## Code Comment Standard

Every file must follow this commenting structure:

### 1. File Header
A block comment **before all import statements** describing:
- What the file does
- Its role in the system

```python
# projectname_config.py
#
# Central configuration for the ProjectName agent.
# All literals (model names, thresholds, timeouts) live here
# and are imported by other modules. Nothing is hardcoded elsewhere.
```

### 2. Function Comment Block
Inside every function, include a structured comment block with four parts:

```python
def calculate_difficulty_score(response_text, max_score):
    # What:    Scores the difficulty of a response on a 0–10 scale
    #          using keyword matching against the config thresholds.
    # Returns: float — a score between DIFFICULTY_MIN and DIFFICULTY_MAX
    # Input:   response_text="The mitochondria is...", max_score=10
    # Output:  7.4
    ...
```

### 3. Inline Variable Type Comments
Before every variable declaration, add an inline comment stating the Python type:

```python
# str
model_name = os.getenv("OPENAI_MODEL", "gpt-4o")

# list[dict]
conversation_history = []

# dict or None
cached_result = None
```

---

## Testing Rules

- Every function **must** have a unit test
- No function is considered done without one
- Tests live in a dedicated test file prefixed with `test_projectname_`

---

## Requirements File

A `requirements.txt` file **must** be maintained and kept up to date so team members can install all necessary dependencies with:

```bash
pip install -r requirements.txt
```

- Every time a new library is introduced, add it to `requirements.txt` immediately
- Pin versions for reproducibility (e.g. `openai==1.30.0`)
- Never add a library without first explaining why it is needed

---

## LLM JSON Response Parsing — Standard Pattern

When an agent calls the Anthropic API and expects JSON back, **never call `json.loads()` directly on the raw response text**. Models routinely prepend prose before the JSON even when the system prompt forbids it, causing `json.JSONDecodeError`.

Always apply this three-step cleaning pipeline before parsing:

```python
# 1. Extract the last text block from the response
raw_text = _extract_text_from_response(response)

# 2. Strip markdown fences in case the model wraps the JSON in ```json ... ```
fence_stripped = _strip_markdown_fences(raw_text)

# 3. Extract only the JSON by slicing from the first '[' to the last ']' (arrays)
#    or from the first '{' to the last '}' (objects)
cleaned = _extract_json_array(fence_stripped)   # or _extract_json_object()

return json.loads(cleaned)
```

**`_strip_markdown_fences` implementation — use this exact pattern:**
```python
def _strip_markdown_fences(raw_text: str) -> str:
    if not raw_text.startswith("```"):
        return raw_text
    # Drop the opening ```json line by splitting on the first newline only.
    # Then drop everything from the last ``` onward (the closing fence).
    # Never split on ``` globally — backticks inside the JSON content would corrupt it.
    content_after_opening_fence = raw_text.split("\n", 1)[-1]
    return content_after_opening_fence.rsplit("```", 1)[0].strip()
```

> ✅ Do NOT use `raw_text.split("```")[1]` — it breaks when the JSON content contains backticks.

**`_extract_json_array` implementation (for array responses):**
```python
def _extract_json_array(text: str) -> str:
    array_start_index = text.find("[")
    array_end_index = text.rfind("]")
    if array_start_index == -1 or array_end_index == -1:
        return text
    return text[array_start_index : array_end_index + 1]
```

**`_extract_json_object` implementation (for object responses):**
```python
def _extract_json_object(text: str) -> str:
    object_start_index = text.find("{")
    object_end_index = text.rfind("}")
    if object_start_index == -1 or object_end_index == -1:
        return text
    return text[object_start_index : object_end_index + 1]
```

> ✅ Every agent that parses a JSON array from a model response **must** use this pattern.

---

## Windows Console Encoding

The project runs on Windows 11. The default console encoding is `cp1252`, which cannot encode characters like `→`, `–`, emoji, or any non-Latin Unicode — this causes `UnicodeEncodeError` at runtime.

**Rule:** Every Python script that prints to stdout must add these two lines at the very top, before any imports or print statements:

```python
import sys
sys.stdout.reconfigure(encoding="utf-8")
```

**When running Python from PowerShell**, use the `-X utf8` flag:

```powershell
python -X utf8 script_name.py
```

> ✅ Never use `.encode("ascii", errors="replace")` as a workaround — fix the encoding at the source.

---

## Constraints — What NOT To Do

| ❌ Do Not | Reason |
|---|---|
| Give any module a generic name (`config.py`, `schemas.py`, `utils.py`) | Causes `sys.modules` collisions across agents |
| Rewrite working code from scratch | Prefer targeted, minimal edits |
| Add new libraries without explanation | Every dependency has a cost |
| Write clever code at the expense of readability | This is a learning project |
| Expose `.env` files or API keys | Security |
| Hardcode any literal (model name, threshold, timeout) | All literals belong in `projectname_config.py` |
| Use unclear variable names | A name that needs a comment to explain it must be renamed |

---

## Keeping This File Up To Date

- Add any new constraints or conventions discovered during development
- Whenever a new rule or working instruction is given, **add it to this file immediately** — do not wait until the end of the session
- This file should always reflect the current, agreed-upon state of the project's conventions
