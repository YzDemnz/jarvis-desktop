import { useId } from 'react';
import { areaPath, sparkPath } from '@/lib/format';

interface Props {
  values: number[];
  width?: number;
  height?: number;
  color: string;
  fill?: boolean;
  strokeWidth?: number;
}

export function Sparkline({ values, width = 84, height = 26, color, fill = false, strokeWidth = 1.2 }: Props) {
  const id = useId();
  if (values.length < 2) return <svg width={width} height={height} />;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath(values, width, height)} fill={`url(#${id})`} />
        </>
      )}
      <path d={sparkPath(values, width, height)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
