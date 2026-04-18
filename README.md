# LeanFIRE Calculator

**Quant-correct FIRE calculator for Spain autónomos** — dual-currency (USD/EUR), horizon-adjusted safe withdrawal rate, and Spain tax model built in.

🔗 **Live app**: [leanfire.vercel.app](https://leanfire.vercel.app)

---

## What makes this different

Standard FIRE calculators (Networthify, cFIREsim) fail for early retirees in three ways:

1. **Wrong SWR**: They hardcode 4% — valid for 30-year retirements, but a 25-year-old retiring at 30 faces a 60-year horizon. The correct SWR is **3.0%**, producing a meaningfully higher FIRE number.
2. **Wrong model phase**: SWR is a *withdrawal* tool. For a 5-year accumulation window, savings rate dominates returns ~7:1. This calculator uses the FV accumulation formula, not SWR, during the savings phase.
3. **No Spain tax model**: Autónomo IRPF brackets, cuota autónomos, deductible expenses, and quarterly Modelo 130 provisioning are all modeled — so the gross income target is real, not a napkin estimate.

## Features

- **FV accumulation model** — `FV = PV×(1+r)^n + PMT×((factor−1)/r)` with bear/base/bull scenarios (2%/4%/6% real)
- **Horizon-adjusted SWR** — 3.0% for 60yr, 3.25% for 50yr, 3.5% for 40yr, 3.75% for 35yr, 4.0% for 30yr
- **Spain autónomo tax engine** — 2025 IRPF brackets + cuota + binary-search gross back-solver
- **Live FX rate** — EUR/USD fetched from open.er-api.com, manual override available
- **Citizenship inflection** — split accumulation at any date (e.g. EU citizenship unlocking EU income)
- **Sensitivity chart** — retirement age vs. income across all 3 return scenarios
- **Floor obligation** — separates non-negotiable expenses (family support, rent) from discretionary

## Stack

- Next.js 15 (App Router)
- Recharts
- Tailwind CSS v4
- TypeScript

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Financial model

The core question this calculator answers: *"What gross monthly USD income must I earn, and for how long, to hit leanFIRE?"*

```
FIRE number  = annual_expenses_at_retirement / SWR(horizon)
Required PMT = solve FV formula for monthly savings
Required gross = back-calculate via Spain autónomo tax model
```

SWR table sourced from Early Retirement Now (ERN) and Portfolio Charts research.
