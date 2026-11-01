import { FACE_MODEL_BASE_PATH } from "./model-manifest";
import { FACE_DESCRIPTOR_LENGTH } from "./types";

// 실제 얼굴 인식은 브라우저에서만 돌아 여기서 확인할 수 없습니다(jsdom에는 WebGL이
// 없습니다). 대신 **설정과 안전장치**를 확인합니다 — 설정이 벡터를 바꾸고, 안전장치가
// 없으면 모든 원아가 같은 사람으로 판정되기 때문입니다(#121 리뷰 송유진 님).
//
// 실제 검출은 사람이 사진으로 확인하고 결과를 PR에 적습니다. 원아 사진은 쓰지 않습니다
// (루트 CLAUDE.md).

const { humanMock, detectMock, loadMock } = vi.hoisted(() => {
  const detect = vi.fn();
  const load = vi.fn(() => Promise.resolve());
  const human = vi.fn(function (this: Record<string, unknown>, config: unknown) {
    this.config = config;
    this.detect = detect;
    this.load = load;
  });
  return { humanMock: human, detectMock: detect, loadMock: load };
});

vi.mock("@vladmandic/human", () => ({ Human: humanMock }));

const { detectFaces, loadFaceModels, resetFaceModels } = await import("./detector");

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
  // jsdom에는 createImageBitmap이 없습니다. 비트맵은 detect에 넘기기만 합니다.
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => Promise.resolve({ close: vi.fn() })),
  );
});

describe("얼굴 인식 설정", () => {
  // 설정이 자르는 크기와 정렬을 바꿔 같은 얼굴에서도 다른 벡터가 나옵니다. 한 곳에
  // 고정해 두고, 바뀌면 여기서 걸리게 합니다.
  it("모델을 우리 빌드 주소에서 받고 HUMAN 캐시를 쓰지 않는다", async () => {
    await loadFaceModels();

    const config = humanMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config.modelBasePath).toBe(FACE_MODEL_BASE_PATH);
    // 파일 이름으로만 찾는 캐시라 모델을 바꿔도 옛 것을 씁니다.
    expect(config.cacheModels).toBe(false);
    // 기본 0.7은 비슷한 사진이 이어지면 앞 결과를 다시 씁니다.
    expect(config.cacheSensitivity).toBe(0);
  });

  // 기본값 1이면 얼굴이 여럿이어도 하나만 돌려줘, 등록에서 multiple_faces를 가릴 수 없고
  // 단체 사진도 한 명만 잡힙니다.
  it("한 장에서 얼굴을 여러 개 찾는다", async () => {
    await loadFaceModels();

    const face = (humanMock.mock.calls[0]?.[0] as { face: { detector: { maxDetected: number } } })
      .face;
    expect(face.detector.maxDetected).toBeGreaterThan(1);
  });

  // 복사하지 않은 모델을 켜 두면 없는 파일을 요청하다 실패합니다. iris는 얼굴 모델이지만
  // 홍채 추적용이라 빼서 약 3MB를 아낍니다.
  it("복사하지 않는 모델은 모두 꺼 둔다", async () => {
    await loadFaceModels();

    const config = humanMock.mock.calls[0]?.[0] as Record<string, { enabled: boolean }> &
      Record<"face", Record<string, { enabled: boolean }>>;
    for (const key of ["body", "hand", "object", "gesture", "segmentation"] as const) {
      expect(config[key]?.enabled, key).toBe(false);
    }
    for (const key of ["iris", "emotion", "antispoof", "liveness"] as const) {
      expect(config.face[key]?.enabled, key).toBe(false);
    }
    // 벡터를 만드는 두 모델은 켜져 있어야 합니다.
    expect(config.face.mesh?.enabled).toBe(true);
    expect(config.face.description?.enabled).toBe(true);
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

  // 모델 로딩이 실패해도 HUMAN은 예외를 던지지 않고 로그만 남깁니다. faceres가 없으면
  // embedding이 빈 배열로 나오는데, match.similarity([], x)는 1(완전 일치)을 돌려줍니다.
  // 그대로 두면 모든 원아가 서로 같은 사람으로 판정됩니다(#121 리뷰 송유진 님 2번).
  it("길이가 맞지 않는 벡터는 버린다", async () => {
    detectMock.mockResolvedValue({
      face: [
        faceResult(0), // faceres가 안 떴을 때
        faceResult(null), // description을 끈 결과
        faceResult(512), // 다른 모델에서 온 값
        faceResult(FACE_DESCRIPTOR_LENGTH),
      ],
    });

    const faces = await detectFaces(photo());

    expect(faces).toHaveLength(1);
    expect(faces[0]?.descriptor).toHaveLength(FACE_DESCRIPTOR_LENGTH);
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
