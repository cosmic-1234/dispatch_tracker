# Shakti SCM — Dispatch Tracker (Product Requirements & Change Log)

## Original Problem Statement
> "Hi, dispatch_tracker is a tool which I made for Tracking POs inventory etc. My whole app is ready and already into the main branch of the repo dispatch_tracker which I have connected... now I want a whole UI revamp according to the best UI standards. No functionality change only UI and UX change every other thing should be exactly as it is but the portal should look like a best UI ux thing with beautiful detailing and awesome User experience I again say no functionality changes. Live at https://dispatch-planning-portal.onrender.com/"

## User-Confirmed Choices (Session 1)
- Design aesthetic: "Let the design agent decide the best fit"
- Theme mode: **Light + Dark with toggle**
- Codebase source: GitHub `cosmic-1234/dispatch_tracker` (already synced to Emergent workspace)
- Scope: Everything (login, dashboard, tables, forms, modals, navigation)
- Brand elements: Keep **SHAKTI SCM** brand name and current logo as-is

## Architecture
- Frontend: **React 19 + Vite 7** (`/app/frontend`) — Fontshare Cabinet Grotesk/Satoshi + JetBrains Mono
- Backend: **Node.js Express** (`/app/backend`) — SQLite by default, PostgreSQL via `DATABASE_URL`
- Deployment: Render (single-service; frontend build served alongside `/api/*` routes)

## Personas
- **SCM Director / Dispatch Planner** — daily operational user of dashboard, PO board, dispatch consolidation runs, inventory reconciliation.
- **Customer** (external self-service portal at `/?portal=customer`) — views commitments/dispatch status.

## Core Requirements (static)
- Left sidebar navigation with 3 sections (Operations / Intelligence / Administration), collapsible.
- Top header with brand, simulated system-date badge, refresh, AI Agent toggle, **theme toggle**.
- Global dismissible banners (unconfirmed snapshots, shortage warning, missed commitments).
- Modules preserved 1:1: Dashboard, PO Management, Dispatch Planning, Inventory Management, Production Plan, Commitment Health, Reports, Company Master, Portal Settings, Data Import, Customer Portal.
- Right-side AI Dispatch Assistant chat panel powered by OpenRouter (existing).
- Status/tier/health color semantics unchanged; only styling refreshed.

## What Was Implemented (Session 1 — Jan 23, 2026 — UI/UX Revamp)
- **Full design-system rewrite in `/app/frontend/src/index.css`** with light + dark tokens on `[data-theme]`.
- **Typography**: Cabinet Grotesk (display) + Satoshi (UI) + JetBrains Mono (data) via Fontshare/Google.
- **Refined chrome**: warm neutral off-white background, refined navy sidebar with subtle radial glow and emerald active-state indicator.
- **Cards & stat tiles** with lift-on-hover, radial highlight, tabular numerics.
- **Tables**: refined `.sap-table` with sticky headers, uppercase micro-labels, hover state, zebra alt-rows.
- **Badges/pills**: modernised status, tier, health, commitment badges with harmonised color pairs in both themes.
- **Buttons**: pill-radius, spring press, layered shadow; primary emerald anchor.
- **Forms**: 8-radius inputs, focus ring `rgba(15,90,78,.22)`, custom select chevron per theme.
- **Modals/toasts/banners**: soft-enter animations, colored left borders, glass overlay.
- **AI Chat**: cleaner bubbles, radial-glow background, refined provider tag.
- **Dark mode**: full palette + comprehensive CSS overrides for hardcoded inline panel colors (`rgb(248,250,252)`, `#FAFBFD`, etc.).
- **Theme toggle** in header, persisted to `localStorage` (`shakti-theme`), honors OS `prefers-color-scheme` on first load.
- **Micro-motion**: 220ms ease-out entrance for banners/modals/toast/messages; nav-icon shift on hover; hoverable stat-card lift.
- **Testability**: `data-testid` added to key interactives (`theme-toggle-btn`, `nav-*`, `ai-chat-*`, `header-*`).

### Zero Functional Changes
- No API contract changes.
- No component logic changes beyond the theme state and lucide icon swaps (`Sparkles`, `Moon`, `Sun`).
- All original class names preserved so existing components inherit new tokens automatically.

## Files Touched
- `/app/frontend/src/index.css` (rewritten)
- `/app/frontend/src/App.jsx` (theme state, toggle button, brand tweaks, lucide additions, data-testids)
- `/app/frontend/vite.config.js` (dev-server host/hmr for emergent preview)
- `/app/frontend/package.json` (added `start` script alias for supervisor compatibility)
- `/app/frontend/.env` (created — `VITE_API_BASE_URL=/api` for same-origin deployment)

## Prioritized Backlog / Not in Scope
- **P2**: replace remaining hardcoded inline colors inside individual component JSX with CSS variables so dark mode is edge-case-perfect without attribute-selector overrides.
- **P2**: keyboard-nav testing across modals + drawer.
- **P2**: PO-detail expandable row transitions.
- **P2**: extract shared card / stat components.

## Next Action Items
- Push to GitHub via the "Save to GitHub" chat feature so Render redeploys the revamped UI.
- Optional: A/B compare with users, or ship a subtle color-accent chooser (emerald / indigo / amber) as a "corporate theme" preset.
