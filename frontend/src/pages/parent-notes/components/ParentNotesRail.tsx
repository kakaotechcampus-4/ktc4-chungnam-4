import { ChevronDown, Images } from "lucide-react";
import { Link } from "react-router";

import type { ParentNoteListView } from "@/api/documents";
import type { MyChildView } from "@/api/organization";
import { NameAvatar } from "@/components/common/NameAvatar";
import { Button } from "@/components/ui/button";
import { ChildSwitcher } from "@/features/parent/ChildSwitcher";
import { givenName } from "@/lib/child-name";
import { staggerStyle } from "@/lib/motion";

interface ParentNotesRailProps {
  child: MyChildView;
  /** 연결된 자녀 전부. 둘 이상이면 다른 아이 보기를 보여 줍니다. */
  childList: MyChildView[];
  /** 받기 전이거나 받지 못했으면 비웁니다. 나머지 칸은 그래도 보여 줍니다. */
  list: ParentNoteListView | undefined;
}

const RAIL_CARD_CLASS = "rounded-3xl border border-line/70 bg-paper shadow-card";

// 학부모 목록 오른쪽 칸(Figma W3의 프로필 · 이번 달). 스크롤해도 따라옵니다.
// 좁은 화면에서는 목록 아래로 내려옵니다.
// 카드는 목록 카드와 같은 박자로 떠오릅니다. 이번 달 칸은 알림장을 받은 뒤에 생기므로 그때 따로 올라옵니다.
export function ParentNotesRail({ child, childList, list }: ParentNotesRailProps) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 lg:sticky lg:top-24 lg:w-rail">
      <section
        className={`${RAIL_CARD_CLASS} flex flex-col items-center gap-4 p-6 text-center motion-safe:animate-rise`}
        style={staggerStyle(1)}
      >
        <NameAvatar name={givenName(child.name)} className="size-16 text-h3" />
        <div className="flex flex-col">
          <p className="text-lead font-bold text-ink">{givenName(child.name)}</p>
          <p className="text-label text-ink-muted">
            {child.class_name} · {child.age_group}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2">
          {childList.length > 1 ? (
            <ChildSwitcher
              items={childList}
              currentId={child.child_id}
              align="center"
              trigger={
                <Button variant="outline" size="sm" className="group w-full active:scale-98">
                  다른 아이 보기
                  <ChevronDown
                    aria-hidden="true"
                    className="transition-transform duration-300 ease-soft group-data-[state=open]:rotate-180"
                  />
                </Button>
              }
            />
          ) : null}
          {/* 모아 보기(FR-10)로 들어가는 길. 주소를 직접 입력하지 않아도 열립니다. */}
          <Button asChild size="sm" className="w-full active:scale-98">
            <Link viewTransition to={`/p/children/${child.child_id}/media`}>
              <Images aria-hidden="true" />
              사진·영상 모아 보기
            </Link>
          </Button>
        </div>
      </section>
      {list ? (
        <section
          aria-labelledby="note-counts"
          className={`${RAIL_CARD_CLASS} p-6 motion-safe:animate-rise`}
          style={staggerStyle(2)}
        >
          <h2 id="note-counts" className="text-body font-bold text-ink">
            이번 달
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div className="flex flex-col-reverse">
              <dt className="text-caption text-ink-muted">받은 알림장</dt>
              <dd className="text-h2 font-bold text-brand-ink tabular-nums">
                {list.this_month_count}
              </dd>
            </div>
            <div className="flex flex-col-reverse">
              <dt className="text-caption text-ink-muted">안 읽음</dt>
              <dd className="text-h2 font-bold text-brand-ink tabular-nums">{list.unread_count}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </aside>
  );
}
