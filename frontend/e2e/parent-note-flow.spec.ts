// 교사가 사진을 올려 알림장을 게시하고, 학부모가 자기 자녀의 알림장을 읽기까지의 E2E입니다.
// 화면·API·DB·Redis·Celery worker·S3를 실제로 연결하고 외부 AI만 가짜 서버로 바꿉니다.
//
// 첫 흐름은 얼굴이 없는 합성 사진을 씁니다. 얼굴을 식별하지 못한 사진은 외부 LLM 경로에서
// 빠지므로(H-2) AI 초안 대신 교사가 직접 작성해 승인·게시합니다. AI 초안 흐름은 합성 얼굴
// 픽스처가 준비되면 추가합니다(e2e/README.md).
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { syntheticActivityPhoto } from "./fixtures/synthetic-photo.ts";
import { FAKE_LLM_URL, SEED } from "./test-env.ts";

interface Credentials {
  email: string;
  password: string;
}

const NOTE_TEXT = "블록으로 높은 탑을 쌓고 친구에게 보여 주었어요.";

async function login(page: Page, { email, password }: Credentials): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function newSession(browser: Browser, credentials: Credentials): Promise<Page> {
  // 교사와 학부모는 쿠키가 섞이지 않게 브라우저 컨텍스트를 따로 씁니다.
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, credentials);
  return page;
}

async function fakeLlmRequests(request: APIRequestContext): Promise<unknown[]> {
  const response = await request.get(`${FAKE_LLM_URL}/__requests`);
  return (await response.json()) as unknown[];
}

test.beforeEach(async ({ request }) => {
  await request.post(`${FAKE_LLM_URL}/__reset`);
});

test("교사가 게시한 알림장만 그 자녀의 보호자에게 보인다", async ({ browser, request }) => {
  const teacher = await newSession(browser, SEED.teacher);
  const parent = await newSession(browser, SEED.parentOfFirstChild);

  // 1. 반 선택 → 자료 올리기
  await teacher.getByRole("link", { name: SEED.className }).click();
  await expect(teacher).toHaveURL(/\/t\/today$/);
  await teacher.goto("/t/today/upload");
  await teacher.getByLabel("자료 파일 선택").setInputFiles(syntheticActivityPhoto());
  // 업로드 큐는 메모리에만 있어서, 여기부터는 페이지 이동 없이 화면 안에서만 진행합니다.
  await teacher.getByRole("button", { name: "불러오기 완료 후 분류 시작" }).click();

  // 2. 기기 안 얼굴 분석 → 얼굴이 없어 미분류로 떨어진다
  await expect(
    teacher.getByRole("heading", { name: "아이별로 잘 모였는지 확인해 주세요" }),
  ).toBeVisible({ timeout: 120_000 });
  await teacher.getByRole("link", { name: "자료 분류하기 →" }).click();

  // 3. 교사가 직접 아이를 지정해 확정한다
  await expect(
    teacher.getByRole("heading", { name: "아이를 정하지 못한 자료를 확인해 주세요" }),
  ).toBeVisible();
  await teacher.getByRole("checkbox", { name: SEED.firstChildName }).click();
  await teacher.getByRole("button", { name: "선택한 아이에게 연결" }).click();
  await expect(teacher.getByText("미분류 사진을 모두 정리했어요.")).toBeVisible();
  await teacher.getByRole("checkbox", { name: "아이 분류를 확인했어요" }).click();
  await teacher.getByRole("button", { name: "확인한 자료로 계속" }).click();

  // 4. S3 전송 → 생성 작업(Celery). 미식별 얼굴 사진이라 근거 부족으로 끝난다
  await expect(teacher.getByText("처리가 끝났어요. 확인이 필요해요")).toBeVisible({
    timeout: 90_000,
  });
  await expect(
    teacher.getByText(
      "초안을 만들 수 있는 근거가 부족해요. 동의 상태와 사진 분류를 확인해 주세요.",
    ),
  ).toBeVisible();
  // H-2: 얼굴을 식별하지 못한 사진은 외부 LLM으로 한 번도 가지 않는다
  expect(await fakeLlmRequests(request)).toEqual([]);
  await teacher.getByRole("button", { name: "결과 확인하기" }).click();

  // 5. 교사가 직접 작성해 저장한다
  await expect(teacher).toHaveURL(/\/t\/today\/review\/[^/?]+\?record_date=/);
  const childId = new URL(teacher.url()).pathname.split("/").pop()!;
  await teacher.getByRole("textbox", { name: "직접 작성" }).fill(NOTE_TEXT);
  await teacher.getByRole("button", { name: "저장하기" }).click();
  await expect(teacher.getByText(NOTE_TEXT)).toBeVisible();

  // 6. 승인 전: 보호자에게 보이지 않는다
  await parent.goto("/p");
  await expect(parent.getByText("아직 게시된 알림장이 없어요.")).toBeVisible();

  // 7. 승인만 하고 게시하지 않으면 여전히 보이지 않는다
  await teacher.getByRole("checkbox", { name: "사진과 본문을 확인했어요" }).click();
  await teacher.getByRole("button", { name: "검토 완료하고 승인하기" }).click();
  await expect(teacher.getByRole("button", { name: "다시 검토하기" })).toBeVisible();
  await parent.reload();
  await expect(parent.getByText("아직 게시된 알림장이 없어요.")).toBeVisible();

  // 8. 게시
  await teacher.getByRole("button", { name: "게시하기" }).click();
  const dialog = teacher.getByRole("alertdialog");
  await expect(dialog.getByText("학부모님께 알림장을 게시할까요?")).toBeVisible();
  await dialog.getByRole("button", { name: "게시하기" }).click();
  await expect(teacher.getByRole("heading", { name: "오늘의 기록을 전달했어요" })).toBeVisible();

  // 9. 게시 후: 그 자녀의 보호자는 알림장을 읽을 수 있다
  await parent.reload();
  await parent.getByRole("link", { name: new RegExp(NOTE_TEXT) }).click();
  await expect(parent).toHaveURL(new RegExp(`/p/children/${childId}/notes/[^/]+$`));
  await expect(parent.getByRole("heading", { name: /알림장$/ })).toBeVisible();
  await expect(parent.getByText(NOTE_TEXT)).toBeVisible();
  const noteUrl = new URL(parent.url()).pathname;

  // 10. 다른 원아의 보호자는 같은 주소로 열어도 볼 수 없다(H-1)
  // 서버는 남의 알림장이 있는지조차 알려 주지 않으려고 403 대신 404로 답합니다.
  const otherParent = await newSession(browser, SEED.parentOfSecondChild);
  await otherParent.goto(noteUrl);
  await expect(otherParent.getByRole("alert")).toHaveText("알림장을 찾을 수 없습니다.");
  await expect(otherParent.getByText(NOTE_TEXT)).toHaveCount(0);
});
