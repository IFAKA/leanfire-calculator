'use client'

import { useState, useEffect, useMemo, useId } from 'react'
import dynamic from 'next/dynamic'
import { calcTax, grossNeededForNet } from '@/lib/tax'
import {
  retirementAgeForScenario,
  calcSensitivity,
  swrForHorizon,
  solveForPMT,
  RETURN_RATES,
  type SensitivityPoint,
} from '@/lib/fire'
import { fetchUsdToEur, usdToEur } from '@/lib/fx'

const SensitivityChart = dynamic(() => import('@/components/SensitivityChart'), { ssr: false })

// ─── helpers ───────────────────────────────────────────────────────────────
const fmt = (n: number, dec = 0) =>
  n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })

const fmtEur = (n: number, dec = 0) => `€${fmt(n, dec)}`
const fmtUsd = (n: number, dec = 0) => `$${fmt(n, dec)}`

function NumInput({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step = 1,
  min = 0,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  prefix?: string
  suffix?: string
  step?: number
  min?: number
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-gray-400">{label}</label>
      <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 focus-within:border-gray-500 transition-[border-color]">
        {prefix && <span className="text-gray-500 text-sm" aria-hidden>{prefix}</span>}
        <input
          id={id}
          type="number"
          value={value}
          step={step}
          min={min}
          onChange={(e) => onChange(Number(e.target.value))}
          className="bg-transparent text-white text-sm w-full outline-none tabular min-w-0"
        />
        {suffix && <span className="text-gray-500 text-sm" aria-hidden>{suffix}</span>}
      </div>
    </div>
  )
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden card-shadow">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-800/60 text-sm font-medium text-gray-200 hover:bg-gray-700/60 transition-[background-color]"
      >
        <span>{title}</span>
        <span className="text-gray-500 text-xs" aria-hidden>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-4 py-3 grid grid-cols-2 gap-3">{children}</div>}
    </div>
  )
}

// ─── main ──────────────────────────────────────────────────────────────────
export default function Home() {
  // FX
  const [fxRate, setFxRate] = useState(0.92)
  const [fxManual, setFxManual] = useState(false)

  useEffect(() => {
    if (!fxManual) {
      fetchUsdToEur().then(setFxRate)
    }
  }, [fxManual])

  // Current state
  const [currentAge, setCurrentAge] = useState(25)
  const [targetAge, setTargetAge] = useState(30)
  const [lifeExpectancy, setLifeExpectancy] = useState(90)
  const [portfolioEur, setPortfolioEur] = useState(8000)

  // Income
  const [grossUsd, setGrossUsd] = useState(3700)
  const [postCitizenshipGrossUsd, setPostCitizenshipGrossUsd] = useState(6000)
  const citizenshipDate = useMemo(() => new Date(2026, 9, 1), []) // Oct 2026

  // Expenses (EUR/month)
  const [rent, setRent] = useState(600)
  const [foodUtils, setFoodUtils] = useState(400)
  const [familySupport, setFamilySupport] = useState(300)
  const [tithePercent, setTithePercent] = useState(10)
  const [discretionary, setDiscretionary] = useState(200)
  const [annualIrregular, setAnnualIrregular] = useState(1200) // per year
  const [deductibleExpenses, setDeductibleExpenses] = useState(1200) // per year

  // Tax flags
  const [isFirstYear, setIsFirstYear] = useState(false)
  const [isSecondYear, setIsSecondYear] = useState(false)

  // Return scenario
  const [scenario, setScenario] = useState<'bear' | 'base' | 'bull'>('base')

  // ─── derived: tax + net income ───────────────────────────────────────────
  const taxResult = useMemo(() => {
    const grossEurAnnual = usdToEur(grossUsd * 12, fxRate)
    return calcTax({ grossAnnualEur: grossEurAnnual, deductibleExpenses, isFirstYear, isSecondYear })
  }, [grossUsd, fxRate, deductibleExpenses, isFirstYear, isSecondYear])

  const netMonthlyEur = taxResult.netMonthly

  const titheMonthly = useMemo(() => netMonthlyEur * (tithePercent / 100), [netMonthlyEur, tithePercent])

  const totalFixedExpenses = useMemo(
    () => rent + foodUtils + familySupport + titheMonthly + discretionary + annualIrregular / 12,
    [rent, foodUtils, familySupport, titheMonthly, discretionary, annualIrregular]
  )

  const monthlySavings = useMemo(
    () => netMonthlyEur - totalFixedExpenses,
    [netMonthlyEur, totalFixedExpenses]
  )

  // Post-citizenship savings
  const postCitizenshipTax = useMemo(() => {
    const grossEurAnnual = usdToEur(postCitizenshipGrossUsd * 12, fxRate)
    return calcTax({ grossAnnualEur: grossEurAnnual, deductibleExpenses, isFirstYear: false, isSecondYear: false })
  }, [postCitizenshipGrossUsd, fxRate, deductibleExpenses])

  const postCitizenshipNet = postCitizenshipTax.netMonthly
  const postCitizenshipTithe = postCitizenshipNet * (tithePercent / 100)
  const postCitizenshipSavings = useMemo(
    () => postCitizenshipNet - rent - foodUtils - familySupport - postCitizenshipTithe - discretionary - annualIrregular / 12,
    [postCitizenshipNet, rent, foodUtils, familySupport, postCitizenshipTithe, discretionary, annualIrregular]
  )

  // ─── FIRE number + gap ───────────────────────────────────────────────────
  const annualExpenses = useMemo(() => totalFixedExpenses * 12, [totalFixedExpenses])
  const retirementHorizon = lifeExpectancy - targetAge
  const swr = swrForHorizon(retirementHorizon)
  const fireNumber = annualExpenses / swr

  // Floor: non-negotiable at retirement (family + essentials, no discretionary)
  const floorMonthly = rent + foodUtils + familySupport + titheMonthly
  const floorAnnual = floorMonthly * 12
  const floorFireNumber = floorAnnual / swr

  // Retirement ages all 3 scenarios
  const retirementAges = useMemo(() => ({
    bear: retirementAgeForScenario(currentAge, portfolioEur, annualExpenses, lifeExpectancy, monthlySavings, postCitizenshipSavings, citizenshipDate, 'bear'),
    base: retirementAgeForScenario(currentAge, portfolioEur, annualExpenses, lifeExpectancy, monthlySavings, postCitizenshipSavings, citizenshipDate, 'base'),
    bull: retirementAgeForScenario(currentAge, portfolioEur, annualExpenses, lifeExpectancy, monthlySavings, postCitizenshipSavings, citizenshipDate, 'bull'),
  }), [currentAge, portfolioEur, annualExpenses, lifeExpectancy, monthlySavings, postCitizenshipSavings, citizenshipDate])

  const currentRetirementAge = retirementAges[scenario]
  const gapYears = +(currentRetirementAge - targetAge).toFixed(1)

  // PMT needed to hit target age
  const monthsToTarget = Math.max(0, (targetAge - currentAge) * 12)
  const pmt = solveForPMT(fireNumber, portfolioEur, RETURN_RATES[scenario], monthsToTarget)

  // Gross income needed to fund required PMT
  const requiredNetMonthly = pmt + totalFixedExpenses
  const requiredGrossEur = grossNeededForNet(requiredNetMonthly, deductibleExpenses, isFirstYear, isSecondYear)
  const requiredGrossUsd = fxRate > 0 ? requiredGrossEur / 12 / fxRate : 0

  // ─── Sensitivity chart data ───────────────────────────────────────────────
  const sensitivityData = useMemo<SensitivityPoint[]>(() => {
    const buildSavings = (g: number) => {
      const gEurAnnual = usdToEur(g * 12, fxRate)
      const t = calcTax({ grossAnnualEur: gEurAnnual, deductibleExpenses, isFirstYear, isSecondYear })
      const tithe = t.netMonthly * (tithePercent / 100)
      return t.netMonthly - rent - foodUtils - familySupport - tithe - discretionary - annualIrregular / 12
    }
    const postMultiplier = grossUsd > 0 ? postCitizenshipGrossUsd / grossUsd : 1

    return calcSensitivity(
      currentAge,
      portfolioEur,
      annualExpenses,
      lifeExpectancy,
      buildSavings,
      citizenshipDate,
      postMultiplier,
      [1000, 12000],
    )
  }, [currentAge, portfolioEur, annualExpenses, lifeExpectancy, fxRate, deductibleExpenses, isFirstYear, isSecondYear, tithePercent, rent, foodUtils, familySupport, discretionary, annualIrregular, grossUsd, postCitizenshipGrossUsd, citizenshipDate])

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">LeanFIRE Calculator</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Quant-correct model · SWR adjusted for 60yr horizon · Spain autónomo tax · USD/EUR dual-currency
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ─── LEFT: INPUTS ─────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            <Section title="Current state">
              <NumInput label="Current age" value={currentAge} onChange={setCurrentAge} suffix="yrs" />
              <NumInput label="Target retirement age" value={targetAge} onChange={setTargetAge} suffix="yrs" />
              <NumInput label="Life expectancy" value={lifeExpectancy} onChange={setLifeExpectancy} suffix="yrs" />
              <NumInput label="Portfolio (EUR)" value={portfolioEur} onChange={setPortfolioEur} prefix="€" step={500} />
            </Section>

            <Section title="Income (USD)">
              <NumInput label="Monthly gross (now)" value={grossUsd} onChange={setGrossUsd} prefix="$" step={100} />
              <NumInput label="Monthly gross (post-citizenship)" value={postCitizenshipGrossUsd} onChange={setPostCitizenshipGrossUsd} prefix="$" step={100} />
              <div className="flex flex-col gap-1 col-span-2">
                <label htmlFor="fx-rate" className="text-xs text-gray-400">USD/EUR Rate</label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 flex-1 focus-within:border-gray-500 transition-[border-color]">
                    <input
                      id="fx-rate"
                      type="number"
                      value={fxRate}
                      step={0.01}
                      onChange={(e) => { setFxManual(true); setFxRate(Number(e.target.value)) }}
                      className="bg-transparent text-white text-sm w-full outline-none tabular"
                    />
                  </div>
                  <button
                    onClick={() => { setFxManual(false); fetchUsdToEur().then(setFxRate) }}
                    className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1.5 border border-gray-700 rounded transition-[color]"
                  >
                    Refresh Rate
                  </button>
                </div>
                <p className="text-xs text-gray-600">Citizenship inflection: Oct 2026</p>
              </div>
            </Section>

            <Section title="Monthly expenses (EUR)">
              <NumInput label="Rent" value={rent} onChange={setRent} prefix="€" />
              <NumInput label="Food + utilities" value={foodUtils} onChange={setFoodUtils} prefix="€" />
              <NumInput label="Family support (Rosario)" value={familySupport} onChange={setFamilySupport} prefix="€" />
              <NumInput label="Tithe" value={tithePercent} onChange={setTithePercent} suffix="% of net" step={1} />
              <NumInput label="Discretionary" value={discretionary} onChange={setDiscretionary} prefix="€" />
              <NumInput label="Annual irregular (÷12)" value={annualIrregular} onChange={setAnnualIrregular} prefix="€/yr" step={100} />
            </Section>

            <Section title="Tax & assumptions" defaultOpen={false}>
              <NumInput label="Deductible expenses/yr" value={deductibleExpenses} onChange={setDeductibleExpenses} prefix="€/yr" step={100} />
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">Autónomo year</label>
                <div className="flex gap-2">
                  {(['Normal', '1st yr', '2nd yr'] as const).map((label) => {
                    const active = label === '1st yr' ? isFirstYear : label === '2nd yr' ? isSecondYear : !isFirstYear && !isSecondYear
                    return (
                      <button
                        key={label}
                        onClick={() => {
                          setIsFirstYear(label === '1st yr')
                          setIsSecondYear(label === '2nd yr')
                        }}
                        className={`text-xs px-2 py-1 rounded border ${active ? 'border-blue-500 text-blue-300 bg-blue-950' : 'border-gray-700 text-gray-400'}`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </Section>
          </div>

          {/* ─── RIGHT: RESULTS ───────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            {/* Primary result */}
            <div className="border border-gray-700 rounded-lg p-5 bg-gray-900/60 card-shadow">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">You retire at</p>
                  <p className="text-5xl font-bold text-white mt-1 tabular">
                    {currentRetirementAge > currentAge + 55 ? '55+' : currentRetirementAge}
                    <span className="text-lg text-gray-400 ml-1">yrs</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">vs target {targetAge}</p>
                  <p className={`text-2xl font-semibold mt-1 tabular ${gapYears > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {gapYears > 0 ? `+${gapYears}` : gapYears} yrs
                  </p>
                </div>
              </div>

              {/* Scenario selector */}
              <div className="flex gap-2 mb-4">
                {(['bear', 'base', 'bull'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScenario(s)}
                    aria-pressed={scenario === s}
                    className={`flex-1 text-xs py-1.5 rounded border transition-[border-color,background-color,color] ${
                      scenario === s
                        ? s === 'bear' ? 'border-red-500 text-red-300 bg-red-950' :
                          s === 'base' ? 'border-blue-500 text-blue-300 bg-blue-950' :
                          'border-emerald-500 text-emerald-300 bg-emerald-950'
                        : 'border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {s === 'bear' ? 'Bear 2%' : s === 'base' ? 'Base 4%' : 'Bull 6%'}
                  </button>
                ))}
              </div>

              {/* All 3 scenarios */}
              <div className="grid grid-cols-3 gap-2 text-center border border-gray-800 rounded p-2 bg-gray-950/50">
                <div>
                  <p className="text-xs text-red-400">Bear 2%</p>
                  <p className="text-sm font-medium text-white">{retirementAges.bear > currentAge + 55 ? '55+' : retirementAges.bear}</p>
                </div>
                <div>
                  <p className="text-xs text-blue-400">Base 4%</p>
                  <p className="text-sm font-medium text-white">{retirementAges.base > currentAge + 55 ? '55+' : retirementAges.base}</p>
                </div>
                <div>
                  <p className="text-xs text-emerald-400">Bull 6%</p>
                  <p className="text-sm font-medium text-white">{retirementAges.bull > currentAge + 55 ? '55+' : retirementAges.bull}</p>
                </div>
              </div>
            </div>

            {/* Income lever */}
            <div className="border border-amber-900/50 rounded-lg p-4 bg-amber-950/20 card-shadow">
              <p className="text-xs text-amber-400 uppercase tracking-wide mb-3">Income lever — to hit age {targetAge}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500">Required Monthly Savings</p>
                  <p className="text-lg font-semibold text-white tabular">{pmt > 0 ? fmtEur(pmt) : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Required Gross Income</p>
                  <p className="text-lg font-semibold text-amber-300 tabular">{fmtUsd(requiredGrossUsd)}/mo</p>
                  <p className="text-xs text-gray-600 tabular">{fmtEur(requiredGrossEur / 12)}/mo gross EUR</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Current Monthly Savings</p>
                  <p className={`text-lg font-semibold tabular ${monthlySavings < 0 ? 'text-red-400' : 'text-white'}`}>
                    {fmtEur(monthlySavings)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Savings Gap</p>
                  <p className={`text-lg font-semibold tabular ${pmt - monthlySavings > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {pmt > 0 ? fmtEur(pmt - monthlySavings) : '—'}/mo
                  </p>
                </div>
              </div>
            </div>

            {/* FIRE breakdown */}
            <div className="border border-gray-700 rounded-lg p-4 bg-gray-900/40">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">FIRE breakdown ({scenario})</p>
              <div className="space-y-1.5 text-sm">
                {[
                  ['FIRE number', fmtEur(fireNumber)],
                  [`SWR (${retirementHorizon}yr horizon)`, `${(swr * 100).toFixed(2)}%`],
                  ['Current portfolio', fmtEur(portfolioEur)],
                  ['Annual expenses', fmtEur(annualExpenses)],
                  ['Floor obligation/yr', fmtEur(floorAnnual)],
                  ['Floor FIRE number', fmtEur(floorFireNumber)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-gray-500">{label}</span>
                    <span className="text-gray-200 font-medium tabular">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tax breakdown */}
            <div className="border border-gray-700 rounded-lg p-4 bg-gray-900/40">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Tax Breakdown (Current Income)</p>
              <div className="space-y-1.5 text-sm">
                {[
                  ['Gross Income', fmtEur(taxResult.grossAnnual / 12) + '/mo'],
                  ['IRPF', fmtEur(taxResult.irpfAnnual / 12) + '/mo'],
                  ['Cuota Autónomos', fmtEur(taxResult.cuotaAnnual / 12) + '/mo'],
                  ['Net Take-Home', fmtEur(taxResult.netMonthly) + '/mo'],
                  ['Effective Rate', `${(taxResult.effectiveRate * 100).toFixed(1)}%`],
                  ['Tithe', fmtEur(titheMonthly) + '/mo'],
                  ['Total Expenses', fmtEur(totalFixedExpenses) + '/mo'],
                  ['Net Savings', fmtEur(monthlySavings) + '/mo'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-gray-500">{label}</span>
                    <span className={`font-medium tabular ${label === 'Net Savings' && monthlySavings < 0 ? 'text-red-400' : 'text-gray-200'}`}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Floor note */}
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-950/50 text-xs text-gray-500">
              <span className="text-gray-400 font-medium">Withdrawal strategy: </span>
              Floor-and-upside hybrid. Your non-negotiable floor is{' '}
              <span className="text-white">{fmtEur(floorMonthly)}/mo</span> (rent + food + family + tithe).
              Portfolio covers floor at {(swr * 100).toFixed(2)}% SWR → needs{' '}
              <span className="text-white">{fmtEur(floorFireNumber)}</span>. Everything above covers discretionary.
            </div>
          </div>
        </div>

        {/* Sensitivity chart — full width */}
        <div className="mt-6 border border-gray-700 rounded-lg p-4 bg-gray-900/40">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-4">Sensitivity: income → retirement age (all scenarios)</p>
          <SensitivityChart
            data={sensitivityData}
            currentGrossUsd={grossUsd}
            targetAge={targetAge}
          />
          <p className="text-xs text-gray-600 mt-2 text-center">
            Green band = target ± 5 yrs · Yellow line = current income · Post-citizenship income scales proportionally
          </p>
        </div>
      </div>
    </div>
  )
}
