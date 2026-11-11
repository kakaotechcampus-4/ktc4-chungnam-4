// E2E 실행 환경의 주소·계정을 한 곳에 둡니다. playwright.config.ts와 테스트가 함께 읽습니다.
//
// 여기 있는 값은 전부 **E2E 전용 테스트 값**입니다. 로컬 컨테이너(e2e/docker-compose.yml)와
// 가짜 LLM 서버에만 쓰이고, 운영·개발 서버의 키·비밀번호가 아닙니다.
import { randomBytes } from "node:crypto";

export const PORTS = {
  web: 55173,
  api: 58000,
  fakeLlm: 58090,
  postgres: 55432,
  redis: 56379,
  s3: 59000,
} as const;

export const WEB_URL = `http://localhost:${PORTS.web}`;
export const FAKE_LLM_URL = `http://127.0.0.1:${PORTS.fakeLlm}`;

// backend/scripts/seed_photo_demo.py가 만드는 계정·원아입니다.
// 보호자 N은 원아 N번째(CHILD_NAMES 순서)와 연결됩니다.
export const SEED = {
  className: "합성 햇살반",
  teacher: { email: "photo-demo.teacher@example.com", password: "e2e-teacher-password" },
  parentOfFirstChild: { email: "photo-demo.parent1@example.com", password: "e2e-parent-password" },
  parentOfSecondChild: { email: "photo-demo.parent2@example.com", password: "e2e-parent-password" },
  firstChildName: "김도윤",
  secondChildName: "박서아",
} as const;

/**
 * 백엔드(API·worker)에 넘기는 환경변수입니다.
 *
 * 실제 환경변수가 `backend/.env`보다 우선합니다. 로컬의 `backend/.env`에 있는 실제 키가 쓰이지 않도록
 * AI·저장소·DB 관련 키를 **빠짐없이** 여기서 덮어씁니다. 특히 LLM 주소는 가짜 서버만 가리킵니다.
 */
export function backendEnv(): Record<string, string> {
  return {
    APP_ENV: "test",
    POSTGRES_HOST: "127.0.0.1",
    POSTGRES_PORT: String(PORTS.postgres),
    POSTGRES_USER: "aidam_e2e",
    POSTGRES_PASSWORD: "aidam-e2e-password",
    POSTGRES_DB: "aidam_e2e",
    CELERY_BROKER_URL: `redis://127.0.0.1:${PORTS.redis}/0`,
    CELERY_RESULT_BACKEND: `redis://127.0.0.1:${PORTS.redis}/1`,
    // 실행마다 새로 만듭니다. DB도 매번 비우므로 이전 값이 필요 없습니다.
    JWT_SECRET: randomBytes(48).toString("base64url"),
    FACE_EMBEDDING_KEY: randomBytes(32).toString("base64"),
    FACE_EMBEDDING_KEY_REF: "e2e",
    // S3 대신 로컬 SeaweedFS. 주소를 IP로 주어야 boto3가 path-style URL을 만듭니다.
    S3_BUCKET: "aidam-e2e",
    S3_REGION: "ap-northeast-2",
    AWS_ENDPOINT_URL_S3: `http://127.0.0.1:${PORTS.s3}`,
    AWS_ACCESS_KEY_ID: "aidam-e2e",
    AWS_SECRET_ACCESS_KEY: "aidam-e2e-secret",
    // 로컬 AWS 설정 파일이 끼어들지 않게 막습니다(AWS_PROFILE은 start-backend.sh가 지웁니다).
    AWS_CONFIG_FILE: "/dev/null",
    AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
    // 외부 AI는 전부 가짜 서버로 보냅니다.
    ANTHROPIC_API_KEY: "e2e-fake-key",
    LLM_GATEWAY_BASE_URL: `${FAKE_LLM_URL}/llm/v1`,
    VISION_GATEWAY_BASE_URL: `${FAKE_LLM_URL}/vision/v1`,
    STT_GATEWAY_BASE_URL: `${FAKE_LLM_URL}/stt/v1`,
    STT_API_KEY: "e2e-fake-key",
    DEMO_TEACHER_PASSWORD: SEED.teacher.password,
    DEMO_PARENT_PASSWORD: SEED.parentOfFirstChild.password,
    E2E_API_PORT: String(PORTS.api),
  };
}
