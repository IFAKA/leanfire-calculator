const FALLBACK_RATE = 0.92 // EUR per USD fallback

export async function fetchUsdToEur(): Promise<number> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { next: { revalidate: 3600 } })
    if (!res.ok) return FALLBACK_RATE
    const data = await res.json()
    return data?.rates?.EUR ?? FALLBACK_RATE
  } catch {
    return FALLBACK_RATE
  }
}

export function usdToEur(usd: number, rate: number): number {
  return usd * rate
}
