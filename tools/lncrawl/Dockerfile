FROM ghcr.io/astral-sh/uv:python3.14-trixie-slim AS builder
ARG LNCRAWL_COMMIT=472e72f680ae8bff8ff7e8a7fd765a91cd0c5a7c
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN git init . && git remote add origin https://github.com/lncrawl/lightnovel-crawler.git \
    && git fetch --depth 1 origin ${LNCRAWL_COMMIT} && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${LNCRAWL_COMMIT}" && rm -rf .git
RUN uv sync --python /usr/local/bin/python3.14 --frozen --no-dev
COPY patch_upstream.py /app/patch_upstream.py
RUN /app/.venv/bin/python /app/patch_upstream.py
COPY integration.py integration_store.py download_plan.py search_flow.py resilience.py source_policy.py source_health.py processing_control.py /app/
COPY overrides/dobytranslations.py /app/sources/en/d/dobytranslations.py
COPY overrides/tinytranslation.py /app/sources/en/t/tinytranslation.py

FROM python:3.14-slim-trixie AS runtime
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/lncrawl /app/lncrawl
COPY --from=builder /app/sources /app/sources
COPY --from=builder /app/LICENSE /app/LICENSE
COPY --from=builder /app/integration.py /app/integration_store.py /app/download_plan.py /app/search_flow.py /app/resilience.py /app/source_policy.py /app/source_health.py /app/processing_control.py /app/
COPY egress.py /app/egress.py
ENV LNCRAWL_DATA_PATH=/data TZ=Europe/Warsaw PYTHONUNBUFFERED=1
EXPOSE 8181
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD ["/app/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8181/health', timeout=3)"]
CMD ["/app/.venv/bin/python", "-m", "uvicorn", "integration:app", "--host", "0.0.0.0", "--port", "8181", "--workers", "1"]
