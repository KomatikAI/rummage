# Rummage design rules

Page lanes treat this file as law. Tokens live once in `app/globals.css`; primitives live in
`components/ui/` (import from `@/components/ui`). No inline styles, no hex values in pages, no
dark mode.

## Tokens

The default Tailwind palette is switched off: only these colours exist (`bg-*`, `text-*`, `border-*`).

| Token | Use |
|---|---|
| `paper` | Page background, warm paper |
| `paper-deep` | Sunken groups, hover fills, skeletons |
| `surface` | Cards, sheets, inputs, bars |
| `ink` / `ink-soft` / `ink-faint` | Body text / secondary text / fine print and placeholders |
| `line`, `grey-100..700` | Borders and quiet neutrals |
| `accent` / `accent-strong` / `accent-soft` / `on-accent` | The price sticker: primary actions, prices, active tab. `accent-strong` for accent text on paper |
| `ready` / `ready-strong` / `ready-soft` / `on-ready` | Paid, ready, collected |
| `held` / `held-soft` | Held items |
| `danger` / `danger-strong` / `danger-soft` / `on-danger` | Errors and destructive actions only |

Type: `font-display` (Fraunces, via next/font) for h1, h2, card titles, the wordmark and big
prices. `font-sans` (system) for everything else. One h1 per page, through `PageHeader`.

Sizes: `px-gutter` (16 px), `min-h-tap` / `size-tap` (44 px), `h-topbar`, `h-tabbar` / `pb-tabbar`
(includes the safe area), `max-w-content` (40rem) and `max-w-wide` (64rem). Spacing otherwise uses
Tailwind's 4 px steps. Shape: `rounded-sticker` (cards, sheets), `rounded-field` (inputs),
`rounded-pill` (buttons, badges). One shadow: `shadow-sticker`. Motion: `animate-sheet-up`.
Utility: `pb-safe` for the bottom safe area.

## Primitives (`@/components/ui`)

- `PageContainer` `{ width?: "content" | "wide" }`: every page's `<main>`, gutters and skip-link target.
- `PageHeader` `{ title, description?, eyebrow?, back?: { href, label }, actions? }`.
- `Button` `{ variant?: "primary" | "secondary" | "ghost" | "danger", size?: "sm" | "md" | "lg", fullWidth?, loading? }`,
  plus all `<button>` props and `ref`. Defaults to `type="button"`. One primary per screen.
- `ButtonLink`: same look on a `next/link`, for navigation. `buttonClasses(opts)` for anything else.
- `SubmitButton` `{ pendingLabel? }`: submit button that shows loading while its form's action runs.
- `Card` `{ padding?: "none" | "sm" | "md" | "lg", tone?: "surface" | "sunken" | "accent" }`, `CardTitle` `{ as?: "h2" | "h3" }`.
- `Badge` `{ status }` or `{ tone, children }`; children override the label.
- `Field` `{ label, children, hint?, error?, optional?, required?, id? }` wraps one `Input` or
  `Textarea` and wires id, `aria-describedby` and `aria-invalid`. `Label` `{ optional? }` for one-offs.
- `Input`, `Textarea` `{ invalid? }`, plus native props and `ref`.
- `Money` `{ amount, trimWholeDollars?, zeroLabel?, className? }` and `formatMoney(amount, opts)`.
  Amounts are **dollars** as `numeric(10,2)` returns them (number or string), never cents.
  Stickers: `trimWholeDollars` ("$5"). Totals and receipts: default ("$5.00").
- `EmptyState` `{ title, description?, icon?, action? }`: say what is missing and the one next step.
- `Sheet` `{ open, onClose, title, description?, footer?, closeLabel? }`: bottom sheet on phones, centred
  dialog on laptops. Focus stays inside, Escape and the backdrop close it, focus returns on close.
- `Spinner` `{ size?: "sm" | "md" | "lg", label? }`.
- `cn(...classes)` joins classes. It does not resolve conflicts, so prefer props over `className` overrides.

Shell (`components/`): `TopBar` (wordmark, sale name, laptop nav, sign-in control), `TabBar` (phones),
`SetSaleName` (`<SetSaleName name={sale.name} />` on a sale page puts the name in the top bar),
`NAV_ITEMS` and `NavIcon`.

Refs: React 19 passes `ref` as a normal prop, so the primitives take `ref` without `forwardRef`.

## Status colours

| Status | Badge look | Means |
|---|---|---|
| `available` | accent-soft, accent-strong text | Listed and for sale |
| `held` | held-soft, held text | In someone's cart, not yet paid |
| `sold` | grey-200, ink-soft text | Paid, or sold for cash |
| `collected` | ready-soft, ready-strong text | Picked up with the code |
| `ready` | solid ready, white text | Paid and ready for pickup; household can be paid |
| `pending` | dashed outline | Draft, hidden, or waiting on someone |

`itemStatusBadge(items.status)` maps database values (`listed` → available, `cash_sold` → sold,
`draft`/`hidden` → pending). `paypalStatusBadge(households.paypal_status)`: only `ready` is ready.
Never show status by colour alone: the badge always carries its word.

## Layout

- Phone first. Design at 390 px wide, then check a laptop. Nothing scrolls sideways.
- 16 px side gutters (`px-gutter`), through `PageContainer`.
- Every tap target is at least 44 px (`min-h-tap`). Buttons already are.
- The bottom tab bar (Browse, Cart, Sell, Organize) is on phones only; the layout already pads for
  it. Do not put fixed elements in the bottom 64 px on phones; a sticky action bar uses `bottom-tabbar md:bottom-0`.
- Secondary flows (item details, filters, confirm a hold, enter a pickup code) open in a `Sheet`,
  not a new page.
- Map + list pages use `PageContainer width="wide"`: stacked on phones, side by side from `md`.
- Read the session only inside a `<Suspense>` boundary (Cache Components is on).

## Voice

- Warm, plain, short sentences. Say what happens next.
- No exclamation marks. Never the word "human".
- Fictional demo data only: no real businesses, brands, people or places you could find.
- No third-party names or trademarks in our copy (payment buttons render their own). Say "checkout", "pay", "test mode".
- Errors say what went wrong and what to do: "That email and password do not match. Try again."
- Buttons are verbs: "Hold item", "Pay $24.00", "Show pickup code". Not "Submit" or "OK".
- Money always through `Money` or `formatMoney`, never hand-built strings.
