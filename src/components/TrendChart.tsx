import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface TrendChartProps {
  data: Record<string, unknown>[];
  lines: { key: string; label: string; color: string }[];
  formatter?: (value: number) => string;
  threshold?: number;
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(value));
}

export function TrendChart({ data, lines, formatter = (value) => value.toFixed(1), threshold }: TrendChartProps) {
  return (
    <div className="trend-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 14, bottom: 2, left: -16 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="timestamp" tickFormatter={timeLabel} minTickGap={42} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(value: number) => formatter(value)} tick={{ fontSize: 11 }} width={64} />
          <Tooltip labelFormatter={timeLabel} formatter={(value, name) => [formatter(Number(value)), name]} />
          {threshold !== undefined && <ReferenceLine y={threshold} stroke="var(--danger)" strokeDasharray="4 4" />}
          {lines.map((line) => (
            <Line key={line.key} type="monotone" dataKey={line.key} name={line.label} stroke={line.color} dot={false} strokeWidth={2} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}