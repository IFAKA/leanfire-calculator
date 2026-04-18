'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
  ReferenceArea,
} from 'recharts'
import type { SensitivityPoint } from '@/lib/fire'

interface Props {
  data: SensitivityPoint[]
  currentGrossUsd: number
  targetAge: number
}

export default function SensitivityChart({ data, currentGrossUsd, targetAge }: Props) {
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="grossUsd"
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            stroke="#6b7280"
            tick={{ fontSize: 11 }}
            label={{ value: 'Monthly gross (USD)', position: 'insideBottom', offset: -4, fill: '#6b7280', fontSize: 11 }}
          />
          <YAxis
            domain={[25, 55]}
            stroke="#6b7280"
            tick={{ fontSize: 11 }}
            label={{ value: 'Retirement age', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6 }}
            labelFormatter={(v) => `$${Number(v).toLocaleString()}/mo gross`}
            formatter={(value, name) => [
              `Age ${value}`,
              name === 'retirementAgeBear' ? 'Bear (2%)' : name === 'retirementAgeBase' ? 'Base (4%)' : 'Bull (6%)',
            ]}
          />
          <Legend
            formatter={(v) =>
              v === 'retirementAgeBear' ? 'Bear 2%' : v === 'retirementAgeBase' ? 'Base 4%' : 'Bull 6%'
            }
            wrapperStyle={{ fontSize: 11 }}
          />
          {/* Target age band */}
          <ReferenceArea y1={targetAge - 0.5} y2={targetAge + 5} fill="#065f46" fillOpacity={0.15} />
          <ReferenceLine y={targetAge} stroke="#10b981" strokeDasharray="4 2" label={{ value: `Target ${targetAge}`, fill: '#10b981', fontSize: 10 }} />
          <ReferenceLine x={currentGrossUsd} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: 'Now', fill: '#f59e0b', fontSize: 10, position: 'top' }} />
          <Line type="monotone" dataKey="retirementAgeBear" stroke="#ef4444" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="retirementAgeBase" stroke="#60a5fa" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="retirementAgeBull" stroke="#34d399" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
