# HouseWise backend image. Build context is the repo root, not backend/ —
# app/main.py imports the AI agents from ai_agents/<folder> via sys.path
# (parents[2]), so backend/ and ai_agents/ must keep their relative layout.
FROM python:3.12-slim

# opencv (pulled in by easyocr) needs these shared libs; slim doesn't ship them.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# CPU-only torch first, from the pytorch CPU index. easyocr depends on torch +
# torchvision; without this the default wheels drag in ~2 GB of CUDA we never use.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision

WORKDIR /app
COPY backend ./backend
COPY ai_agents ./ai_agents

# Runtime deps only (no [dev]). torch is already satisfied, so easyocr's torch
# dependency is skipped here.
RUN pip install ./backend

# Bake the EasyOCR English model into the image so it's not downloaded on first
# request. Keeps the blocking lifespan warm-up (app/main.py) fast enough for the
# Cloud Run startup probe.
RUN python -c "import easyocr; easyocr.Reader(['en'])"

WORKDIR /app/backend
# Cloud Run injects $PORT (8080). sh -c so it expands.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
