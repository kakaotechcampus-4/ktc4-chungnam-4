// API 문서 v0 §organization(담당 이한나)을 옮긴 임시 타입입니다. 명세가 바뀌면 여기부터 맞춥니다.

/** GET /classes 항목. 교사가 담당하는 반 */
export interface ClassSummary {
  class_id: string;
  center_id: string;
  /** 가정: v0 제안 필드(헤더의 어린이집 이름) */
  center_name: string;
  name: string;
  /** 표시용 문자열("만 4세"). 형식이 미정이라 이 값으로 분기하지 않습니다. */
  age_group: string;
}

/** GET /classes/{class_id}/children 항목. 재원 원아만, 이름 가나다순 */
export interface ClassChild {
  child_id: string;
  class_id: string;
  name: string;
}
