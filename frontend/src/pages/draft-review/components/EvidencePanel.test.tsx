import { render, screen } from "@testing-library/react";

import { EvidencePanel } from "./EvidencePanel";

it("교사가 글로 남긴 메모 근거는 출처를 교사 메모로 보여 준다", () => {
  render(
    <EvidencePanel
      sentence={{
        sentence_id: "s1",
        section: null,
        text: "우산을 직접 챙겼어요.",
        is_edited_by_teacher: false,
        evidences: [
          {
            evidence_id: "note:1",
            source_type: "teacher_note",
            text: "비 오는 날 우산을 직접 챙겼어요.",
            media_id: null,
            start_ms: null,
            end_ms: null,
            captured_at: null,
            source_document_id: null,
          },
        ],
      }}
      onClose={() => {}}
    />,
  );

  expect(screen.getByText("교사 메모")).toBeInTheDocument();
});
