import { useLayoutEffect } from "react";
import { NavigationType, useLocation, useNavigationType } from "react-router";

import { selectClass } from "./current-class-store";

// 헤더의 반 전환은 이동이 끝난 뒤에 반을 바꿉니다(#326 리뷰). 이동하기 전에 바꾸면 초안 검토 화면처럼
// 떠나는 이동을 막는 화면(useBlocker)에서, 이동은 막혔는데 반만 바뀌어 그 화면이 다른 반의 데이터로 바뀝니다.
// 그래서 바꿀 반은 Link의 state로 보내고, 이동이 끝나 도착한 뒤에 교사 화면의 틀(TeacherLayout)이 바꿉니다.

interface ClassSwitchState {
  switchClassTo: string;
}

/** 반 전환 Link의 state입니다. 이동이 끝나면 이 반으로 바뀝니다. */
export function classSwitchState(classId: string): ClassSwitchState {
  return { switchClassTo: classId };
}

function switchTargetOf(state: unknown): string | null {
  if (typeof state !== "object" || state === null || !("switchClassTo" in state)) return null;
  const target: unknown = state.switchClassTo;
  return typeof target === "string" ? target : null;
}

/**
 * 반 전환 Link로 도착했으면 그 반으로 바꿉니다. TeacherLayout이 부릅니다.
 * - 뒤로·앞으로 가기와 새로고침(POP)으로 같은 기록에 돌아왔을 때는 다시 바꾸지 않습니다. 반은 기록이 아니라 교사가 고른 값입니다.
 * - 화면을 그리기 전(useLayoutEffect)에 바꿔, 도착한 화면이 이전 반으로 보였다가 바뀌지 않게 합니다.
 */
export function useClassSwitchOnArrival() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const target = switchTargetOf(location.state);

  useLayoutEffect(() => {
    if (target !== null && navigationType !== NavigationType.Pop) selectClass(target);
  }, [location.key, target, navigationType]);
}
