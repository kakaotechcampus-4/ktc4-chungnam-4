import { createCn } from "cn/config";

// tokens.css에 있는 이름을 cn에 알려 줍니다. 모르는 이름은 잘못 합쳐집니다.
// 예: 등록하지 않으면 cn("text-body text-ink")가 text-body를 색으로 보고 지웁니다.
// tokens.css에 글자 크기 · 폭 · 간격 · 그림자 토큰을 추가하면 여기에도 추가합니다(utils.test.ts가 확인).
export const TOKEN_THEME = {
  text: ["caption", "label", "body", "nav", "lead", "h3", "h2", "h1", "logo"],
  container: ["app", "parent", "reading", "form", "form-sm", "rail"],
  spacing: ["nav", "parent-bar", "gutter"],
  shadow: ["dropdown"],
};

export const cn = createCn({ extend: { theme: TOKEN_THEME } });
