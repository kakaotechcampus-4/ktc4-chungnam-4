// API 문서 §organization(담당 이한나)을 옮긴 임시 타입입니다. 명세가 바뀌면 여기부터 맞춥니다.

/** GET /classes 항목. 교사가 담당하는 반 */
export interface ClassSummary {
  class_id: string;
  center_id: string;
  /** 가정: API 문서 제안 필드(헤더의 어린이집 이름) */
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

/** GET /me/children 항목(학부모용). 교사용 명단과 스키마를 나눕니다(H-1). */
export interface MyChild {
  child_id: string;
  name: string;
  class_id: string;
  class_name: string;
  age_group: string;
  center_name: string;
  /** (제안) 현재 담임. 알림장 작성자 author_name과는 다른 값입니다. */
  class_teacher_name: string;
  /** (제안) 졸업 후 1년이 지나면 true. 이 자녀의 알림장 조회는 CHILD_ACCESS_EXPIRED로 막힙니다. */
  access_expired: boolean;
}
