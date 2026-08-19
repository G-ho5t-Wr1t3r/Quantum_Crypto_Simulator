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

CMD ["uvicorn", "qkd.api:app", "--host", "0.0.0.0", "--port", "8000"]
