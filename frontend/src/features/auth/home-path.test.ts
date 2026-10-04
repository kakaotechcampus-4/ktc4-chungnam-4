import { homePath } from "./home-path";

describe("homePath", () => {
  it.each([
    ["teacher", "/t"],
    ["parent", "/p"],
  ] as const)("%s는 %s로 간다", (accountType, path) => {
    expect(homePath(accountType)).toBe(path);
  });
});
