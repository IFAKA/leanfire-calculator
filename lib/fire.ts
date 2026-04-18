// FIRE accumulation engine — quant-correct model

export type ReturnScenario = 'bear' | 'base' | 'bull'

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
  steps = 40
): SensitivityPoint[] {
  const [minGross, maxGross] = grossRange
  const points: SensitivityPoint[] = []

  for (let i = 0; i <= steps; i++) {
    const grossUsd = minGross + (i / steps) * (maxGross - minGross)

    const getRetirementAge = (scenario: ReturnScenario): number => {
      const annualReturn = RETURN_RATES[scenario]
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

// Compute retirement age under current inputs (all 3 scenarios)
export function retirementAgeForScenario(
  currentAgeYears: number,
  currentPortfolioEur: number,
  annualExpensesEur: number,
  lifeExpectancy: number,
  preCitizenshipMonthlySavings: number,
  postCitizenshipMonthlySavings: number,
  citizenshipDate: Date,
  scenario: ReturnScenario
): number {
  const annualReturn = RETURN_RATES[scenario]
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
