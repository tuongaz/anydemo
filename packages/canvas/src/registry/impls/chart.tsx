import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface ChartSeries {
  key: string;
  label?: string;
}

interface ChartProps {
  kind?: 'bar' | 'line' | 'area' | 'pie';
  data?: Array<Record<string, unknown>>;
  xKey?: string;
  series?: ChartSeries[];
}

const PALETTE = [
  'var(--sf-chart-1, #6366f1)',
  'var(--sf-chart-2, #22c55e)',
  'var(--sf-chart-3, #f59e0b)',
  'var(--sf-chart-4, #ef4444)',
  'var(--sf-chart-5, #06b6d4)',
];

function colorAt(idx: number): string {
  return PALETTE[idx % PALETTE.length] ?? '#6366f1';
}

export default function Chart({ kind = 'bar', data = [], xKey = 'name', series = [] }: ChartProps) {
  if (kind === 'pie') {
    const valueKey = series[0]?.key ?? 'value';
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip />
          <Pie data={data} dataKey={valueKey} nameKey={xKey} outerRadius="80%">
            {data.map((_, idx) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: pie slices have no stable id
              <Cell key={idx} fill={colorAt(idx)} />
            ))}
          </Pie>
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (kind === 'line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          <Legend />
          {series.map((s, idx) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label ?? s.key}
              stroke={colorAt(idx)}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (kind === 'area') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          <Legend />
          {series.map((s, idx) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label ?? s.key}
              stroke={colorAt(idx)}
              fill={colorAt(idx)}
              fillOpacity={0.2}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip />
        <Legend />
        {series.map((s, idx) => (
          <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={colorAt(idx)} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
