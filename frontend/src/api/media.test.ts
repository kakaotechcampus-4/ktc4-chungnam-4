import { uploadContentType } from "./media";

describe("uploadContentType", () => {
  it("브라우저가 준 형식이 있으면 그대로 쓴다", () => {
    expect(uploadContentType({ name: "합성.jpg", type: "image/jpeg" })).toBe("image/jpeg");
  });

  // 브라우저가 HEIC 등의 형식을 모르면 file.type이 빈 값이라 서버가 거절합니다(API 문서 §media).
  it.each([
    ["합성.HEIC", "image/heic"],
    ["합성.heif", "image/heic"],
    ["합성.mov", "video/quicktime"],
    ["합성.m4a", "audio/mp4"],
  ])("형식이 빈 값이면 확장자로 채운다: %s", (name, expected) => {
    expect(uploadContentType({ name, type: "" })).toBe(expected);
  });

  it("모르는 확장자는 빈 값으로 두어 서버가 사유와 함께 거절하게 한다", () => {
    expect(uploadContentType({ name: "합성.zip", type: "" })).toBe("");
  });
});
