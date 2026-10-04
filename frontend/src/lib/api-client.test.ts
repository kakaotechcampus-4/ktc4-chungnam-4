import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";

import { api, API_BASE, ApiError } from "./api-client";

const url = (path: string) => `${API_BASE}${path}`;

async function catchError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("요청이 실패하지 않았습니다");
}

describe("api-client", () => {
  it("JSON을 그대로 돌려주고 쿼리를 붙인다", async () => {
    let received: Request | undefined;
    server.use(
      http.get(url("/classes"), ({ request }) => {
        received = request;
        return HttpResponse.json({ items: [{ class_id: "c1" }], next_cursor: null });
      }),
    );

    const data = await api.get("/classes", {
      query: { limit: 20, status: ["enrolled", "trial"], cursor: null, q: undefined, all: false },
    });

    expect(data).toEqual({ items: [{ class_id: "c1" }], next_cursor: null });
    expect(new URL(received!.url).search).toBe("?limit=20&status=enrolled&status=trial&all=false");
    expect(received!.headers.get("accept")).toBe("application/json");
    expect(received!.credentials).toBe("include");
  });

  it("json 본문을 JSON으로 보낸다", async () => {
    let body: unknown;
    let contentType: string | null = null;
    server.use(
      http.post(url("/sessions"), async ({ request }) => {
        body = await request.json();
        contentType = request.headers.get("content-type");
        return HttpResponse.json({ account_id: "a1", account_type: "teacher" }, { status: 201 });
      }),
    );

    await api.post("/sessions", { email: "hanul.kim@example.com", password: "pw" });

    expect(body).toEqual({ email: "hanul.kim@example.com", password: "pw" });
    expect(contentType).toBe("application/json");
  });

  it("204는 undefined를 돌려준다", async () => {
    server.use(
      http.delete(url("/sessions/current"), () => new HttpResponse(null, { status: 204 })),
    );

    await expect(api.delete("/sessions/current")).resolves.toBeUndefined();
  });

  it("에러 봉투를 ApiError로 바꾼다", async () => {
    server.use(
      http.get(url("/classes/c9/children"), () =>
        HttpResponse.json(
          {
            error: { code: "CLASS_ACCESS_DENIED", message: "이 반을 볼 수 없어요.", detail: null },
          },
          { status: 403 },
        ),
      ),
    );

    const error = await catchError(api.get("/classes/c9/children"));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      code: "CLASS_ACCESS_DENIED",
      message: "이 반을 볼 수 없어요.",
      detail: null,
    });
  });

  it("detail 대신 details가 와도 읽는다", async () => {
    server.use(
      http.post(url("/media"), () =>
        HttpResponse.json(
          {
            error: {
              code: "MEDIA_TOO_LARGE",
              message: "파일이 커요.",
              details: { media_ids: ["m1"] },
            },
          },
          { status: 409 },
        ),
      ),
    );

    const error = await catchError(api.post("/media", {}));

    expect(error).toMatchObject({ code: "MEDIA_TOO_LARGE", detail: { media_ids: ["m1"] } });
  });

  it("FastAPI 기본 422는 VALIDATION_ERROR로 바꾼다", async () => {
    const detail = [{ loc: ["body", "email"], msg: "field required", type: "missing" }];
    server.use(http.post(url("/sessions"), () => HttpResponse.json({ detail }, { status: 422 })));

    const error = await catchError(api.post("/sessions", {}));

    expect(error).toMatchObject({ status: 422, code: "VALIDATION_ERROR", detail });
  });

  it("봉투가 없는 5xx는 UNKNOWN_ERROR다", async () => {
    server.use(http.get(url("/classes"), () => new HttpResponse("Bad Gateway", { status: 502 })));

    const error = await catchError(api.get("/classes"));

    expect(error).toMatchObject({ status: 502, code: "UNKNOWN_ERROR", detail: null });
  });

  it("200이어도 JSON이 아니면 실패로 보고, 경고에는 쿼리를 남기지 않는다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.use(http.get(url("/classes"), () => HttpResponse.html("<!doctype html><html></html>")));

    const error = await catchError(api.get("/classes", { query: { name: "김도윤" } }));

    expect(error).toMatchObject({ status: 200, code: "UNKNOWN_ERROR" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("GET /classes"));
    // 쿼리에는 이름이 들어갈 수 있어서 콘솔에 남기지 않습니다(H-4).
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("김도윤"));
    warn.mockRestore();
  });

  it("연결이 안 되면 status 0, NETWORK_ERROR다", async () => {
    server.use(http.get(url("/classes"), () => HttpResponse.error()));

    const error = await catchError(api.get("/classes"));

    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("취소하면 ApiError가 아니라 취소 에러를 그대로 던진다", async () => {
    server.use(
      http.get(url("/classes"), async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ items: [] });
      }),
    );
    const controller = new AbortController();

    const request = api.get("/classes", { signal: controller.signal });
    controller.abort();
    const error = await catchError(request);

    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: "AbortError" });
  });

  it("본문을 읽다가 취소해도 취소 에러를 그대로 던진다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 헤더는 먼저 오고 본문은 끝나지 않는 응답입니다. 취소하면 본문 읽기가 AbortError로 끊깁니다.
    vi.stubGlobal("fetch", async (_url: URL, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode('{"items": ['));
          init.signal?.addEventListener("abort", () => stream.error(init.signal?.reason));
        },
      });
      return new Response(body, { headers: { "content-type": "application/json" } });
    });
    const controller = new AbortController();

    const request = api.get("/classes", { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    const error = await catchError(request);

    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: "AbortError" });
    expect(warn).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    warn.mockRestore();
  });

  it("경로가 /로 시작하지 않으면 요청하지 않는다", async () => {
    await expect(api.get("classes")).rejects.toThrow('API 경로는 "/"로 시작합니다');
  });
});
