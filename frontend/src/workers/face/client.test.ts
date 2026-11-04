class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: { data: { id: number; result: unknown } }) => void;
  onerror?: () => void;
  postMessage = vi.fn<(message: { id: number }) => void>();
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  TestWorker.instances = [];
  vi.stubGlobal("Worker", TestWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("응답 없는 worker를 90초 뒤 종료하고 다음 시도는 새 worker에서 실행한다", async () => {
  const { prepareFaceModels } = await import("./client");
  const first = expect(prepareFaceModels()).rejects.toThrow("시간이 초과");
  await vi.advanceTimersByTimeAsync(90_000);
  await first;
  expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  const next = prepareFaceModels();
  const worker = TestWorker.instances[1]!;
  const id = worker.postMessage.mock.calls[0]![0].id;
  worker.onmessage?.({ data: { id, result: true } });
  await expect(next).resolves.toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("worker 오류가 나면 후보 없이 실패로 끝내고 미식별 얼굴 보호를 유지한다", async () => {
  const { classifyPhoto } = await import("./client");
  const result = classifyPhoto(new File(["synthetic"], "photo.png"), []);
  TestWorker.instances[0]!.onerror?.();
  await expect(result).resolves.toMatchObject({
    classify_state: "failed",
    candidates: [],
    has_unidentified_face: true,
  });
  expect(vi.getTimerCount()).toBe(0);
});
