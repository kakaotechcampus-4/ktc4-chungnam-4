import { NURI_DOMAIN_LABEL_MAP, NURI_DOMAINS } from "@/features/organization/labels";
import type { NuriDomainView } from "@/api/organization";

interface NuriRadarChartProps {
  counts: Record<NuriDomainView, number>;
}

// Figma 1:770(330 × 280) 크기의 5각 레이더 차트입니다. 패키지 없이 SVG로 그립니다.
// 꼭짓점은 위에서 시작해 시계 방향으로 NURI_DOMAINS 순서입니다. 바깥 테두리가 가장 많은 영역의 수입니다.
const WIDTH = 330;
const HEIGHT = 280;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const RADIUS = 110;
const LEVELS = [0.25, 0.5, 0.75, 1];

function point(index: number, ratio: number) {
  const angle = -Math.PI / 2 + (2 * Math.PI * index) / NURI_DOMAINS.length;
  return {
    x: CENTER_X + Math.cos(angle) * RADIUS * ratio,
    y: CENTER_Y + Math.sin(angle) * RADIUS * ratio,
  };
}

function polygon(ratios: readonly number[]) {
  return ratios
    .map((ratio, index) => {
      const { x, y } = point(index, ratio);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function NuriRadarChart({ counts }: NuriRadarChartProps) {
  const max = Math.max(1, ...NURI_DOMAINS.map((domain) => counts[domain]));
  const ratios = NURI_DOMAINS.map((domain) => counts[domain] / max);
  const label = NURI_DOMAINS.map(
    (domain) => `${NURI_DOMAIN_LABEL_MAP[domain]} ${counts[domain]}건`,
  ).join(", ");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-70 w-82.5"
      role="img"
      aria-label={`누리과정 5영역 기록 수: ${label}`}
    >
      {LEVELS.map((level) => (
        <polygon
          key={level}
          points={polygon(NURI_DOMAINS.map(() => level))}
          className="fill-none stroke-line"
        />
      ))}
      {NURI_DOMAINS.map((domain, index) => {
        const { x, y } = point(index, 1);
        return (
          <line key={domain} x1={CENTER_X} y1={CENTER_Y} x2={x} y2={y} className="stroke-line" />
        );
      })}
      <polygon points={polygon(ratios)} className="fill-neutral-soft stroke-ink-muted" />
      {ratios.map((ratio, index) => {
        const { x, y } = point(index, ratio);
        return <circle key={NURI_DOMAINS[index]} cx={x} cy={y} r={4} className="fill-ink" />;
      })}
    </svg>
  );
}
