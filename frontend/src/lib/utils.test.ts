/// <reference types="node" />
import { readFileSync } from "node:fs";

import { cn, TOKEN_THEME } from "./utils";

// Vitest는 CSS import를 빈 문자열로 바꾸므로 파일을 직접 읽습니다(경로는 frontend 기준).
const tokens = readFileSync("src/styles/tokens.css", "utf8");

describe("cn", () => {
  it("토큰 글자 크기와 글자 색을 둘 다 남긴다", () => {
    expect(cn("text-body text-ink")).toBe("text-body text-ink");
    expect(cn("text-nav", "font-bold text-brand-ink")).toBe("text-nav font-bold text-brand-ink");
  });

  it("같은 종류의 토큰은 뒤의 것으로 바꾼다", () => {
    expect(cn("text-body", "text-nav")).toBe("text-nav");
    expect(cn("max-w-reading", "max-w-form")).toBe("max-w-form");
    expect(cn("h-nav", "h-10")).toBe("h-10");
    expect(cn("shadow-xs", "shadow-dropdown")).toBe("shadow-dropdown");
  });

  it.each([
    ["text", /--text-([a-z0-9-]+):/g],
    ["container", /--container-([a-z0-9-]+):/g],
    ["spacing", /--spacing-([a-z0-9-]+):/g],
    ["shadow", /--shadow-([a-z0-9-]+):/g],
  ] as const)("tokens.css의 %s 토큰이 모두 등록돼 있다", (key, pattern) => {
    // shadow-xs처럼 Tailwind 기본 이름과 같은 것은 등록하지 않아도 됩니다.
    const builtIn = new Set(["xs"]);
    const names = [...tokens.matchAll(pattern)]
      .map((match) => match[1] ?? "")
      .filter((name) => !name.includes("--") && !builtIn.has(name));

    expect(names.length).toBeGreaterThan(0);
    expect([...TOKEN_THEME[key]].sort()).toEqual([...new Set(names)].sort());
  });
});
