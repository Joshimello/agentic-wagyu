ARG MEDIA_BASE_IMAGE=ghcr.io/astral-sh/uv:0.8.22-python3.12-bookworm-slim
FROM ${MEDIA_BASE_IMAGE} AS media-base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-noto-cjk fonts-liberation git libgomp1 libreoffice-impress poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-tra tesseract-ocr-chi-sim && rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY services/media/pyproject.toml services/media/uv.lock ./
RUN UV_HTTP_TIMEOUT=600 UV_HTTP_RETRIES=5 UV_CONCURRENT_DOWNLOADS=2 uv sync --frozen --no-dev
COPY services/media/asr.py services/media/app.py services/media/media.py services/media/documents.py services/media/document_media.py services/media/jobs.py ./
ENV PATH="/service/.venv/bin:$PATH" HF_HOME=/cache/huggingface DATA_ROOT=/data PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

FROM media-base AS checks
RUN UV_HTTP_TIMEOUT=600 UV_HTTP_RETRIES=5 uv sync --frozen

FROM media-base AS runtime
