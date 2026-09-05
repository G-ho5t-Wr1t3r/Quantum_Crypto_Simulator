FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

RUN useradd --create-home --uid 10001 qkd
USER qkd

EXPOSE 8000


# `--root-path`, not baked into the app: this container always sits behind the
# nginx reverse proxy at `/api/`, so FastAPI needs to know that prefix to
# generate `/docs` and `openapi.json` correctly. A direct `uvicorn` run — as
# `docs/API.md` describes for local development — has no proxy in front and
# stays unprefixed, which is why this flag lives here and not on the app
# object itself.
CMD ["uvicorn", "qkd.api:app", "--host", "0.0.0.0", "--port", "8000", "--root-path", "/api"]
