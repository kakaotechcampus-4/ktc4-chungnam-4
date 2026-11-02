import { FACE_MODEL_BASE_PATH } from "./model-manifest";
import { FACE_DESCRIPTOR_LENGTH } from "./types";

// 실제 얼굴 인식은 브라우저에서만 돌아 여기서 확인할 수 없습니다(jsdom에는 WebGL이
// 없습니다). 대신 **설정과 안전장치**를 확인합니다 — 설정이 벡터를 바꾸고, 안전장치가
// 없으면 모든 원아가 같은 사람으로 판정되기 때문입니다(#121 리뷰 송유진 님).
//
// 실제 검출은 사람이 사진으로 확인하고 결과를 PR에 적습니다. 원아 사진은 쓰지 않습니다
// (루트 CLAUDE.md).

const { humanMock, detectMock, loadMock, statsMock, resetMock } = vi.hoisted(() => {
  const detect = vi.fn();
  const load = vi.fn(() => Promise.resolve());
  const stats = vi.fn();
  const reset = vi.fn();
  const human = vi.fn(function (this: Record<string, unknown>, config: unknown) {
    this.config = config;
    this.detect = detect;
    this.load = load;
    this.reset = reset;
    this.models = { stats };
  });
  return {
    humanMock: human,
    detectMock: detect,
    loadMock: load,
    statsMock: stats,
    resetMock: reset,
  };
});

vi.mock("@vladmandic/human", () => ({ Human: humanMock }));

const { detectFaces, loadFaceModels, resetFaceModels, FaceModelError } = await import("./detector");

/** 모델이 다 올라온 상태. `loaded`가 false면 HUMAN은 조용히 넘어갑니다. */
function modelStats(loaded: Partial<Record<string, boolean>> = {}) {
  return {
    modelStats: ["blazeface", "facemesh", "faceres"].map((name) => ({
      name,
      loaded: loaded[name] ?? true,
    })),
  };
}

/** HUMAN이 돌려주는 얼굴 하나. 길이만 바꿔 가며 씁니다. */
function faceResult(descriptorLength: number | null, score = 0.9) {
  return {
    score,
    embedding: descriptorLength === null ? undefined : Array<number>(descriptorLength).fill(0.1),
  };
}

function photo() {
  return new File([new Uint8Array([1, 2, 3])], "p.jpg", { type: "image/jpeg" });
}

beforeEach(() => {
  resetFaceModels();
  humanMock.mockClear();
  detectMock.mockReset();
  loadMock.mockClear();
  resetMock.mockClear();
  statsMock.mockReset();
  statsMock.mockReturnValue(modelStats());
  // jsdom에는 createImageBitmap이 없습니다. 비트맵은 detect에 넘기기만 합니다.
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => Promise.resolve({ close: vi.fn() })),
  );
});

describe("얼굴 인식 설정", () => {
  // 설정이 자르는 크기·정렬·밝기를 바꿔 같은 얼굴에서도 다른 벡터가 나옵니다. 일부 키만
  // 보면 `rotation`·`scale`·`filter`를 바꿔도 통과하므로 **생성자에 넘긴 설정 전체**를
  // 고정합니다(#226 리뷰 송유진 님). 값을 바꿀 일이 생기면 여기도 함께 고치게 됩니다.
  it("생성자에 넘기는 설정 전체를 고정한다", async () => {
    await loadFaceModels();

    expect(humanMock.mock.calls[0]?.[0]).toEqual({
      // 모델은 우리 빌드에서 내보냅니다. 기본값은 상대 경로라 절대 경로로 적습니다.
      modelBasePath: FACE_MODEL_BASE_PATH,
      // 파일 이름으로만 찾는 캐시라 모델을 바꿔도 옛 것을 씁니다.
      cacheModels: false,
      // 기본 0.7은 비슷한 사진이 이어지면 앞 결과를 다시 씁니다. 정지 사진이라 끕니다.
      cacheSensitivity: 0,
      backend: "humangl",
      // 기본값은 첫 사진의 밝기로 정한 보정값을 그 뒤 모든 사진에 곱합니다.
      filter: { enabled: false },
      // 복사하지 않은 모델은 끕니다. 켜 두면 없는 파일을 요청하다 실패합니다.
      body: { enabled: false },
      hand: { enabled: false },
      object: { enabled: false },
      gesture: { enabled: false },
      segmentation: { enabled: false },
      face: {
        enabled: true,
        // 기본값 1이면 얼굴이 여럿이어도 하나만 돌려줘, 등록에서 multiple_faces를 가릴
        // 수 없고 단체 사진도 한 명만 잡힙니다.
        detector: { enabled: true, maxDetected: 20 },
        // 정렬. 끄면 잘라내는 그림이 달라져 벡터가 바뀝니다.
        mesh: { enabled: true },
        // 벡터를 만드는 모델(faceres).
        description: { enabled: true },
        // iris도 얼굴 모델이지만 홍채 추적용이라 빼서 약 3MB를 아낍니다.
        iris: { enabled: false },
        emotion: { enabled: false },
        antispoof: { enabled: false },
        liveness: { enabled: false },
      },
    });
  });

  // 모델이 약 9MB라 사진마다 다시 받으면 분류가 느려집니다. cacheModels가 생성자에서만
  // 먹히기도 해서 인스턴스를 다시 만들면 안 됩니다.
  it("모델은 한 번만 준비한다", async () => {
    await Promise.all([loadFaceModels(), loadFaceModels()]);
    await loadFaceModels();

    expect(humanMock).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledTimes(1);
  });
});

describe("모델 준비 실패", () => {
  // HUMAN은 모델을 받지 못해도 예외를 던지지 않고 로그만 남깁니다. faceres가 없으면 모든
  // 사진이 "얼굴 0개"가 되고, facemesh가 없으면 길이는 1024인데 값이 다른 벡터가 조용히
  // 나옵니다(#226 리뷰 송유진 님).
  it("모델을 하나라도 받지 못하면 던진다", async () => {
    statsMock.mockReturnValue(modelStats({ facemesh: false }));

    await expect(loadFaceModels()).rejects.toThrow(FaceModelError);
  });

  it("받지 못한 모델 이름을 알려 준다", async () => {
    statsMock.mockReturnValue(modelStats({ blazeface: false, faceres: false }));

    await expect(loadFaceModels()).rejects.toThrow(/blazeface, faceres/);
  });

  // 실패한 약속을 그대로 기억해 두면 그 세션은 새로고침 전까지 영영 실패합니다.
  it("실패한 뒤 다시 부르면 다시 받아 본다", async () => {
    statsMock.mockReturnValueOnce(modelStats({ faceres: false }));
    await expect(loadFaceModels()).rejects.toThrow(FaceModelError);

    await expect(loadFaceModels()).resolves.toBeDefined();
    expect(loadMock).toHaveBeenCalledTimes(2);
    // 인스턴스는 그대로 둡니다 — cacheModels가 생성자에서만 먹힙니다.
    expect(humanMock).toHaveBeenCalledTimes(1);
    // reset()이 모듈마다 들고 있는 모델 캐시를 비우고, load에 넘긴 설정이 reset이
    // 날린 값을 되살립니다. 둘 중 하나만 빠져도 조용히 틀어집니다.
    expect(resetMock).toHaveBeenCalledTimes(2);
    expect(loadMock).toHaveBeenLastCalledWith(humanMock.mock.calls[0]?.[0]);
    // 횟수와 인자만 보면 순서를 바꿔도 통과하는데, load → reset이면 올린 설정을 도로
    // 날려 maxDetected가 1로 돌아갑니다. 같은 회차에서 reset이 먼저인지 봅니다
    // (#226 재리뷰 송유진 님).
    expect(resetMock.mock.invocationCallOrder[1]).toBeLessThan(
      loadMock.mock.invocationCallOrder[1]!,
    );
  });
});

describe("얼굴 검출", () => {
  it("찾은 얼굴마다 벡터와 신뢰도를 돌려준다", async () => {
    detectMock.mockResolvedValue({
      face: [faceResult(FACE_DESCRIPTOR_LENGTH, 0.93), faceResult(FACE_DESCRIPTOR_LENGTH, 0.71)],
    });

    const faces = await detectFaces(photo());

    expect(faces).toHaveLength(2);
    expect(faces[0]?.descriptor).toHaveLength(FACE_DESCRIPTOR_LENGTH);
    expect(faces[0]?.confidence).toBe(0.93);
  });

  it("얼굴이 없으면 빈 배열이다", async () => {
    detectMock.mockResolvedValue({ face: [] });

    expect(await detectFaces(photo())).toEqual([]);
  });

  // 버리면 결과가 "얼굴 없음"이 되어, 모델이 깨진 것을 사진 탓으로 보여 줍니다. 교사가
  // 할 일이 다릅니다 — 얼굴 없음은 다른 사진을 고르면 되지만 실패는 다시 시도해야
  // 합니다(#226 리뷰 송유진 님).
  it.each([
    ["faceres가 안 떴을 때", 0],
    ["description을 껐을 때", null],
    ["다른 모델에서 온 값", 512],
  ])("길이가 맞지 않는 벡터는 던진다 — %s", async (_label, length) => {
    detectMock.mockResolvedValue({
      face: [faceResult(length), faceResult(FACE_DESCRIPTOR_LENGTH)],
    });

    await expect(detectFaces(photo())).rejects.toThrow(FaceModelError);
  });

  // HUMAN facemesh가 얼굴 박스를 모듈 전역에 두고 await 사이에 다시 읽어서, 동시에 부르면
  // 남의 박스로 사진을 자릅니다. 개수·길이·신뢰도가 정상이라 걸러지지 않습니다
  // (#226 리뷰 송유진 님).
  it("동시에 불러도 detect는 한 번에 하나만 돈다", async () => {
    let running = 0;
    let mostAtOnce = 0;
    detectMock.mockImplementation(async () => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      await Promise.resolve();
      running -= 1;
      return { face: [faceResult(FACE_DESCRIPTOR_LENGTH)] };
    });

    await Promise.all([detectFaces(photo()), detectFaces(photo()), detectFaces(photo())]);

    expect(mostAtOnce).toBe(1);
    expect(detectMock).toHaveBeenCalledTimes(3);
  });

  // 한 장이 실패했다고 줄이 끊기면 나머지 100여 장이 통째로 멈춥니다.
  it("앞 사진이 실패해도 다음 사진은 돈다", async () => {
    detectMock.mockRejectedValueOnce(new Error("WebGL 없음"));
    detectMock.mockResolvedValue({ face: [faceResult(FACE_DESCRIPTOR_LENGTH)] });

    const [failed, succeeded] = await Promise.allSettled([
      detectFaces(photo()),
      detectFaces(photo()),
    ]);

    expect(failed?.status).toBe("rejected");
    expect(succeeded?.status).toBe("fulfilled");
  });

  // 사진이 수십 장이면 비트맵이 쌓여 메모리가 찹니다. 검출이 실패해도 놓아야 합니다.
  it("검출이 실패해도 비트맵을 놓는다", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve({ close })),
    );
    detectMock.mockRejectedValue(new Error("WebGL 없음"));

    await expect(detectFaces(photo())).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
  });
});
