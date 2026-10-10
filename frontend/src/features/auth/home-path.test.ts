import { homePath } from "./home-path";

describe("homePath", () => {
  it.each([
    ["teacher", "/t"],
    ["parent", "/p"],
    ["unknown", "/"],
  ] as const)("%s는 %s로 간다", (role, path) => {
    expect(homePath(role)).toBe(path);
  });
});
