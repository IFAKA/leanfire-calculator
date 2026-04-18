'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { PlanMonthSnapshot } from '@/lib/fire'

interface Props {
  data: PlanMonthSnapshot[]
}

const fmtK = (v: number) => `€${(v / 1000).toFixed(0)}k`

export default function PlanCompositionChart({ data }: Props) {
  const chartData = data.map((d) => ({
    month: d.month,
    Gold: Math.round(d.assets.goldEur),
    Silver: Math.round(d.assets.silverEur),
    'S&P 500': Math.round(d.assets.sp500Eur),
    'Value (IS3S)': Math.round(d.assets.valueEtfEur),
    'Momentum (IWMO)': Math.round(d.assets.momentumEtfEur),
    'Quality (IWQU)': Math.round(d.assets.qualityEtfEur),
    'Small Cap (IUSN)': Math.round(d.assets.smallCapEtfEur),
  }))

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="month"
            stroke="#6b7280"
            tick={{ fontSize: 11 }}
            label={{ value: 'Plan Month', position: 'insideBottom', offset: -4, fill: '#6b7280', fontSize: 11 }}
          />
          <YAxis
            tickFormatter={fmtK}
            stroke="#6b7280"
            tick={{ fontSize: 11 }}
            width={58}
          />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6 }}
            labelFormatter={(v) => `Month ${v}`}
            formatter={(value, name) => [
              fmtK(Number(value)),
              name,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          
          <Area type="monotone" dataKey="Gold" stackId="1" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.6} />
          <Area type="monotone" dataKey="Silver" stackId="1" stroke="#9ca3af" fill="#9ca3af" fillOpacity={0.6} />
          <Area type="monotone" dataKey="S&P 500" stackId="1" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.6} />
          <Area type="monotone" dataKey="Value (IS3S)" stackId="1" stroke="#34d399" fill="#34d399" fillOpacity={0.6} />
          <Area type="monotone" dataKey="Momentum (IWMO)" stackId="1" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.6} />
          <Area type="monotone" dataKey="Quality (IWQU)" stackId="1" stroke="#f472b6" fill="#f472b6" fillOpacity={0.6} />
          <Area type="monotone" dataKey="Small Cap (IUSN)" stackId="1" stroke="#fb7185" fill="#fb7185" fillOpacity={0.6} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
