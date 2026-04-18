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
} from 'recharts'
import type { TrajectoryPoint } from '@/lib/fire'

interface Props {
  data: TrajectoryPoint[]
  fireNumber: number
  targetAge: number
  citizenshipAge: number
}

const fmtK = (v: number) =>
  v >= 1_000_000
    ? `€${(v / 1_000_000).toFixed(1)}M`
    : `€${(v / 1000).toFixed(0)}k`

export default function PortfolioTrajectoryChart({ data, fireNumber, targetAge, citizenshipAge }: Props) {
  const maxVal = Math.max(...data.map((d) => d.bull), fireNumber) * 1.05

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="age"
            stroke="#6b7280"
            tick={{ fontSize: 11 }}
            label={{ value: 'Age', position: 'insideBottom', offset: -4, fill: '#6b7280', fontSize: 11 }}
          />
          <YAxis
            tickFormatter={fmtK}
            stroke="#6b7280"
            tick={{ fontSize: 11 }}
            domain={[0, maxVal]}
            width={58}
          />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6 }}
            labelFormatter={(v) => `Age ${v}`}
            formatter={(value, name) => [
              fmtK(Number(value)),
              name === 'bear' ? 'Bear (2%)' : name === 'base' ? 'Base (4%)' : 'Bull (6%)',
            ]}
          />
          <Legend
            formatter={(v) =>
              v === 'bear' ? 'Bear 2%' : v === 'base' ? 'Base 4%' : 'Bull 6%'
            }
            wrapperStyle={{ fontSize: 11 }}
          />
          <ReferenceLine y={fireNumber} stroke="#10b981" strokeDasharray="5 3" label={{ value: 'FIRE', fill: '#10b981', fontSize: 10, position: 'insideTopRight' }} />
          <ReferenceLine x={targetAge} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: `Target ${targetAge}`, fill: '#f59e0b', fontSize: 10, position: 'top' }} />
          {citizenshipAge > 0 && (
            <ReferenceLine x={citizenshipAge} stroke="#818cf8" strokeDasharray="3 2" label={{ value: 'CH', fill: '#818cf8', fontSize: 10, position: 'top' }} />
          )}
          <Line type="monotone" dataKey="bear" stroke="#ef4444" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="base" stroke="#60a5fa" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="bull" stroke="#34d399" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
