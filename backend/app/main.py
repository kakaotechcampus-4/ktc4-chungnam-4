from fastapi import FastAPI

app = FastAPI(title="아이담 API")


@app.get("/health")
def health_check():
    """서버가 살아있는지 확인하는 엔드포인트.
    docker compose up 이후 여기 200이 돌아오면 1주차 목표 달성."""
    return {"status": "ok"}
