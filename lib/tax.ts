// Spain autónomo tax model 2025

export interface TaxInput {
  grossAnnualEur: number
  deductibleExpenses?: number // home office, phone, equipment, etc.
  isFirstYear?: boolean // tarifa plana: €80/mo first year
  isSecondYear?: boolean // graduated: ~€160/mo second year
}

export interface TaxResult {
  grossAnnual: number
  deductibleExpenses: number
  taxableBase: number
  irpfAnnual: number
  cuotaAnnual: number
  netAnnual: number
  netMonthly: number
  effectiveRate: number
}

// 2025 IRPF brackets (state + regional average, simplified)
const IRPF_BRACKETS = [
  { limit: 12450, rate: 0.19 },
  { limit: 20200, rate: 0.24 },
  { limit: 35200, rate: 0.30 },
  { limit: 60000, rate: 0.37 },
  { limit: Infinity, rate: 0.45 },
]

export function calcIRPF(taxableBase: number): number {
  if (taxableBase <= 0) return 0
  let tax = 0
  let prev = 0
  for (const bracket of IRPF_BRACKETS) {
    if (taxableBase <= prev) break
    const chunk = Math.min(taxableBase, bracket.limit) - prev
    tax += chunk * bracket.rate
    prev = bracket.limit
  }
  return tax
}

export function calcCuotaMonthly(isFirstYear: boolean, isSecondYear: boolean): number {
  if (isFirstYear) return 80
  if (isSecondYear) return 160
  return 294
}

export function calcTax(input: TaxInput): TaxResult {
  const { grossAnnualEur, deductibleExpenses = 0, isFirstYear = false, isSecondYear = false } = input
  const cuotaMonthly = calcCuotaMonthly(isFirstYear, isSecondYear)
  const cuotaAnnual = cuotaMonthly * 12

  // Cuota is deductible from taxable base for autónomos
  const taxableBase = Math.max(0, grossAnnualEur - deductibleExpenses - cuotaAnnual)
  const irpfAnnual = calcIRPF(taxableBase)

  const netAnnual = grossAnnualEur - irpfAnnual - cuotaAnnual
  const netMonthly = netAnnual / 12
  const effectiveRate = grossAnnualEur > 0 ? (irpfAnnual + cuotaAnnual) / grossAnnualEur : 0

  return {
    grossAnnual: grossAnnualEur,
    deductibleExpenses,
    taxableBase,
    irpfAnnual,
    cuotaAnnual,
    netAnnual,
    netMonthly,
    effectiveRate,
  }
}

// Back-solve: given required net monthly, what gross annual is needed?
export function grossNeededForNet(
  targetNetMonthly: number,
  deductibleExpenses: number,
  isFirstYear: boolean,
  isSecondYear: boolean,
  tolerance = 1
): number {
  let lo = targetNetMonthly * 12
  let hi = targetNetMonthly * 12 * 3 // upper bound with heavy tax

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    const result = calcTax({ grossAnnualEur: mid, deductibleExpenses, isFirstYear, isSecondYear })
    if (result.netMonthly < targetNetMonthly) {
      lo = mid
    } else {
      hi = mid
    }
    if (hi - lo < tolerance) break
  }
  return (lo + hi) / 2
}
