import { http, HttpResponse } from "msw";

import type {
  Notice,
  NoticeCreateRequest,
  NoticeUpdateRequest,
  ParentNotice,
} from "@/types/api-draft/notice";

import { TEACHER_ME } from "../fixtures/auth";
import { fixtureId } from "../fixtures/ids";
import { SUNSHINE_NOTICES } from "../fixtures/notice";
import { PARENT_OF_CHILD, SUNSHINE_CLASS } from "../fixtures/organization";
import { MOCK_PARENT_ID, requireParent, requireTeacher, requireTeacherOfClass } from "../guards";
import { apiPath, errorResponse, listResponse, validationError } from "../http";
import { isMockScenario } from "../scenario";

// API 문서 §notice 목입니다. 시나리오: notice.empty(공지 없음)
// 교사 API는 담당 반(햇살반)만, 학부모 API는 자기 자녀의 반 공지만 받습니다(자녀 반이 아니면 404).
// 쓰기 요청은 탭을 새로 고칠 때까지 메모리에 남습니다. 교사가 등록한 공지가 학부모 화면에도 보입니다.

let notices: Notice[] = [...SUNSHINE_NOTICES];
let serial = 100;

const PAGE_SIZE_MAX = 100;
const noticeNotFound = () => errorResponse(404, "NOTICE_NOT_FOUND", "공지를 찾을 수 없어요.");
const byNewest = (a: Notice, b: Notice) => b.created_at.localeCompare(a.created_at);

function guardNotice(noticeId: unknown): { denied: Response } | { notice: Notice } {
  const denied = requireTeacher();
  if (denied) return { denied };
  const notice = notices.find((item) => item.notice_id === noticeId);
  if (!notice) return { denied: noticeNotFound() };
  const notMine = requireTeacherOfClass(notice.class_id);
  return notMine ? { denied: notMine } : { notice };
}

/** 학부모이고 자기 자녀인지. 통과하면 null입니다(알림장 목과 같은 판정) */
function guardOwnChild(childId: unknown): Response | null {
  const denied = requireParent();
  if (denied) return denied;
  if (PARENT_OF_CHILD[String(childId)] !== MOCK_PARENT_ID) {
    return errorResponse(403, "CHILD_ACCESS_DENIED", "이 아이의 공지는 볼 수 없어요.");
  }
  return null;
}

function toParentNotice(notice: Notice): ParentNotice {
  return {
    notice_id: notice.notice_id,
    title: notice.title,
    content: notice.content,
    created_at: notice.created_at,
    updated_at: notice.updated_at,
  };
}

/** 커서는 건너뛸 개수입니다. 읽을 수 없으면 null */
function readPage(request: Request): { offset: number; limit: number } | null {
  const query = new URL(request.url).searchParams;
  const cursor = query.get("cursor");
  const offset = cursor === null ? 0 : Number(cursor);
  const limit = Number(query.get("limit") ?? 20);
  if (!Number.isInteger(offset) || offset < 0) return null;
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE_MAX) return null;
  return { offset, limit };
}

function pageOf<T>(all: T[], page: { offset: number; limit: number }): Response {
  const end = page.offset + page.limit;
  return listResponse(all.slice(page.offset, end), end < all.length ? String(end) : null);
}

const invalidCursor = () =>
  errorResponse(400, "INVALID_CURSOR", "목록을 이어서 불러오지 못했어요.");

function validTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 100;
}
function validContent(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 5000;
}

export const handlers = [
  http.get(apiPath("/classes/:classId/notices"), ({ params, request }) => {
    const denied = requireTeacherOfClass(params.classId);
    if (denied) return denied;
    const page = readPage(request);
    if (!page) return invalidCursor();
    if (isMockScenario("notice.empty")) return listResponse<Notice>([]);
    return pageOf(notices.filter((item) => item.class_id === params.classId).sort(byNewest), page);
  }),
  http.post(apiPath("/classes/:classId/notices"), async ({ params, request }) => {
    const denied = requireTeacherOfClass(params.classId);
    if (denied) return denied;
    const body = (await request.json()) as Partial<NoticeCreateRequest>;
    if (!validTitle(body.title)) return validationError("body.title", "제목을 확인해 주세요");
    if (!validContent(body.content)) return validationError("body.content", "내용을 확인해 주세요");
    const now = new Date().toISOString();
    const created: Notice = {
      notice_id: fixtureId("notice", serial++),
      class_id: String(params.classId),
      author_teacher_id: TEACHER_ME.teacher_id,
      title: body.title.trim(),
      content: body.content.trim(),
      created_at: now,
      updated_at: now,
    };
    notices = [...notices, created];
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get(apiPath("/notices/:noticeId"), ({ params }) => {
    const found = guardNotice(params.noticeId);
    return "denied" in found ? found.denied : HttpResponse.json(found.notice);
  }),
  http.patch(apiPath("/notices/:noticeId"), async ({ params, request }) => {
    const found = guardNotice(params.noticeId);
    if ("denied" in found) return found.denied;
    const body = (await request.json()) as NoticeUpdateRequest;
    if (body.title === undefined && body.content === undefined) {
      return validationError("body", "수정할 값을 보내 주세요");
    }
    if (body.title !== undefined && !validTitle(body.title)) {
      return validationError("body.title", "제목을 확인해 주세요");
    }
    if (body.content !== undefined && !validContent(body.content)) {
      return validationError("body.content", "내용을 확인해 주세요");
    }
    const updated: Notice = {
      ...found.notice,
      title: body.title?.trim() ?? found.notice.title,
      content: body.content?.trim() ?? found.notice.content,
      updated_at: new Date().toISOString(),
    };
    notices = notices.map((item) => (item.notice_id === updated.notice_id ? updated : item));
    return HttpResponse.json(updated);
  }),
  http.delete(apiPath("/notices/:noticeId"), ({ params }) => {
    const found = guardNotice(params.noticeId);
    if ("denied" in found) return found.denied;
    notices = notices.filter((item) => item.notice_id !== found.notice.notice_id);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── 학부모용 ── 교사 전용 필드(작성 교사)가 없는 별도 스키마입니다.
  http.get(apiPath("/children/:childId/notices"), ({ params, request }) => {
    const denied = guardOwnChild(params.childId);
    if (denied) return denied;
    const page = readPage(request);
    if (!page) return invalidCursor();
    if (isMockScenario("notice.empty")) return listResponse<ParentNotice>([]);
    return pageOf(
      notices
        .filter((item) => item.class_id === SUNSHINE_CLASS.class_id)
        .sort(byNewest)
        .map(toParentNotice),
      page,
    );
  }),
  http.get(apiPath("/children/:childId/notices/:noticeId"), ({ params }) => {
    const denied = guardOwnChild(params.childId);
    if (denied) return denied;
    // 자녀 반의 공지가 아니면 없는 것과 구분하지 않습니다.
    const notice = notices.find(
      (item) => item.notice_id === params.noticeId && item.class_id === SUNSHINE_CLASS.class_id,
    );
    return notice ? HttpResponse.json(toParentNotice(notice)) : noticeNotFound();
  }),
];
