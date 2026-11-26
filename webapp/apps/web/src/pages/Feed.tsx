import type { FeedItem } from "@devtools/shared";
import { ago } from "../format";
import type { Live } from "../live";
import { S } from "../strings";

function describe(item: FeedItem): string {
  const d = item.data as { passed?: number; failed?: number; subject?: string };
  switch (item.kind) {
    case "session.start":
      return `${S.tools[item.tool]}로 작업을 시작했어요`;
    case "session.end":
      return "작업을 마쳤어요";
    case "test.result": {
      const total = (d.passed ?? 0) + (d.failed ?? 0);
      return `테스트를 돌렸어요 · ${total}개 중 ${d.passed ?? 0}개 통과`;
    }
    case "git.commit":
      return `커밋했어요 · ${d.subject ?? ""}`;
    default:
      return S.activity[item.kind];
  }
}

export function Feed({ live }: { live: Live }) {
  return (
    <>
      <h1>{S.feed.title}</h1>
      <p className="muted">{S.feed.lead}</p>
      {live.feed.length === 0 && <div className="panel empty muted">{S.feed.empty}</div>}
      <ul className="rows feed">
        {live.feed.map((item) => (
          <li key={item.seq} className="row">
            <span className="av">{item.memberName.slice(0, 1)}</span>
            <span className="grow">
              <b>{item.memberName}</b> {describe(item)}
              <br />
              <span className="muted small">
                {ago(item.at, live.now)} · {S.tools[item.tool]}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
