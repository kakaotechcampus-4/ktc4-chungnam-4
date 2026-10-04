// 문장 속 호칭("오늘 도윤이는 이랬어요")을 이름에서 만듭니다. API에 호칭 필드가 없어 규칙으로 계산합니다.
// 성을 뺀 이름 끝 글자에 받침이 있으면 "이"를 붙입니다: 김도윤 → 도윤이, 박서아 → 서아.
// 가정: 성은 한 글자입니다. 두 글자 성(남궁 등)은 이름을 한 글자 짧게 읽습니다.

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

function hasFinalConsonant(char: string) {
  const code = char.charCodeAt(0);
  if (code < HANGUL_START || code > HANGUL_END) return false;
  return (code - HANGUL_START) % 28 !== 0;
}

export function nickname(fullName: string) {
  const given = fullName.length >= 3 ? fullName.slice(1) : fullName;
  const last = given.at(-1) ?? "";
  return hasFinalConsonant(last) ? `${given}이` : given;
}
