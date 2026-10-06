FROM ghcr.io/astral-sh/uv:0.8.22-python3.12-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-noto-cjk fonts-liberation git libgomp1 libreoffice-impress poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-tra tesseract-ocr-chi-sim && rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY services/media/pyproject.toml services/media/uv.lock ./
RUN uv sync --frozen --no-dev
COPY services/media/asr.py services/media/app.py services/media/media.py services/media/documents.py ./
ENV PATH="/service/.venv/bin:$PATH" HF_HOME=/cache/huggingface DATA_ROOT=/data PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
