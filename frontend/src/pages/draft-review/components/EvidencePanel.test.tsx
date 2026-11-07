import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftMediaView, EvidenceView, SentenceView } from "@/api/documents";

import { EvidencePanel } from "./EvidencePanel";

const CLIP_ID = "media-video";

function evidence(overrides: Partial<EvidenceView> = {}): EvidenceView {
  return {
    evidence_id: "ev-1",
    source_type: "video_speech",
    text: "제가 더 높이 쌓을래요.",
    media_id: CLIP_ID,
    start_ms: 2600,
    end_ms: 4000,
    captured_at: null,
    source_document_id: null,
    ...overrides,
  };
}

function sentence(evidences: EvidenceView[]): SentenceView {
  return {
    sentence_id: "s1",
    section: null,
    text: "더 높이 쌓겠다고 말했어요.",
    is_edited_by_teacher: false,
    evidences,
  };
}

function media(type: DraftMediaView["type"], mediaId = CLIP_ID): DraftMediaView {
  return {
    media_id: mediaId,
    type,
    url: `https://bucket.invalid/${mediaId}`,
    url_expires_at: "2026-11-07T05:00:00Z",
  };
}

function renderPanel(evidences: EvidenceView[], items: DraftMediaView[], onClipFailed = vi.fn()) {
  render(
    <EvidencePanel
      sentence={sentence(evidences)}
      media={items}
      onClipFailed={onClipFailed}
      onClose={vi.fn()}
    />,
  );
  return onClipFailed;
}

describe("EvidencePanel 근거 재생", () => {
  let play: ReturnType<typeof vi.spyOn>;
  let pause: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom에는 미디어 재생이 없습니다.
    play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("영상 근거를 누르면 그 구간부터 재생한다", async () => {
    renderPanel([evidence()], [media("video")]);
    const video = document.querySelector("video");

    await userEvent.click(screen.getByRole("button", { name: /제가 더 높이 쌓을래요\. 재생/ }));

    expect(video).toHaveAttribute("src", `https://bucket.invalid/${CLIP_ID}`);
    expect(video?.currentTime).toBe(2.6);
    expect(play).toHaveBeenCalledOnce();
  });

  it("누르기 전에는 원본을 불러오지 않는다", () => {
    renderPanel([evidence()], [media("video")]);

    expect(document.querySelector("video")).toHaveAttribute("preload", "none");
    expect(play).not.toHaveBeenCalled();
  });

  it("음성 메모는 소리만 재생한다", async () => {
    renderPanel(
      [evidence({ source_type: "teacher_voice_memo", media_id: "memo" })],
      [media("voice_memo", "memo")],
    );

    await userEvent.click(screen.getByRole("button", { name: /재생$/ }));

    expect(document.querySelector("audio")).not.toBeNull();
    expect(document.querySelector("video")).toBeNull();
    expect(play).toHaveBeenCalledOnce();
  });

  it("구간이 3초보다 길면 구간 끝에서 멈춘다", () => {
    renderPanel([evidence({ start_ms: 1000, end_ms: 6000 })], [media("video")]);
    const video = document.querySelector("video") as HTMLVideoElement;

    video.currentTime = 5.9;
    fireEvent.timeUpdate(video);
    expect(pause).not.toHaveBeenCalled();

    video.currentTime = 6;
    fireEvent.timeUpdate(video);
    expect(pause).toHaveBeenCalledOnce();
  });

  it("구간이 3초보다 짧아도 3초는 들려준다", () => {
    renderPanel([evidence({ start_ms: 1000, end_ms: 2000 })], [media("video")]);
    const video = document.querySelector("video") as HTMLVideoElement;

    video.currentTime = 2.5;
    fireEvent.timeUpdate(video);
    expect(pause).not.toHaveBeenCalled();

    video.currentTime = 4;
    fireEvent.timeUpdate(video);
    expect(pause).toHaveBeenCalledOnce();
  });

  it("재생 중에 누르면 멈춘다", async () => {
    renderPanel([evidence()], [media("video")]);
    const video = document.querySelector("video") as HTMLVideoElement;
    fireEvent.play(video);

    await userEvent.click(screen.getByRole("button", { name: /멈추기$/ }));

    expect(pause).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();
  });

  it("재생에 실패하면 알리고 새 URL을 받게 한다", () => {
    const onClipFailed = renderPanel([evidence()], [media("video")]);

    fireEvent.error(document.querySelector("video") as HTMLVideoElement);

    expect(screen.getByRole("alert")).toHaveTextContent("재생하지 못했어요");
    expect(onClipFailed).toHaveBeenCalledOnce();
  });

  it("사진·메모 근거에는 재생 버튼을 두지 않는다", () => {
    renderPanel(
      [
        evidence({ evidence_id: "ev-photo", source_type: "photo_observation", start_ms: null }),
        evidence({
          evidence_id: "ev-note",
          source_type: "teacher_note",
          media_id: null,
          start_ms: null,
          text: "교사 메모",
        }),
      ],
      [media("photo")],
    );

    expect(screen.queryByRole("button", { name: /재생$/ })).not.toBeInTheDocument();
    expect(screen.getByText("문장이 근거와 맞는지 확인해 보세요.")).toBeInTheDocument();
  });
});

it("교사가 글로 남긴 메모 근거는 출처를 교사 메모로 보여 준다", () => {
  renderPanel(
    [
      evidence({
        evidence_id: "note:1",
        source_type: "teacher_note",
        text: "비 오는 날 우산을 직접 챙겼어요.",
        media_id: null,
        start_ms: null,
        end_ms: null,
      }),
    ],
    [],
  );

  expect(screen.getByText("교사 메모")).toBeInTheDocument();
});
