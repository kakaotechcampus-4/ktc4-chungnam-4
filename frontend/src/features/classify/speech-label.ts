/** "발화 02"처럼 두 자리 순번. 분류 결과·수동 분류·하루 확인이 같은 이름을 씁니다. */
export function speechLabel(number: number) {
  return `발화 ${String(number).padStart(2, "0")}`;
}
