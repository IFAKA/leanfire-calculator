// FIRE accumulation engine — quant-correct model

export type ReturnScenario = 'bear' | 'base' | 'bull'

// ─── 36-month investment plan simulation ─────────────────────────────────────

export interface PlanAssets {
  goldEur: number
  silverEur: number
  sp500Eur: number
  valueEtfEur: number    // IS3S
  momentumEtfEur: number // IWMO
  qualityEtfEur: number  // IWQU
  smallCapEtfEur: number // IUSN
}

export interface PlanMonthSnapshot {
  month: number
  assets: PlanAssets
  totalPortfolio: number
  blendedReturn: number // annualized real
}

const GOLD_REAL = 0
const SILVER_REAL = -0.005
const PLAN_GOLD_SALE_EUR = 2500 // mid-point of €2k–3k range, at start of phase 3

function _assetsTotal(a: PlanAssets): number {
  return a.goldEur + a.silverEur + a.sp500Eur + a.valueEtfEur + a.momentumEtfEur + a.qualityEtfEur + a.smallCapEtfEur
}

function _blendedReturn(a: PlanAssets, equityRate: number): number {
  const total = _assetsTotal(a)
  if (total === 0) return equityRate
  const equity = a.sp500Eur + a.valueEtfEur + a.momentumEtfEur + a.qualityEtfEur + a.smallCapEtfEur
  return equity / total * equityRate + a.goldEur / total * GOLD_REAL + a.silverEur / total * SILVER_REAL
}

/**
 * Simulate the 36-month phased investment plan month by month.
 * Phase 1 (m1-12):  100% PMT → IS3S; silver sold at m13 → IS3S
 * Phase 2 (m13-24): 50% IS3S / 25% IWMO / 25% IWQU
 * Phase 3 (m25-36): 40% IS3S / 30% IWMO / 20% IWQU / 10% IUSN; €2500 gold sold at m25
 * Returns snapshots[0..36] where [0] = initial state, [36] = after 36 months.
 */
export function simulate36MonthPlan(
  initialAssets: PlanAssets,
  preCitizenshipMonthlyPmt: number,
  postCitizenshipMonthlyPmt: number,
  citizenshipMonths: number, // months from now until citizenship (0 = already citizen)
  equityAnnualReturn: number
): PlanMonthSnapshot[] {
  const rEq     = equityAnnualReturn / 12
  const rGold   = GOLD_REAL / 12
  const rSilver = SILVER_REAL / 12

  let a: PlanAssets = { ...initialAssets }
  const snapshots: PlanMonthSnapshot[] = []
  snapshots.push({ month: 0, assets: { ...a }, totalPortfolio: _assetsTotal(a), blendedReturn: _blendedReturn(a, equityAnnualReturn) })

  for (let m = 1; m <= 36; m++) {
    // 1. Appreciate
    a.goldEur        *= (1 + rGold)
    a.silverEur      *= (1 + rSilver)
    a.sp500Eur       *= (1 + rEq)
    a.valueEtfEur    *= (1 + rEq)
    a.momentumEtfEur *= (1 + rEq)
    a.qualityEtfEur  *= (1 + rEq)
    a.smallCapEtfEur *= (1 + rEq)

    // 2. One-time events
    if (m === 13) {
      a.valueEtfEur += a.silverEur
      a.silverEur = 0
    }
    if (m === 25) {
      const sale = Math.min(PLAN_GOLD_SALE_EUR, a.goldEur)
      a.goldEur        -= sale
      a.valueEtfEur    += sale * 0.40
      a.momentumEtfEur += sale * 0.30
      a.qualityEtfEur  += sale * 0.20
      a.smallCapEtfEur += sale * 0.10
    }

    // 3. Monthly savings per phase
    const pmt = m > citizenshipMonths ? postCitizenshipMonthlyPmt : preCitizenshipMonthlyPmt
    if (m <= 12) {
      a.valueEtfEur += pmt
    } else if (m <= 24) {
      a.valueEtfEur    += pmt * 0.50
      a.momentumEtfEur += pmt * 0.25
      a.qualityEtfEur  += pmt * 0.25
    } else {
      a.valueEtfEur    += pmt * 0.40
      a.momentumEtfEur += pmt * 0.30
      a.qualityEtfEur  += pmt * 0.20
      a.smallCapEtfEur += pmt * 0.10
    }

    snapshots.push({
      month: m,
      assets: { ...a },
      totalPortfolio: _assetsTotal(a),
      blendedReturn: _blendedReturn(a, equityAnnualReturn),
    })
  }

  return snapshots
}

/**
 * Retirement age using the plan simulation for months 0-36,
 * then standard FV with the month-36 blended rate for the remainder.
 */
export function retirementAgeForScenarioWithPlan(
  currentAgeYears: number,
  annualExpensesEur: number,
  lifeExpectancy: number,
  planSim: PlanMonthSnapshot[],
  preCitizenshipMonthlySavings: number,
  postCitizenshipMonthlySavings: number,
  citizenshipDate: Date
): number {
  const PLAN_MONTHS = 36
  const now = new Date()
  const citizenshipMonths = Math.max(
    0,
    (citizenshipDate.getFullYear() - now.getFullYear()) * 12 +
      (citizenshipDate.getMonth() - now.getMonth())
  )

  const portfolioAt = (targetMonths: number): number => {
    if (targetMonths <= PLAN_MONTHS) {
      return planSim[Math.min(Math.round(targetMonths), PLAN_MONTHS)].totalPortfolio
    }
    const base = planSim[PLAN_MONTHS]
    const rate = base.blendedReturn
    const extra = targetMonths - PLAN_MONTHS
    const preCitExtra  = Math.max(0, Math.min(extra, citizenshipMonths - PLAN_MONTHS))
    const postCitExtra = Math.max(0, extra - preCitExtra)
    const atCit = futureValue(base.totalPortfolio, preCitizenshipMonthlySavings, rate, preCitExtra)
    return futureValue(atCit, postCitizenshipMonthlySavings, rate, postCitExtra)
  }

  let lo = currentAgeYears
  let hi = currentAgeYears + 60

  for (let iter = 0; iter < 80; iter++) {
    const mid = (lo + hi) / 2
    const months = Math.round((mid - currentAgeYears) * 12)
    const portfolio = portfolioAt(months)
    const horizon = lifeExpectancy - mid
    const swr = swrForHorizon(Math.max(0, horizon))
    const fireNum = annualExpensesEur / swr
    if (portfolio >= fireNum) hi = mid
    else lo = mid
    if (hi - lo < 0.05) break
  }
  return Math.round((lo + hi) / 2 * 10) / 10
}

/**
 * Portfolio trajectory using plan simulation for first 36 months,
 * then FV with month-36 blended rate after.
 */
export function calcPortfolioTrajectoryWithPlan(
  currentAge: number,
  maxAge: number,
  planSims: Record<ReturnScenario, PlanMonthSnapshot[]>,
  preCitizenshipMonthlySavings: number,
  postCitizenshipMonthlySavings: number,
  citizenshipDate: Date
): TrajectoryPoint[] {
  const PLAN_MONTHS = 36
  const now = new Date()
  const citizenshipMonths = Math.max(
    0,
    (citizenshipDate.getFullYear() - now.getFullYear()) * 12 +
      (citizenshipDate.getMonth() - now.getMonth())
  )

  const calcScenario = (sim: PlanMonthSnapshot[], age: number): number => {
    const totalMonths = Math.round((age - currentAge) * 12)
    if (totalMonths <= PLAN_MONTHS) {
      return sim[Math.min(totalMonths, PLAN_MONTHS)].totalPortfolio
    }
    const base = sim[PLAN_MONTHS]
    const rate = base.blendedReturn
    const extra = totalMonths - PLAN_MONTHS
    const preCitExtra  = Math.max(0, Math.min(extra, citizenshipMonths - PLAN_MONTHS))
    const postCitExtra = Math.max(0, extra - preCitExtra)
    const atCit = futureValue(base.totalPortfolio, preCitizenshipMonthlySavings, rate, preCitExtra)
    return futureValue(atCit, postCitizenshipMonthlySavings, rate, postCitExtra)
  }

  const points: TrajectoryPoint[] = []
  for (let age = currentAge; age <= maxAge; age++) {
    points.push({
      age,
      bear: Math.round(calcScenario(planSims.bear, age)),
      base: Math.round(calcScenario(planSims.base, age)),
      bull: Math.round(calcScenario(planSims.bull, age)),
    })
  }
  return points
}

export const RETURN_RATES: Record<ReturnScenario, number> = {
  bear: 0.02,
  base: 0.04,
  bull: 0.06,
}

// SWR lookup by retirement horizon (years). Source: ERN/Portfolio Charts.
// 4% only holds for ~30yr horizon; 60yr requires 3%.
export const SWR_TABLE: { minYears: number; swr: number }[] = [
  { minYears: 60, swr: 0.03 },
  { minYears: 50, swr: 0.0325 },
  { minYears: 40, swr: 0.035 },
  { minYears: 30, swr: 0.04 },
  { minYears: 0, swr: 0.045 },
]

export function swrForHorizon(horizonYears: number): number {
  for (const row of SWR_TABLE) {
    if (horizonYears >= row.minYears) return row.swr
  }
  return 0.04
}

// FV of lump sum + regular contributions (monthly compounding)
// FV = PV*(1+r)^n + PMT*[((1+r)^n - 1)/r]
export function futureValue(pv: number, pmtMonthly: number, annualRealReturn: number, months: number): number {
  if (months <= 0) return pv
  const r = annualRealReturn / 12
  const factor = Math.pow(1 + r, months)
  if (r === 0) return pv + pmtMonthly * months
  return pv * factor + pmtMonthly * ((factor - 1) / r)
}

// Solve for required monthly PMT to reach target FV given PV, return, months
export function solveForPMT(fvTarget: number, pv: number, annualRealReturn: number, months: number): number {
  if (months <= 0) return Infinity
  const r = annualRealReturn / 12
  const factor = Math.pow(1 + r, months)
  const pvFuture = pv * factor
  if (fvTarget <= pvFuture) return 0 // already funded
  const needed = fvTarget - pvFuture
  if (r === 0) return needed / months
  return needed / ((factor - 1) / r)
}

export interface AccumulationInput {
  currentAgeYears: number
  targetRetirementAge: number
  currentPortfolioEur: number
  // Pre-citizenship period (now → citizenshipDate)
  preCitizenshipMonthlyNetSavingsEur: number
  // Post-citizenship period (citizenshipDate → retirement)
  postCitizenshipMonthlyNetSavingsEur: number
  citizenshipDate: Date // inflection point
  lifeExpectancy?: number // default 90
  annualExpensesAtRetirementEur: number
  scenario: ReturnScenario
}

export interface AccumulationResult {
  fireNumber: number
  swr: number
  retirementHorizonYears: number
  portfolioAtRetirement: number
  gapToFireNumber: number
  monthsToTarget: number
  monthlyPmtNeeded: number
  // Sensitivity: how portfolio grows over time
  projectedPortfolioAtTarget: number
}

export function calcAccumulation(input: AccumulationInput): AccumulationResult {
  const {
    currentAgeYears,
    targetRetirementAge,
    currentPortfolioEur,
    preCitizenshipMonthlyNetSavingsEur,
    postCitizenshipMonthlyNetSavingsEur,
    citizenshipDate,
    lifeExpectancy = 90,
    annualExpensesAtRetirementEur,
    scenario,
  } = input

  const annualReturn = RETURN_RATES[scenario]
  const retirementHorizonYears = lifeExpectancy - targetRetirementAge
  const swr = swrForHorizon(retirementHorizonYears)
  const fireNumber = annualExpensesAtRetirementEur / swr

  const now = new Date()
  const retirementDate = new Date(now)
  retirementDate.setFullYear(now.getFullYear() + (targetRetirementAge - currentAgeYears))

  const monthsToTarget = Math.max(
    0,
    (retirementDate.getFullYear() - now.getFullYear()) * 12 +
      (retirementDate.getMonth() - now.getMonth())
  )

  // Split accumulation at citizenship date
  const monthsPreCitizenship = Math.max(
    0,
    Math.min(
      monthsToTarget,
      (citizenshipDate.getFullYear() - now.getFullYear()) * 12 +
        (citizenshipDate.getMonth() - now.getMonth())
    )
  )
  const monthsPostCitizenship = Math.max(0, monthsToTarget - monthsPreCitizenship)

  const portfolioAtCitizenship = futureValue(
    currentPortfolioEur,
    preCitizenshipMonthlyNetSavingsEur,
    annualReturn,
    monthsPreCitizenship
  )

  const projectedPortfolioAtTarget = futureValue(
    portfolioAtCitizenship,
    postCitizenshipMonthlyNetSavingsEur,
    annualReturn,
    monthsPostCitizenship
  )

  const gapToFireNumber = Math.max(0, fireNumber - projectedPortfolioAtTarget)

  // PMT needed (flat, ignoring citizenship split) to hit FIRE number
  const monthlyPmtNeeded = solveForPMT(fireNumber, currentPortfolioEur, annualReturn, monthsToTarget)

  return {
    fireNumber,
    swr,
    retirementHorizonYears,
    portfolioAtRetirement: projectedPortfolioAtTarget,
    gapToFireNumber,
    monthsToTarget,
    monthlyPmtNeeded,
    projectedPortfolioAtTarget,
  }
}

// Sensitivity: for a range of gross USD incomes, what retirement age does each produce?
// Returns array of { grossUsd, retirementAge } for chart
export interface SensitivityPoint {
  grossUsd: number
  retirementAgeBear: number
  retirementAgeBase: number
  retirementAgeBull: number
}

export function calcSensitivity(
  currentAgeYears: number,
  currentPortfolioEur: number,
  annualExpensesEur: number,
  lifeExpectancy: number,
  // function: grossUsd → monthly net savings EUR (after tax + expenses)
  netSavingsFromGross: (grossUsd: number) => number,
  citizenshipDate: Date,
  postCitizenshipIncomeMultiplier: number,
  grossRange: [number, number],
  steps = 40,
  returnOverrides?: Partial<Record<ReturnScenario, number>>
): SensitivityPoint[] {
  const [minGross, maxGross] = grossRange
  const points: SensitivityPoint[] = []

  for (let i = 0; i <= steps; i++) {
    const grossUsd = minGross + (i / steps) * (maxGross - minGross)

    const getRetirementAge = (scenario: ReturnScenario): number => {
      const annualReturn = returnOverrides?.[scenario] ?? RETURN_RATES[scenario]
      const monthlySavings = netSavingsFromGross(grossUsd)
      const postSavings = netSavingsFromGross(grossUsd * postCitizenshipIncomeMultiplier)

      const now = new Date()
      const monthsPreCitizenship = Math.max(
        0,
        (citizenshipDate.getFullYear() - now.getFullYear()) * 12 +
          (citizenshipDate.getMonth() - now.getMonth())
      )

      // Binary search: find retirement age where projected portfolio ≥ FIRE number
      let lo = currentAgeYears
      let hi = currentAgeYears + 50

      for (let iter = 0; iter < 60; iter++) {
        const mid = (lo + hi) / 2
        const monthsToRetirement = Math.round((mid - currentAgeYears) * 12)
        const preMonths = Math.min(monthsToRetirement, monthsPreCitizenship)
        const postMonths = Math.max(0, monthsToRetirement - preMonths)

        const atCitizenship = futureValue(currentPortfolioEur, monthlySavings, annualReturn, preMonths)
        const atRetirement = futureValue(atCitizenship, postSavings, annualReturn, postMonths)

        const horizon = lifeExpectancy - mid
        const swr = swrForHorizon(horizon)
        const fireNum = annualExpensesEur / swr

        if (atRetirement >= fireNum) {
          hi = mid
        } else {
          lo = mid
        }
        if (hi - lo < 0.1) break
      }
      return Math.round((lo + hi) / 2 * 10) / 10
    }

    points.push({
      grossUsd,
      retirementAgeBear: getRetirementAge('bear'),
      retirementAgeBase: getRetirementAge('base'),
      retirementAgeBull: getRetirementAge('bull'),
    })
  }
  return points
}

// Portfolio trajectory: yearly snapshots from currentAge to maxAge
export interface TrajectoryPoint {
  age: number
  bear: number
  base: number
  bull: number
}

export function calcPortfolioTrajectory(
  currentAge: number,
  maxAge: number,
  currentPortfolioEur: number,
  preCitizenshipMonthlySavings: number,
  postCitizenshipMonthlySavings: number,
  citizenshipDate: Date,
  returnRates: Record<ReturnScenario, number>
): TrajectoryPoint[] {
  const now = new Date()
  const monthsPreCitizenship = Math.max(
    0,
    (citizenshipDate.getFullYear() - now.getFullYear()) * 12 +
      (citizenshipDate.getMonth() - now.getMonth())
  )

  const points: TrajectoryPoint[] = []
  for (let age = currentAge; age <= maxAge; age++) {
    const totalMonths = Math.round((age - currentAge) * 12)
    const preMonths = Math.min(totalMonths, monthsPreCitizenship)
    const postMonths = Math.max(0, totalMonths - preMonths)

    const calc = (rate: number) => {
      const atCit = futureValue(currentPortfolioEur, preCitizenshipMonthlySavings, rate, preMonths)
      return futureValue(atCit, postCitizenshipMonthlySavings, rate, postMonths)
    }

    points.push({
      age,
      bear: Math.round(calc(returnRates.bear)),
      base: Math.round(calc(returnRates.base)),
      bull: Math.round(calc(returnRates.bull)),
    })
  }
  return points
}

// Compute retirement age under current inputs
export function retirementAgeForScenario(
  currentAgeYears: number,
  currentPortfolioEur: number,
  annualExpensesEur: number,
  lifeExpectancy: number,
  preCitizenshipMonthlySavings: number,
  postCitizenshipMonthlySavings: number,
  citizenshipDate: Date,
  annualReturn: number
): number {
  const now = new Date()
  const monthsPreCitizenship = Math.max(
    0,
    (citizenshipDate.getFullYear() - now.getFullYear()) * 12 +
      (citizenshipDate.getMonth() - now.getMonth())
  )

  let lo = currentAgeYears
  let hi = currentAgeYears + 60

  for (let iter = 0; iter < 80; iter++) {
    const mid = (lo + hi) / 2
    const monthsToRetirement = Math.round((mid - currentAgeYears) * 12)
    const preMonths = Math.min(monthsToRetirement, monthsPreCitizenship)
    const postMonths = Math.max(0, monthsToRetirement - preMonths)

    const atCitizenship = futureValue(currentPortfolioEur, preCitizenshipMonthlySavings, annualReturn, preMonths)
    const atRetirement = futureValue(atCitizenship, postCitizenshipMonthlySavings, annualReturn, postMonths)

    const horizon = lifeExpectancy - mid
    const swr = swrForHorizon(Math.max(0, horizon))
    const fireNum = annualExpensesEur / swr

    if (atRetirement >= fireNum) {
      hi = mid
    } else {
      lo = mid
    }
    if (hi - lo < 0.05) break
  }
  return Math.round((lo + hi) / 2 * 10) / 10
}
