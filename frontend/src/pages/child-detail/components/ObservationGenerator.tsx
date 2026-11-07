// 임시 연결 UI(FR-06, #225). 김진하 님 #264의 Figma 159:3788·159:3882 전용 화면으로 교체합니다.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { createObservationJob, isJobFinished, jobQueryOptions } from "@/api/agents";
import { childDraftsQueryOptions, documentsKeys } from "@/api/documents";
import { Button } from "@/components/ui/button";
import { kstToday } from "@/lib/datetime";

interface ObservationGeneratorProps {
  childId: string;
}

const STAGE_LABEL_MAP: Record<string, string> = {
  transcribing: "발화를 정리하고 있어요",
  collecting_evidence: "게시된 알림장에서 관찰 내용을 모으고 있어요",
  generating: "관찰일지 초안을 작성하고 있어요",
  verifying: "문장과 원본 근거를 대조하고 있어요",
};

export function ObservationGenerator({ childId }: ObservationGeneratorProps) {
  const [month, setMonth] = useState(() => kstToday().slice(0, 7));
  const [jobId, setJobId] = useState("");
  const [request, setRequest] = useState<{ month: string; id: string } | null>(null);
  const client = useQueryClient();
  const notes = useQuery(childDraftsQueryOptions(childId, "parent_note", true));
  const observations = useQuery(childDraftsQueryOptions(childId, "observation_log"));
  const job = useQuery({ ...jobQueryOptions(jobId), enabled: jobId !== "" });
  const create = useMutation({
    mutationFn: ({ month: selectedMonth, id }: { month: string; id: string }) =>
      createObservationJob(childId, { month: selectedMonth, request_id: id }),
    onSuccess: (result) => {
      client.setQueryData(jobQueryOptions(result.job_id).queryKey, result);
      setJobId(result.job_id);
    },
  });
  const count = notes.data?.filter((note) => note.record_date.startsWith(month)).length ?? 0;
  const childJob = job.data?.children.find((child) => child.child_id === childId);
  const complete = isJobFinished(job.data);
  useEffect(() => {
    if (complete) {
      void client.invalidateQueries({
        queryKey: documentsKeys.childDrafts(childId, "observation_log", false),
      });
    }
  }, [childId, client, complete, jobId]);
  const busy = create.isPending || (jobId !== "" && !complete);
  const existing = observations.data?.find((draft) => draft.record_date === `${month}-01`);
  const drafted =
    existing || (job.data?.record_date === `${month}-01` && childJob?.outcome === "drafted");
  const failed = complete && !drafted;

  function start() {
    // POST 응답만 유실됐다면 같은 request_id를 다시 사용해 중복 실행을 막습니다.
    const next =
      create.isError && request?.month === month ? request : { month, id: crypto.randomUUID() };
    setRequest(next);
    setJobId("");
    create.mutate(next);
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-paper p-7" aria-label="월별 관찰일지">
      <h2 className="text-lead font-bold text-ink">월별 관찰일지</h2>
      <label className="text-body text-ink">
        관찰할 월
        <input
          type="month"
          value={month}
          max={kstToday().slice(0, 7)}
          disabled={busy}
          onChange={(event) => {
            setMonth(event.target.value);
            setJobId("");
            create.reset();
          }}
          className="ml-3 rounded-md border border-line p-2"
        />
      </label>
      <p className="text-caption text-ink-muted">
        게시된 알림장 {count}건을 참고해 기본 양식으로 만들어요. 생성된 내용과 원본 알림장 근거를
        확인해 주세요.
      </p>
      {count > 0 && count < 5 && (
        <p className="text-caption text-ink-muted">자료가 적어 일부 영역이 비어 있을 수 있어요.</p>
      )}
      {notes.isError && <p role="alert">{notes.error.message}</p>}
      {observations.isError && <p role="alert">{observations.error.message}</p>}
      {busy && !job.isError && (
        <p role="status">{STAGE_LABEL_MAP[childJob?.stage ?? ""] ?? "작업을 준비하고 있어요"}</p>
      )}
      {create.isError && <p role="alert">{create.error.message}</p>}
      {job.isError && (
        <div role="alert">
          진행 상태를 불러오지 못했어요. 작업은 계속될 수 있어요.
          <Button variant="outline" onClick={() => void job.refetch()}>
            상태 다시 확인
          </Button>
        </div>
      )}
      {failed && (
        <p role="alert">
          {childJob?.error_code === "AGENT_INPUT_TOO_LARGE"
            ? "알림장 분량이 처리 한도를 넘었어요. 담당 교사에게 확인해 주세요."
            : childJob?.error_code === "DRAFT_VERSION_CONFLICT"
              ? "기존 관찰일지가 수정되거나 승인되어 새 결과를 저장하지 않았어요. 기존 관찰일지를 확인해 주세요."
              : "초안을 완성하지 못했어요. 자료와 연결 상태를 확인한 뒤 다시 시도해 주세요."}
        </p>
      )}
      {drafted ? (
        <Button asChild>
          <Link
            to={`/t/today/review/${encodeURIComponent(childId)}?record_date=${month}-01&doc_type=observation_log`}
          >
            관찰일지 검토하기
          </Link>
        </Button>
      ) : (
        <Button
          onClick={start}
          disabled={
            busy ||
            !month ||
            notes.isPending ||
            notes.isError ||
            observations.isPending ||
            observations.isError ||
            count === 0
          }
        >
          {failed || create.isError ? "관찰일지 다시 생성" : "관찰일지 생성하기"}
        </Button>
      )}
    </section>
  );
}
