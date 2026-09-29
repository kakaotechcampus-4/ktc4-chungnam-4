FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --system app \
    && useradd --system --gid app --home-dir /app app

COPY --chown=app:app . .
USER app
EXPOSE 8000

# --proxy-headers: Caddy가 붙여 보내는 X-Forwarded-* 를 신뢰해 실제 클라이언트
#   IP를 읽습니다. 없으면 request.client.host가 Caddy 컨테이너 IP로 찍혀
#   AccessLog(H-4)에 남길 IP가 전부 같은 값이 됩니다.
# --forwarded-allow-ips "*": 이 컨테이너는 compose 네트워크와 127.0.0.1에만
#   노출되어 Caddy 외에는 도달할 경로가 없습니다. **호스트 포트를 외부로 여는
#   변경을 하면 이 값을 Caddy의 주소로 좁혀야 합니다** — 아니면 아무나 헤더를
#   위조해 IP를 속일 수 있습니다.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
