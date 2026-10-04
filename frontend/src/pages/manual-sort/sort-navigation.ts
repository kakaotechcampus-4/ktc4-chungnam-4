// 수동 분류의 사진·발화 탭이 같이 쓰는 자료 이동 규칙입니다.

/** 지금 보는 자료를 주소(?item=1~N)에 둡니다. 새로고침과 뒤로 가기에도 같은 자료가 보입니다. */
export function readItemIndex(value: string | null, length: number): number {
  const index = Number(value) - 1;
  return Number.isInteger(index) && index >= 0 && index < length ? index : 0;
}

/** 현재 다음부터 한 바퀴 돌며 아직 처리하지 않은 자료를 찾습니다. 없으면 -1 */
export function nextPending<T>(list: readonly T[], from: number, isPending: (item: T) => boolean) {
  for (let step = 1; step <= list.length; step += 1) {
    const candidate = (from + step) % list.length;
    const item = list[candidate];
    if (candidate !== from && item !== undefined && isPending(item)) return candidate;
  }
  return -1;
}
