'use client'

import { useState, useEffect, useMemo, useId, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { calcTax, calcTaxCH, grossNeededForNetCH } from '@/lib/tax'
import {
  retirementAgeForScenarioWithPlan,
  calcSensitivity,
  calcPortfolioTrajectoryWithPlan,
  simulate36MonthPlan,
  swrForHorizon,
  solveForPMT,
  RETURN_RATES,
  type PlanAssets,
  type SensitivityPoint,
  type TrajectoryPoint,
} from '@/lib/fire'
import { fetchUsdToEur, usdToEur } from '@/lib/fx'

const SensitivityChart = dynamic(() => import('@/components/SensitivityChart'), { ssr: false })
const PortfolioTrajectoryChart = dynamic(() => import('@/components/PortfolioTrajectoryChart'), { ssr: false })
const PlanCompositionChart = dynamic(() => import('@/components/PlanCompositionChart'), { ssr: false })

// ─── helpers ───────────────────────────────────────────────────────────────
const fmt = (n: number, dec = 0) =>
  n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })

const fmtEur = (n: number, dec = 0) => `€${fmt(n, dec)}`
const fmtUsd = (n: number, dec = 0) => `$${fmt(n, dec)}`

function useLS<T>(key: string, init: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [val, setValInner] = useState<T>(() => {
    if (typeof window === 'undefined') return init
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? (JSON.parse(stored) as T) : init
    } catch {
      return init
    }
  })
  const setVal = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValInner(prev => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
        try { localStorage.setItem(key, JSON.stringify(next)) } catch {}
        return next
      })
    },
    [key],
  )
  return [val, setVal]
}

function NumInput({
  label,
  hint,
  value,
  onChange,
  prefix,
  suffix,
  step = 1,
  min = 0,
  highlighted = false,
}: {
  label: string
  hint?: string
  value: number
  onChange: (v: number) => void
  prefix?: string
  suffix?: string
  step?: number
  min?: number
  highlighted?: boolean
}) {
  const id = useId()
  const [local, setLocal] = useState(() => String(value))
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setLocal(String(value))
  }, [value, editing])

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-gray-400">{label}</label>
      {hint && <span className="text-xs text-gray-600 -mt-0.5">{hint}</span>}
      <div className={`flex items-center gap-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 focus-within:border-gray-500 transition-[border-color]${highlighted ? ' nl-flash' : ''}`}>
        {prefix && <span className="text-gray-500 text-sm shrink-0" aria-hidden>{prefix}</span>}
        <input
          id={id}
          type="number"
          value={local}
          step={step}
          min={min}
          onFocus={() => {
            setEditing(true)
            if (local === '0') setLocal('')
          }}
          onBlur={() => {
            setEditing(false)
            const n = Number(local)
            if (local === '' || isNaN(n)) {
              setLocal(String(value))
            } else {
              onChange(n)
            }
          }}
          onChange={(e) => {
            setLocal(e.target.value)
            const n = Number(e.target.value)
            if (e.target.value !== '' && !isNaN(n)) onChange(n)
          }}
          className="bg-transparent text-white text-sm w-full outline-none tabular min-w-0"
        />
        {suffix && <span className="text-gray-500 text-sm shrink-0 whitespace-nowrap" aria-hidden>{suffix}</span>}
      </div>
    </div>
  )
}

function Section({
  title,
  id,
  children,
  defaultOpen = true,
}: {
  title: string
  id: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return defaultOpen
    try {
      const s = localStorage.getItem(`lf/section/${id}`)
      return s !== null ? (JSON.parse(s) as boolean) : defaultOpen
    } catch {
      return defaultOpen
    }
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    try { localStorage.setItem(`lf/section/${id}`, JSON.stringify(next)) } catch {}
  }

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden card-shadow">
      <button
        onClick={toggle}
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

// ─── NL interface ──────────────────────────────────────────────────────────

type CalcPatch = {
  currentAge?: number
  targetAge?: number
  lifeExpectancy?: number
  portfolioEur?: number
  grossUsd?: number
  postCitizenshipGrossUsd?: number
  rent?: number
  foodUtils?: number
  familySupport?: number
  tithePercent?: number
  discretionary?: number
  annualIrregular?: number
  deductibleExpenses?: number
  isFirstYear?: boolean
  isSecondYear?: boolean
  scenario?: 'bear' | 'base' | 'bull'
  retirementRent?: number
  retirementFoodUtils?: number
  retirementFamilySupport?: number
  retirementDiscretionary?: number
  chRent?: number
  chFoodUtils?: number
  chHealthInsurance?: number
  chDiscretionary?: number
}

const PATCH_SCHEMA = {
  type: 'object',
  properties: {
    currentAge:               { type: 'number' },
    targetAge:                { type: 'number' },
    lifeExpectancy:           { type: 'number' },
    portfolioEur:             { type: 'number' },
    grossUsd:                 { type: 'number' },
    postCitizenshipGrossUsd:  { type: 'number' },
    rent:                     { type: 'number' },
    foodUtils:                { type: 'number' },
    familySupport:            { type: 'number' },
    tithePercent:             { type: 'number' },
    discretionary:            { type: 'number' },
    annualIrregular:          { type: 'number' },
    deductibleExpenses:       { type: 'number' },
    isFirstYear:              { type: 'boolean' },
    isSecondYear:             { type: 'boolean' },
    scenario:                 { type: 'string', enum: ['bear', 'base', 'bull'] },
    retirementRent:           { type: 'number' },
    retirementFoodUtils:      { type: 'number' },
    retirementFamilySupport:  { type: 'number' },
    retirementDiscretionary:  { type: 'number' },
    chRent:                   { type: 'number' },
    chFoodUtils:              { type: 'number' },
    chHealthInsurance:        { type: 'number' },
    chDiscretionary:          { type: 'number' },
  },
  additionalProperties: false,
} as const

const MODEL_ID = 'Llama-3.1-8B-Instruct-q4f16_1-MLC'
const WEBLLM_CACHE_KEY = `webllm-cached-${MODEL_ID}`

const FIELD_META: Record<string, { label: string; format?: (v: unknown) => string }> = {
  currentAge:               { label: 'Current age',              format: v => `${v} yrs` },
  targetAge:                { label: 'Target retirement age',    format: v => `${v} yrs` },
  lifeExpectancy:           { label: 'Life expectancy',          format: v => `${v} yrs` },
  portfolioEur:             { label: 'Portfolio',                format: v => `€${Number(v).toLocaleString('es-ES')}` },
  grossUsd:                 { label: 'Monthly gross (now)',      format: v => `$${Number(v).toLocaleString('es-ES')}` },
  postCitizenshipGrossUsd:  { label: 'Monthly gross (post-cit.)',format: v => `$${Number(v).toLocaleString('es-ES')}` },
  rent:                     { label: 'Rent',                     format: v => `€${Number(v).toLocaleString('es-ES')}` },
  foodUtils:                { label: 'Food + utilities',         format: v => `€${Number(v).toLocaleString('es-ES')}` },
  familySupport:            { label: 'Family support',           format: v => `€${Number(v).toLocaleString('es-ES')}` },
  tithePercent:             { label: 'Tithe',                    format: v => `${v}%` },
  discretionary:            { label: 'Discretionary',            format: v => `€${Number(v).toLocaleString('es-ES')}` },
  annualIrregular:          { label: 'Annual irregular',         format: v => `€${Number(v).toLocaleString('es-ES')}` },
  deductibleExpenses:       { label: 'Deductible expenses/yr',   format: v => `€${Number(v).toLocaleString('es-ES')}` },
  isFirstYear:              { label: 'Autónomo year',            format: v => v ? '1st yr' : 'Normal' },
  isSecondYear:             { label: 'Autónomo year',            format: v => v ? '2nd yr' : 'Normal' },
  scenario:                 { label: 'Scenario',                 format: v => String(v).charAt(0).toUpperCase() + String(v).slice(1) },
  retirementRent:           { label: 'Retirement rent',          format: v => `€${Number(v).toLocaleString('es-ES')}` },
  retirementFoodUtils:      { label: 'Retirement food + utils',  format: v => `€${Number(v).toLocaleString('es-ES')}` },
  retirementFamilySupport:  { label: 'Retirement family support',format: v => `€${Number(v).toLocaleString('es-ES')}` },
  retirementDiscretionary:  { label: 'Retirement discretionary', format: v => `€${Number(v).toLocaleString('es-ES')}` },
  chRent:                   { label: 'CH rent',                  format: v => `€${Number(v).toLocaleString('es-ES')}` },
  chFoodUtils:              { label: 'CH food + utilities',      format: v => `€${Number(v).toLocaleString('es-ES')}` },
  chHealthInsurance:        { label: 'CH health insurance',      format: v => `€${Number(v).toLocaleString('es-ES')}` },
  chDiscretionary:          { label: 'CH discretionary',         format: v => `€${Number(v).toLocaleString('es-ES')}` },
}

const SYSTEM_PROMPT = `You are a JSON patch extractor for a LeanFIRE retirement calculator.
The user will describe changes to their financial situation in plain language.
Output ONLY a JSON object with the fields that should change, using these exact keys:
currentAge, targetAge, lifeExpectancy, portfolioEur, grossUsd, postCitizenshipGrossUsd,
rent, foodUtils, familySupport, tithePercent, discretionary, annualIrregular,
deductibleExpenses, isFirstYear, isSecondYear, scenario,
retirementRent, retirementFoodUtils, retirementFamilySupport, retirementDiscretionary,
chRent, chFoodUtils, chHealthInsurance, chDiscretionary.
Only include fields explicitly mentioned. Omit everything else. No explanation, no markdown, just JSON.
scenario must be "bear", "base", or "bull". isFirstYear/isSecondYear are booleans.
All money values are numbers (no currency symbols). annualIrregular is yearly total.
retirementRent/retirementFoodUtils/retirementFamilySupport/retirementDiscretionary are
expenses expected at retirement (cheaper location), used for the FIRE number.
chRent/chFoodUtils/chHealthInsurance/chDiscretionary are expenses while working in Switzerland.`

type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'

type PendingPatch = {
  patch: CalcPatch
  currentValues: Record<string, unknown>
}

function NLPromptBar({ onPatch, currentValues }: { onPatch: (patch: CalcPatch) => void; currentValues: Record<string, unknown> }) {
  const engineRef = useRef<import('@mlc-ai/web-llm').MLCEngine | null>(null)
  const [status, setStatus] = useState<EngineStatus>('idle')
  const [loadProgress, setLoadProgress] = useState(0)
  const [input, setInput] = useState('')
  const [processing, setProcessing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const didAutoLoad = useRef(false)
  const [pending, setPending] = useState<PendingPatch | null>(null)

  const loadEngine = useCallback(async () => {
    if (engineRef.current || status === 'loading') return
    setStatus('loading')
    setLoadProgress(0)
    setLastError(null)
    try {
      const { MLCEngine } = await import('@mlc-ai/web-llm')
      const engine = new MLCEngine()
      engine.setInitProgressCallback((p) => {
        setLoadProgress(Math.round((p.progress ?? 0) * 100))
      })
      await engine.reload(MODEL_ID)
      engineRef.current = engine
      try { localStorage.setItem(WEBLLM_CACHE_KEY, '1') } catch {}
      setStatus('ready')
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }, [status])

  // Auto-load from browser cache if previously downloaded
  useEffect(() => {
    if (!didAutoLoad.current && typeof window !== 'undefined' && localStorage.getItem(WEBLLM_CACHE_KEY)) {
      didAutoLoad.current = true
      loadEngine()
    }
  // loadEngine is stable on mount (status='idle'); intentional single-fire
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async () => {
    if (!input.trim() || processing) return
    if (!engineRef.current) {
      await loadEngine()
      if (!engineRef.current) return
    }
    setProcessing(true)
    setLastError(null)
    try {
      const reply = await engineRef.current.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input.trim() },
        ],
        response_format: { type: 'json_object', schema: JSON.stringify(PATCH_SCHEMA) },
        temperature: 0.1,
        max_tokens: 256,
      })
      const text = reply.choices[0]?.message?.content ?? '{}'
      const patch: CalcPatch = JSON.parse(text)
      const keys = Object.keys(patch).filter(k => patch[k as keyof CalcPatch] != null)
      if (keys.length === 0) {
        // No recognized fields — keep input for user to retype
        setLastError('No changes detected. Try rephrasing your request.')
      } else {
        setPending({ patch, currentValues })
      }
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e))
    } finally {
      setProcessing(false)
    }
  }

  const handleConfirm = () => {
    if (pending) {
      onPatch(pending.patch)
      setPending(null)
      setInput('')
    }
  }

  const handleCancel = () => {
    setPending(null)
  }

  useEffect(() => {
    if (!pending) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); handleConfirm() }
      if (e.key === 'Escape') { e.preventDefault(); handleCancel() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pending])

  return (
    <div className="border border-gray-700 rounded-lg p-3 bg-gray-900/60 card-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400">Natural language</span>
        {status === 'idle' && (
          <button
            onClick={loadEngine}
            className="text-xs text-blue-400 hover:text-blue-300 border border-gray-700 rounded px-2 py-0.5 transition-[color]"
          >
            Load AI (~5 GB)
          </button>
        )}
        {status === 'loading' && (
          <span className="text-xs text-gray-500">Loading… {loadProgress}%</span>
        )}
        {status === 'ready' && (
          <span className="text-xs text-emerald-500">Ready</span>
        )}
        {status === 'error' && (
          <button
            onClick={() => { setStatus('idle') }}
            className="text-xs text-red-400 hover:text-red-300 border border-gray-700 rounded px-2 py-0.5"
          >
            Retry
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
          placeholder='e.g. "my rent went up to €700 and I got a raise to $4200"'
          disabled={processing || status === 'loading' || pending !== null}
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder:text-gray-600 outline-none focus:border-gray-500 transition-[border-color] disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || processing || status === 'loading' || status === 'error' || pending !== null}
          className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-40 transition-[border-color,color]"
        >
          {processing ? '…' : 'Apply'}
        </button>
      </div>
      {status === 'loading' && (
        <div className="mt-2 h-1 bg-gray-800 rounded overflow-hidden">
          <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${loadProgress}%` }} />
        </div>
      )}
      {lastError && (
        <p className="mt-1.5 text-xs text-red-400 truncate" title={lastError}>{lastError}</p>
      )}
      {pending && (
        <div className="mt-2 border-t border-gray-700 pt-2 animate-in">
          <p className="text-xs text-gray-400 mb-1.5">
            AI suggests {Object.keys(pending.patch).filter(k => pending.patch[k as keyof CalcPatch] != null).length} change{Object.keys(pending.patch).filter(k => pending.patch[k as keyof CalcPatch] != null).length > 1 ? 's' : ''}
          </p>
          <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
            {Object.entries(pending.patch)
              .filter(([k, v]) => v != null)
              .map(([key, value]) => {
                const meta = FIELD_META[key]
                if (!meta) return null
                const oldVal = meta.format ? meta.format(pending.currentValues[key]) : String(pending.currentValues[key])
                const newVal = meta.format ? meta.format(value) : String(value)
                return (
                  <div key={key} className="flex items-center text-xs gap-1.5">
                    <span className="text-gray-400 w-36 shrink-0 truncate" title={meta.label}>{meta.label}</span>
                    <span className="text-gray-500 tabular">{oldVal}</span>
                    <span className="text-gray-600" aria-hidden>→</span>
                    <span className="text-emerald-400 font-medium tabular">{newVal}</span>
                  </div>
                )
              })}
          </div>
          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-gray-700/60">
            <button
              onClick={handleCancel}
              className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded border border-gray-700 transition-[color]"
            >
              Cancel (Esc)
            </button>
            <button
              onClick={handleConfirm}
              className="text-xs text-emerald-300 hover:text-emerald-200 px-3 py-1 rounded border border-emerald-800 bg-emerald-950/30 transition-[color,background-color]"
            >
              Confirm (Enter)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── main ──────────────────────────────────────────────────────────────────
export default function Home() {
  // FX
  const [fxRate, setFxRate] = useLS('lf/fxRate', 0.848449)
  const [fxManual, setFxManual] = useLS('lf/fxManual', false)

  useEffect(() => {
    if (!fxManual) fetchUsdToEur().then(setFxRate)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxManual])

  // Current state
  const [currentAge, setCurrentAge] = useLS('lf/currentAge', 26)
  const [targetAge, setTargetAge] = useLS('lf/targetAge', 30)
  const [lifeExpectancy, setLifeExpectancy] = useLS('lf/lifeExpectancy', 90)

  // Portfolio allocation — per asset class
  const [goldEur, setGoldEur] = useLS('lf/goldEur', 0)
  const [silverEur, setSilverEur] = useLS('lf/silverEur', 0)
  const [sp500Eur, setSp500Eur] = useLS('lf/sp500Eur', 0)
  const [valueEtfEur, setValueEtfEur] = useLS('lf/valueEtfEur', 0)
  const [momentumEtfEur, setMomentumEtfEur] = useLS('lf/momentumEtfEur', 0)
  const [qualityEtfEur, setQualityEtfEur] = useLS('lf/qualityEtfEur', 0)
  const [smallCapEtfEur, setSmallCapEtfEur] = useLS('lf/smallCapEtfEur', 0)

  const equityEur = sp500Eur + valueEtfEur + momentumEtfEur + qualityEtfEur + smallCapEtfEur
  const portfolioEur = goldEur + silverEur + equityEur

  // Blended real return: equity → scenario rate; gold → 0%; silver → −0.5%
  const blendedReturns = useMemo<Record<'bear' | 'base' | 'bull', number>>(() => {
    if (portfolioEur === 0) return RETURN_RATES
    const w = (rate: number) =>
      equityEur / portfolioEur * rate +
      goldEur   / portfolioEur * 0 +
      silverEur / portfolioEur * (-0.005)
    return { bear: w(RETURN_RATES.bear), base: w(RETURN_RATES.base), bull: w(RETURN_RATES.bull) }
  }, [portfolioEur, equityEur, goldEur, silverEur])

  // Income
  const [grossUsd, setGrossUsd] = useLS('lf/grossUsd', 3700)
  const [postCitizenshipGrossUsd, setPostCitizenshipGrossUsd] = useLS('lf/postCitizenshipGrossUsd', 10000)
  const citizenshipDate = useMemo(() => new Date(2026, 9, 1), [])

  // Working expenses (EUR/month) — used for savings calculation
  const [rent, setRent] = useLS('lf/rent', 620)
  const [foodUtils, setFoodUtils] = useLS('lf/foodUtils', 200)
  const [familySupport, setFamilySupport] = useLS('lf/familySupport', 350)
  const [tithePercent, setTithePercent] = useLS('lf/tithePercent', 0)
  const [discretionary, setDiscretionary] = useLS('lf/discretionary', 0)
  const [annualIrregular, setAnnualIrregular] = useLS('lf/annualIrregular', 0)
  const [deductibleExpenses, setDeductibleExpenses] = useLS('lf/deductibleExpenses', 1200)

  // Working expenses (EUR/month) — Phase 2 Switzerland
  const [chRent, setChRent] = useLS('lf/chRent', 1500)
  const [chFoodUtils, setChFoodUtils] = useLS('lf/chFoodUtils', 500)
  const [chHealthInsurance, setChHealthInsurance] = useLS('lf/chHealthInsurance', 400)
  const [chDiscretionary, setChDiscretionary] = useLS('lf/chDiscretionary', 100)

  // Retirement expenses (EUR/month) — used for FIRE number
  const [retirementRent, setRetirementRent] = useLS('lf/retirementRent', 300)
  const [retirementFoodUtils, setRetirementFoodUtils] = useLS('lf/retirementFoodUtils', 200)
  const [retirementFamilySupport, setRetirementFamilySupport] = useLS('lf/retirementFamilySupport', 350)
  const [retirementDiscretionary, setRetirementDiscretionary] = useLS('lf/retirementDiscretionary', 0)

  // Tax flags (autónomo pre-citizenship only)
  const [isFirstYear, setIsFirstYear] = useLS('lf/isFirstYear', false)
  const [isSecondYear, setIsSecondYear] = useLS('lf/isSecondYear', false)

  // Return scenario
  const [scenario, setScenario] = useLS<'bear' | 'base' | 'bull'>('lf/scenario', 'base')

  // 36-month plan tracking
  const [currentPlanMonth, setCurrentPlanMonth] = useLS('lf/currentPlanMonth', 1)

  const currentValues = useMemo<Record<string, unknown>>(() => ({
    currentAge, targetAge, lifeExpectancy, portfolioEur,
    grossUsd, postCitizenshipGrossUsd,
    rent, foodUtils, familySupport, tithePercent, discretionary, annualIrregular, deductibleExpenses,
    isFirstYear, isSecondYear, scenario,
    retirementRent, retirementFoodUtils, retirementFamilySupport, retirementDiscretionary,
    chRent, chFoodUtils, chHealthInsurance, chDiscretionary,
  }), [
    currentAge, targetAge, lifeExpectancy, portfolioEur,
    grossUsd, postCitizenshipGrossUsd,
    rent, foodUtils, familySupport, tithePercent, discretionary, annualIrregular, deductibleExpenses,
    isFirstYear, isSecondYear, scenario,
    retirementRent, retirementFoodUtils, retirementFamilySupport, retirementDiscretionary,
    chRent, chFoodUtils, chHealthInsurance, chDiscretionary,
  ])

  const [highlightedFields, setHighlightedFields] = useState<Set<string>>(new Set())

  // ─── NL patch handler ─────────────────────────────────────────────────────
  const handleNLPatch = useCallback((patch: CalcPatch) => {
    const nextCurrentAge     = patch.currentAge     != null ? Math.round(patch.currentAge)     : currentAge
    const nextTargetAge      = patch.targetAge      != null ? Math.round(patch.targetAge)      : targetAge
    const nextLifeExpectancy = patch.lifeExpectancy != null ? Math.round(patch.lifeExpectancy) : lifeExpectancy
    if (nextCurrentAge < nextTargetAge && nextTargetAge < nextLifeExpectancy) {
      if (patch.currentAge     != null) setCurrentAge(Math.max(0, nextCurrentAge))
      if (patch.targetAge      != null) setTargetAge(nextTargetAge)
      if (patch.lifeExpectancy != null) setLifeExpectancy(nextLifeExpectancy)
    }
    if (patch.grossUsd                != null) setGrossUsd(Math.max(0, patch.grossUsd))
    if (patch.postCitizenshipGrossUsd != null) setPostCitizenshipGrossUsd(Math.max(0, patch.postCitizenshipGrossUsd))
    if (patch.rent                    != null) setRent(Math.max(0, patch.rent))
    if (patch.foodUtils               != null) setFoodUtils(Math.max(0, patch.foodUtils))
    if (patch.familySupport           != null) setFamilySupport(Math.max(0, patch.familySupport))
    if (patch.tithePercent            != null) setTithePercent(Math.max(0, Math.min(100, patch.tithePercent)))
    if (patch.discretionary           != null) setDiscretionary(Math.max(0, patch.discretionary))
    if (patch.annualIrregular         != null) setAnnualIrregular(Math.max(0, patch.annualIrregular))
    if (patch.deductibleExpenses      != null) setDeductibleExpenses(Math.max(0, patch.deductibleExpenses))
    if (patch.retirementRent          != null) setRetirementRent(Math.max(0, patch.retirementRent))
    if (patch.retirementFoodUtils     != null) setRetirementFoodUtils(Math.max(0, patch.retirementFoodUtils))
    if (patch.retirementFamilySupport != null) setRetirementFamilySupport(Math.max(0, patch.retirementFamilySupport))
    if (patch.retirementDiscretionary != null) setRetirementDiscretionary(Math.max(0, patch.retirementDiscretionary))
    if (patch.chRent                  != null) setChRent(Math.max(0, patch.chRent))
    if (patch.chFoodUtils             != null) setChFoodUtils(Math.max(0, patch.chFoodUtils))
    if (patch.chHealthInsurance       != null) setChHealthInsurance(Math.max(0, patch.chHealthInsurance))
    if (patch.chDiscretionary         != null) setChDiscretionary(Math.max(0, patch.chDiscretionary))
    if (patch.isFirstYear != null || patch.isSecondYear != null) {
      const f = patch.isFirstYear  ?? false
      const s = patch.isSecondYear ?? false
      if (f) { setIsFirstYear(true);  setIsSecondYear(false) }
      else if (s) { setIsFirstYear(false); setIsSecondYear(true) }
      else { setIsFirstYear(false); setIsSecondYear(false) }
    }
    if (patch.scenario != null && ['bear', 'base', 'bull'].includes(patch.scenario)) {
      setScenario(patch.scenario)
    }
    const changed = new Set(Object.keys(patch).filter(k => (patch as Record<string, unknown>)[k] != null))
    setHighlightedFields(changed)
    setTimeout(() => setHighlightedFields(new Set()), 600)
  }, [currentAge, targetAge, lifeExpectancy])

  // ─── derived: tax + net income (Spain autónomo, pre-citizenship) ──────────
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

  // Post-citizenship: Swiss employed tax (no autónomo cuota)
  const postCitizenshipTax = useMemo(() => {
    const grossEurAnnual = usdToEur(postCitizenshipGrossUsd * 12, fxRate)
    return calcTaxCH({ grossAnnualEur: grossEurAnnual })
  }, [postCitizenshipGrossUsd, fxRate])

  const postCitizenshipNet = postCitizenshipTax.netMonthly
  const postCitizenshipTithe = postCitizenshipNet * (tithePercent / 100)
  const postCitizenshipSavings = useMemo(
    () => postCitizenshipNet - chRent - chFoodUtils - chHealthInsurance - chDiscretionary - familySupport - postCitizenshipTithe - (annualIrregular / 12),
    [postCitizenshipNet, chRent, chFoodUtils, chHealthInsurance, chDiscretionary, familySupport, postCitizenshipTithe, annualIrregular]
  )

  // ─── 36-month plan simulations ───────────────────────────────────────────
  const planSims = useMemo(() => {
    const now = new Date()
    const citizenshipMs = Math.max(
      0,
      (citizenshipDate.getFullYear() - now.getFullYear()) * 12 +
        (citizenshipDate.getMonth() - now.getMonth())
    )
    const assets: PlanAssets = { goldEur, silverEur, sp500Eur, valueEtfEur, momentumEtfEur, qualityEtfEur, smallCapEtfEur }
    const run = (rate: number) => simulate36MonthPlan(assets, monthlySavings, postCitizenshipSavings, citizenshipMs, rate)
    return {
      bear: run(RETURN_RATES.bear),
      base: run(RETURN_RATES.base),
      bull: run(RETURN_RATES.bull),
    }
  }, [goldEur, silverEur, sp500Eur, valueEtfEur, momentumEtfEur, qualityEtfEur, smallCapEtfEur, monthlySavings, postCitizenshipSavings, citizenshipDate])

  const postPlanBlendedReturns = useMemo<Record<'bear' | 'base' | 'bull', number>>(() => ({
    bear: planSims.bear[36].blendedReturn,
    base: planSims.base[36].blendedReturn,
    bull: planSims.bull[36].blendedReturn,
  }), [planSims])

  // ─── FIRE number uses retirement expenses (cheaper location) ─────────────
  const retirementMonthly = useMemo(
    () => retirementRent + retirementFoodUtils + retirementFamilySupport + retirementDiscretionary,
    [retirementRent, retirementFoodUtils, retirementFamilySupport, retirementDiscretionary]
  )
  const annualExpenses = retirementMonthly * 12
  const retirementHorizon = lifeExpectancy - targetAge
  const swr = swrForHorizon(retirementHorizon)
  const fireNumber = annualExpenses / swr

  // Floor at retirement (no discretionary)
  const floorMonthly = retirementRent + retirementFoodUtils + retirementFamilySupport
  const floorAnnual = floorMonthly * 12
  const floorFireNumber = floorAnnual / swr

  // Retirement ages all 3 scenarios — uses 36-month plan simulation
  const retirementAges = useMemo(() => ({
    bear: retirementAgeForScenarioWithPlan(currentAge, annualExpenses, lifeExpectancy, planSims.bear, monthlySavings, postCitizenshipSavings, citizenshipDate),
    base: retirementAgeForScenarioWithPlan(currentAge, annualExpenses, lifeExpectancy, planSims.base, monthlySavings, postCitizenshipSavings, citizenshipDate),
    bull: retirementAgeForScenarioWithPlan(currentAge, annualExpenses, lifeExpectancy, planSims.bull, monthlySavings, postCitizenshipSavings, citizenshipDate),
  }), [currentAge, annualExpenses, lifeExpectancy, planSims, monthlySavings, postCitizenshipSavings, citizenshipDate])

  const currentRetirementAge = retirementAges[scenario]
  const gapYears = +(currentRetirementAge - targetAge).toFixed(1)

  // PMT needed from month 36 onward to hit target age
  const monthsToTarget = Math.max(0, (targetAge - currentAge) * 12)
  const monthsAfterPlan = Math.max(0, monthsToTarget - 36)
  const pmt = solveForPMT(fireNumber, planSims[scenario][36].totalPortfolio, postPlanBlendedReturns[scenario], monthsAfterPlan)

  // Required gross (Swiss employed model, post-citizenship)
  const requiredNetMonthly = pmt + chRent + chFoodUtils + chHealthInsurance + chDiscretionary + familySupport + postCitizenshipTithe + (annualIrregular / 12)
  const requiredGrossEur = grossNeededForNetCH(requiredNetMonthly)
  const requiredGrossUsd = fxRate > 0 ? requiredGrossEur / 12 / fxRate : 0

  // ─── Portfolio trajectory chart data ─────────────────────────────────────
  const trajectoryData = useMemo<TrajectoryPoint[]>(() => {
    return calcPortfolioTrajectoryWithPlan(
      currentAge,
      lifeExpectancy,
      planSims,
      monthlySavings,
      postCitizenshipSavings,
      citizenshipDate,
    )
  }, [currentAge, lifeExpectancy, planSims, monthlySavings, postCitizenshipSavings, citizenshipDate])

  // ─── Buy order for current plan month ─────────────────────────────────────
  const buyOrder = useMemo(() => {
    const m = currentPlanMonth
    const pmt = m > (citizenshipDate.getFullYear() - new Date().getFullYear()) * 12 + (citizenshipDate.getMonth() - new Date().getMonth())
      ? postCitizenshipSavings
      : monthlySavings
    
    if (m <= 12) {
      return [{ asset: 'IS3S (Value)', amount: pmt }]
    } else if (m <= 24) {
      return [
        { asset: 'IS3S (Value)', amount: pmt * 0.5 },
        { asset: 'IWMO (Momentum)', amount: pmt * 0.25 },
        { asset: 'IWQU (Quality)', amount: pmt * 0.25 },
      ]
    } else {
      return [
        { asset: 'IS3S (Value)', amount: pmt * 0.4 },
        { asset: 'IWMO (Momentum)', amount: pmt * 0.3 },
        { asset: 'IWQU (Quality)', amount: pmt * 0.2 },
        { asset: 'IUSN (Small Cap)', amount: pmt * 0.1 },
      ]
    }
  }, [currentPlanMonth, monthlySavings, postCitizenshipSavings, citizenshipDate])

  const citizenshipAge = useMemo(() => {
    const now = new Date()
    const monthsUntilCitizenship =
      (citizenshipDate.getFullYear() - now.getFullYear()) * 12 +
      (citizenshipDate.getMonth() - now.getMonth())
    return Math.round((currentAge + monthsUntilCitizenship / 12) * 10) / 10
  }, [currentAge, citizenshipDate])

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
      planSims.base[36].totalPortfolio,
      annualExpenses,
      lifeExpectancy,
      buildSavings,
      citizenshipDate,
      postMultiplier,
      [1000, 12000],
      40,
      postPlanBlendedReturns,
    )
  }, [currentAge, planSims, annualExpenses, lifeExpectancy, fxRate, deductibleExpenses, isFirstYear, isSecondYear, tithePercent, rent, foodUtils, familySupport, discretionary, annualIrregular, grossUsd, postCitizenshipGrossUsd, citizenshipDate, postPlanBlendedReturns])

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">LeanFIRE Calculator</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Quant-correct model · SWR adjusted for horizon · Spain autónomo → Switzerland employed · USD/EUR dual-currency
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ─── LEFT: INPUTS ─────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            <NLPromptBar onPatch={handleNLPatch} currentValues={currentValues} />

            <Section title="Current state" id="current-state">
              <NumInput label="Current age" value={currentAge} onChange={setCurrentAge} suffix="yrs" highlighted={highlightedFields.has('currentAge')} />
              <NumInput label="Target retirement age" value={targetAge} onChange={setTargetAge} suffix="yrs" highlighted={highlightedFields.has('targetAge')} />
              <NumInput label="Life expectancy" value={lifeExpectancy} onChange={setLifeExpectancy} suffix="yrs" highlighted={highlightedFields.has('lifeExpectancy')} />
            </Section>

            <Section title="Portfolio allocation" id="portfolio">
              <div className="col-span-2 -mb-1 text-xs text-gray-500">
                Gold 0% · Silver −0.5% real return. Equity uses scenario rate.
              </div>
              <NumInput label="Gold (SGLD)" value={goldEur} onChange={setGoldEur} prefix="€" step={500} />
              <NumInput label="Silver (ISLN)" value={silverEur} onChange={setSilverEur} prefix="€" step={100} />
              <NumInput label="S&P 500" value={sp500Eur} onChange={setSp500Eur} prefix="€" step={500} />
              <NumInput label="IS3S · Value" value={valueEtfEur} onChange={setValueEtfEur} prefix="€" step={500} />
              <NumInput label="IWMO · Momentum" value={momentumEtfEur} onChange={setMomentumEtfEur} prefix="€" step={500} />
              <NumInput label="IWQU · Quality" value={qualityEtfEur} onChange={setQualityEtfEur} prefix="€" step={500} />
              <NumInput label="IUSN · Small Cap" value={smallCapEtfEur} onChange={setSmallCapEtfEur} prefix="€" step={500} />
              <div className="col-span-2 mt-1 pt-2 border-t border-gray-800 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Total</span>
                  <span className="text-white font-medium tabular">{fmtEur(portfolioEur)}</span>
                </div>
                {portfolioEur > 0 && (
                  <>
                    <div className="h-2 flex rounded overflow-hidden gap-px">
                      {equityEur > 0 && <div className="bg-blue-500" style={{ width: `${equityEur / portfolioEur * 100}%` }} />}
                      {goldEur > 0 && <div className="bg-amber-400" style={{ width: `${goldEur / portfolioEur * 100}%` }} />}
                      {silverEur > 0 && <div className="bg-gray-400" style={{ width: `${silverEur / portfolioEur * 100}%` }} />}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                      {equityEur > 0 && <span><span className="text-blue-400">■</span> Equity {(equityEur / portfolioEur * 100).toFixed(0)}%</span>}
                      {goldEur > 0 && <span><span className="text-amber-400">■</span> Gold {(goldEur / portfolioEur * 100).toFixed(0)}%</span>}
                      {silverEur > 0 && <span><span className="text-gray-400">■</span> Silver {(silverEur / portfolioEur * 100).toFixed(0)}%</span>}
                      <span className="ml-auto text-gray-600">Now: {(blendedReturns[scenario] * 100).toFixed(1)}% → Post-plan: {(postPlanBlendedReturns[scenario] * 100).toFixed(1)}%</span>
                    </div>
                  </>
                )}
              </div>
            </Section>

            <Section title="Income (USD)" id="income">
              <NumInput label="Monthly gross (now)" value={grossUsd} onChange={setGrossUsd} prefix="$" step={100} highlighted={highlightedFields.has('grossUsd')} />
              <NumInput
                label="Monthly gross (post-citizenship)"
                hint="Salary you'll aim to negotiate after Oct 2026"
                value={postCitizenshipGrossUsd}
                onChange={setPostCitizenshipGrossUsd}
                prefix="$"
                step={100}
                highlighted={highlightedFields.has('postCitizenshipGrossUsd')}
              />
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
                <p className="text-xs text-gray-600">Citizenship inflection: Oct 2026 · Swiss employed tax applies after</p>
              </div>
            </Section>

            <Section title="Working expenses: Phase 1 (Spain)" id="working-expenses">
              <NumInput label="Rent" value={rent} onChange={setRent} prefix="€" highlighted={highlightedFields.has('rent')} />
              <NumInput label="Food + utilities" value={foodUtils} onChange={setFoodUtils} prefix="€" highlighted={highlightedFields.has('foodUtils')} />
              <NumInput label="Family support (Rosario)" value={familySupport} onChange={setFamilySupport} prefix="€" highlighted={highlightedFields.has('familySupport')} />
              <NumInput label="Tithe" hint="% of net income" value={tithePercent} onChange={setTithePercent} suffix="%" step={1} highlighted={highlightedFields.has('tithePercent')} />
              <NumInput label="Discretionary" hint="Going out, hobbies, misc" value={discretionary} onChange={setDiscretionary} prefix="€" highlighted={highlightedFields.has('discretionary')} />
              <NumInput label="Annual irregular (÷12)" hint="Travel, gifts, repairs — yearly total" value={annualIrregular} onChange={setAnnualIrregular} prefix="€/yr" step={100} highlighted={highlightedFields.has('annualIrregular')} />
            </Section>

            <Section title="Working expenses: Phase 2 (Switzerland)" id="ch-working-expenses">
              <NumInput label="Rent (Zurich)" value={chRent} onChange={setChRent} prefix="€" highlighted={highlightedFields.has('chRent')} />
              <NumInput label="Food + utilities" value={chFoodUtils} onChange={setChFoodUtils} prefix="€" highlighted={highlightedFields.has('chFoodUtils')} />
              <NumInput label="Health Insurance" hint="Mandatory KVG" value={chHealthInsurance} onChange={setChHealthInsurance} prefix="€" highlighted={highlightedFields.has('chHealthInsurance')} />
              <NumInput label="Discretionary" value={chDiscretionary} onChange={setChDiscretionary} prefix="€" highlighted={highlightedFields.has('chDiscretionary')} />
              <div className="col-span-2 text-xs text-gray-600">
                Shared: Family support {fmtEur(familySupport)}, Tithe {tithePercent}%, Irregular {fmtEur(annualIrregular/12)}
              </div>
            </Section>

            <Section title="Retirement: Phase 3 (Minimalist)" id="retirement-expenses">
              <div className="col-span-2 -mb-1 text-xs text-gray-500">
                Post-FIRE ascetic lifestyle in a safe, low-cost location. Sets your FIRE number.
              </div>
              <NumInput label="Rent (Target location)" value={retirementRent} onChange={setRetirementRent} prefix="€" highlighted={highlightedFields.has('retirementRent')} />
              <NumInput label="Food + utilities" value={retirementFoodUtils} onChange={setRetirementFoodUtils} prefix="€" highlighted={highlightedFields.has('retirementFoodUtils')} />
              <NumInput label="Family support" value={retirementFamilySupport} onChange={setRetirementFamilySupport} prefix="€" highlighted={highlightedFields.has('retirementFamilySupport')} />
              <NumInput label="Discretionary (Ascetic)" value={retirementDiscretionary} onChange={setRetirementDiscretionary} prefix="€" highlighted={highlightedFields.has('retirementDiscretionary')} />
            </Section>

            <Section title="Tax & assumptions" id="tax-assumptions" defaultOpen={false}>
              <NumInput label="Deductible expenses/yr" hint="Business costs that reduce your taxable income" value={deductibleExpenses} onChange={setDeductibleExpenses} prefix="€/yr" step={100} highlighted={highlightedFields.has('deductibleExpenses')} />
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
                  ['Blended return (post-plan)', `${(postPlanBlendedReturns[scenario] * 100).toFixed(1)}%`],
                  ['Retirement expenses/yr', fmtEur(annualExpenses)],
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
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Tax Breakdown — Current (Spain autónomo)</p>
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
              <div className="mt-3 pt-3 border-t border-gray-800">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Post-citizenship (Switzerland employed)</p>
                <div className="space-y-1.5 text-sm">
                  {[
                    ['Gross Income', fmtEur(postCitizenshipTax.grossAnnual / 12) + '/mo'],
                    ['Social Insurance (6.4%)', fmtEur(postCitizenshipTax.cuotaAnnual / 12) + '/mo'],
                    ['Income Tax', fmtEur(postCitizenshipTax.irpfAnnual / 12) + '/mo'],
                    ['Net Take-Home', fmtEur(postCitizenshipNet) + '/mo'],
                    ['Effective Rate', `${(postCitizenshipTax.effectiveRate * 100).toFixed(1)}%`],
                    ['Net Savings (post-cit.)', fmtEur(postCitizenshipSavings) + '/mo'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-gray-500">{label}</span>
                      <span className={`font-medium tabular ${label === 'Net Savings (post-cit.)' && postCitizenshipSavings < 0 ? 'text-red-400' : 'text-gray-200'}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Floor note */}
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-950/50 text-xs text-gray-500">
              <span className="text-gray-400 font-medium">Withdrawal strategy: </span>
              Floor-and-upside hybrid. Non-negotiable floor at retirement:{' '}
              <span className="text-white">{fmtEur(floorMonthly)}/mo</span> (rent + food + family).
              Portfolio covers floor at {(swr * 100).toFixed(2)}% SWR → needs{' '}
              <span className="text-white">{fmtEur(floorFireNumber)}</span>. Everything above covers discretionary.
            </div>
          </div>
        </div>

        {/* Portfolio trajectory — full width */}
        <div className="mt-6 border border-gray-700 rounded-lg p-4 bg-gray-900/40">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-4">Portfolio trajectory over time (all scenarios)</p>
          <PortfolioTrajectoryChart
            data={trajectoryData}
            fireNumber={fireNumber}
            targetAge={targetAge}
            citizenshipAge={citizenshipAge}
          />
          <p className="text-xs text-gray-600 mt-2 text-center">
            Green dashed = FIRE number · Yellow = target age · Purple = citizenship inflection
          </p>
        </div>

        {/* 36-Month Plan Execution — full width */}
        <div className="mt-6 border border-blue-900/30 rounded-lg p-5 bg-blue-950/10 card-shadow">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">36-Month Strategy Execution</h2>
              <p className="text-xs text-gray-500">Month-by-month portfolio shift & actionable buy orders</p>
            </div>
            <div className="flex items-center gap-3 bg-gray-900/60 p-2 rounded-lg border border-gray-800">
              <label htmlFor="plan-month" className="text-xs font-medium text-gray-400 uppercase">Current Month</label>
              <input
                id="plan-month"
                type="number"
                min="1"
                max="36"
                value={currentPlanMonth}
                onChange={(e) => setCurrentPlanMonth(Math.max(1, Math.min(36, Number(e.target.value))))}
                className="w-12 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white outline-none focus:border-blue-500 transition-colors"
              />
              <input
                type="range"
                min="1"
                max="36"
                value={currentPlanMonth}
                onChange={(e) => setCurrentPlanMonth(Number(e.target.value))}
                className="w-32 accent-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">
              <PlanCompositionChart data={planSims[scenario]} />
              <p className="text-xs text-gray-600 mt-4 text-center">
                Visualizing the transition from Gold/Silver to the Phased Equity Strategy (M1-36)
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <div className="border border-emerald-900/50 rounded-lg p-4 bg-emerald-950/20">
                <p className="text-xs text-emerald-400 uppercase tracking-wide mb-3 font-semibold">Next Buy Order (Month {currentPlanMonth})</p>
                <div className="space-y-3">
                  {buyOrder.map((item, i) => (
                    <div key={i} className="flex justify-between items-center pb-2 border-b border-emerald-900/20 last:border-0 last:pb-0">
                      <span className="text-sm text-gray-300">{item.asset}</span>
                      <span className="text-lg font-bold text-white tabular">{fmtEur(item.amount)}</span>
                    </div>
                  ))}
                  <div className="pt-2 mt-2 border-t border-emerald-900/30 flex justify-between items-center">
                    <span className="text-xs text-emerald-500 font-medium">Total Investment</span>
                    <span className="text-sm font-semibold text-emerald-300">{fmtEur(buyOrder.reduce((acc, curr) => acc + curr.amount, 0))}</span>
                  </div>
                </div>
              </div>

              <div className="border border-gray-800 rounded-lg p-4 bg-gray-900/40">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Milestone Actions</p>
                <div className="space-y-2 text-xs">
                  <div className={`flex items-start gap-2 ${currentPlanMonth >= 13 ? 'text-emerald-400 line-through opacity-50' : 'text-gray-300'}`}>
                    <span className="mt-0.5">●</span>
                    <span>Month 13: Sell all Silver (ISLN) and reinvest 100% into IS3S.</span>
                  </div>
                  <div className={`flex items-start gap-2 ${currentPlanMonth >= 25 ? 'text-emerald-400 line-through opacity-50' : 'text-gray-300'}`}>
                    <span className="mt-0.5">●</span>
                    <span>Month 25: Sell €2,500 Gold (SGLD) and reinvest into Phase 3 split.</span>
                  </div>
                  <div className={`flex items-start gap-2 ${currentPlanMonth >= 36 ? 'text-emerald-400' : 'text-gray-500'}`}>
                    <span className="mt-0.5">●</span>
                    <span>Month 36: Plan complete. Maintain 40/30/20/10 split on all new savings.</span>
                  </div>
                </div>
              </div>
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
