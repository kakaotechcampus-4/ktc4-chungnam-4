// E2E용 가짜 LLM 게이트웨이입니다. 백엔드의 OpenAI 호환 호출(backend/domains/agents/llm.py)을 받아
// 정해진 응답을 돌려줍니다. 실제 모델 호출 검증은 E2E 범위가 아닙니다.
//
// - 사진 분석: VISION_GATEWAY_BASE_URL=http://127.0.0.1:<port>/vision/v1
// - 초안 생성·Critic: LLM_GATEWAY_BASE_URL=http://127.0.0.1:<port>/llm/v1
// - 테스트 확인용: GET /__requests (받은 요청 목록), POST /__reset (목록 비우기), GET /health
//
// 받은 요청 본문은 메모리에만 두고 파일·stdout에 남기지 않습니다(H-4). 테스트는 /__requests로
// "외부 LLM에 무엇이 갔는지"를 확인합니다(H-2).
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_LLM_PORT ?? 58090);
const DRAFT_PROMPT_HEAD = "너는 어린이집 담임 교사를 돕는 알림장 초안 작성자다";
const CRITIC_PROMPT_HEAD = "너는 어린이집 관찰 문서의 사실 검증자다";

/** @type {{ path: string, kind: string, body: unknown }[]} */
let received = [];

function completion(content) {
  return {
    id: `chatcmpl-e2e-${received.length}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "e2e-fake",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  };
}

function promptText(body) {
  const content = body?.messages?.[0]?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.find((part) => part.type === "text")?.text ?? "";
  return "";
}

// 사진 분석: 프롬프트 끝의 "사진 목록:\nP1: 아이 N명"에서 ref와 인원을 읽어 그대로 돌려줍니다.
function visionReply(prompt) {
  const refs = [...prompt.matchAll(/^(P\d+): 아이 (\d+)명/gm)];
  return JSON.stringify(
    refs.map(([, ref, count]) => ({
      ref,
      observations: [
        { text: "블록을 높이 쌓고 있다", scope: Number(count) > 1 ? "group" : "individual" },
      ],
      no_observation_reason: null,
    })),
  );
}

// 초안: 프롬프트의 근거 목록에서 ref(E1…)를 읽어 한 문장에 모두 연결합니다.
function draftReply(prompt) {
  const refs = [...new Set([...prompt.matchAll(/"ref":\s*"(E\d+)"/g)].map((m) => m[1]))];
  return JSON.stringify({
    sentences: [{ text: "CHILD_A는 블록을 높이 쌓으며 놀이했어요.", evidence_refs: refs }],
  });
}

// Critic: 마지막 줄의 검증 대상 JSON을 읽어 문장마다 pass를 돌려줍니다.
function criticReply(prompt) {
  const target = JSON.parse(prompt.slice(prompt.lastIndexOf("검증 대상:") + "검증 대상:".length));
  return JSON.stringify(
    target.sentences.map((sentence) => ({
      sentence_id: sentence.sentence_id,
      verdict: "pass",
      reason_code: "ok",
      detail: "근거와 일치",
      evidence_ids: sentence.evidences.map((evidence) => evidence.evidence_id),
    })),
  );
}

function reply(path, body) {
  const prompt = promptText(body);
  if (path.startsWith("/vision/")) return { kind: "vision", content: visionReply(prompt) };
  if (prompt.startsWith(CRITIC_PROMPT_HEAD))
    return { kind: "critic", content: criticReply(prompt) };
  if (prompt.startsWith(DRAFT_PROMPT_HEAD)) return { kind: "draft", content: draftReply(prompt) };
  return { kind: "unknown", content: null };
}

function send(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (request.method === "GET" && path === "/health") return send(response, 200, { ok: true });
  if (request.method === "GET" && path === "/__requests") return send(response, 200, received);
  if (request.method === "POST" && path === "/__reset") {
    received = [];
    return send(response, 200, { ok: true });
  }
  if (request.method !== "POST" || !path.endsWith("/chat/completions")) {
    return send(response, 404, { error: { message: "not found" } });
  }
  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => (raw += chunk));
  request.on("end", () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(response, 400, { error: { message: "invalid json" } });
    }
    const { kind, content } = reply(path, body);
    received.push({ path, kind, body });
    if (content === null) return send(response, 400, { error: { message: "unknown prompt" } });
    return send(response, 200, completion(content));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`fake LLM listening on http://127.0.0.1:${PORT}\n`);
});
