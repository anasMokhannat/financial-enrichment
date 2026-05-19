# frontend

Next.js 15 + TypeScript + Tailwind dashboard for the Flugia enrichment
product. Consumes the FastAPI backend in [`../backend/`](../backend/).

## Layout

```
frontend/
├── app/
│   ├── layout.tsx              global shell: TopBar + Sidebar
│   ├── page.tsx                Overview (hero + stat cards)
│   ├── search/page.tsx         search box + ambiguous-match dropdown
│   ├── companies/[cbe]/        company detail (server-rendered)
│   │   ├── page.tsx
│   │   └── not-found.tsx
│   └── globals.css             Tailwind base + selection colour
├── components/                 TopBar, Sidebar, HeroCard, StatCard, …
├── lib/
│   ├── api.ts                  fetch wrapper around the FastAPI backend
│   ├── types.ts                TypeScript mirror of the Pydantic models
│   └── cn.ts                   tailwind-merge helper
├── tailwind.config.ts          Flugia design tokens (brand cyan, ink, surface)
└── package.json
```

## Setup

```powershell
cd frontend
npm install
copy .env.local.example .env.local
# edit .env.local if your backend isn't at http://localhost:8000
npm run dev
```

Open <http://localhost:3000>. The dashboard expects the FastAPI service
to be reachable at `NEXT_PUBLIC_API_URL`; without it, the company
search will fail at request time.

## Design system

The look is lifted from the Flugia screenshot — colors, typography,
component proportions. Concretely:

- **Brand cyan**: `brand.500` (`#3CC0E9`) is the logo / primary CTA.
  Tints (`brand.50` to `brand.900`) are used for active states and
  badge backgrounds.
- **Ink**: `ink.DEFAULT` (`#0E1B33`) for body text, `ink.subtle` /
  `ink.muted` for secondary and tertiary copy.
- **Surface**: white base; `surface.sub` (`#F8FAFC`) for nested cards
  and search inputs; `surface.line` for hairline borders.
- **Hero gradient**: defined as `bg-hero-gradient` in Tailwind — a
  soft three-stop blue-to-white wash matching the "Prospecting
  Overview" banner in the original.

All Tailwind tokens live in [tailwind.config.ts](tailwind.config.ts).
Add new colours there rather than inline hex values.

## How the search ambiguity is handled

When KBO returns multiple matches for a name, the backend responds
with HTTP **409** and a body shaped like:

```json
{
  "detail": {
    "code": "ambiguous_match",
    "message": "12 KBO matches for 'flugia'; refine the query.",
    "candidates": [
      { "enterprise_number": "0712345678", "name": "FLUGIA BV" },
      ...
    ]
  }
}
```

[`lib/api.ts`](lib/api.ts) detects that 409 shape and throws an
`AmbiguousMatchApiError`; the search page catches it and renders a
clickable [`AmbiguousMatches`](components/AmbiguousMatches.tsx)
dropdown. Picking a candidate navigates to
`/companies/{enterprise_number}` — the detail page fetches by CBE,
which is unambiguous by definition.

## What's stubbed in this scaffold

The detail page renders the company header + a JSON dump of the
statements. The full ratios row, profitability/balance/trends charts,
and the legal-profile tab will be ported over from the Streamlit
dashboard in a follow-up session — a chart library (`recharts` is
likely best for Tailwind) will be added then.

Bulk search and refresh UX are not wired yet; the backend endpoints
exist (`POST /companies/bulk`, `POST /companies/{cbe}/refresh`) and
are typed in [`lib/types.ts`](lib/types.ts), so a future page only
needs to call `api.refreshCompany(cbe)` and render the response.
