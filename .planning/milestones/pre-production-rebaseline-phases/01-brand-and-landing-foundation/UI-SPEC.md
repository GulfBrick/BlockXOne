# UI-SPEC: BlockXOne Public, Investor, And Operator Surfaces

## Intent

Create a design contract for the rebuild that preserves the current BlockXOne identity while replacing the mixed, sprint-built visual structure with a clearer institutional product system.

## Design Principles

1. Explain before asking for action.
2. Separate public trust-building from authenticated work.
3. Keep investor flows calm and legible.
4. Keep operator flows dense but controlled.
5. Use brand glow as an accent, not as the whole design.

## Brand Preservation

### Keep

- user-supplied BX1 hex mark and metallic BLOCKXONE wordmark
- dark graphite foundation
- electric-cyan to deep-cyan accent range
- geometric and hexagonal cues

### Remove

- emoji-based trust markers
- overly generic crypto hero-video dependence
- mixed-role login affordances on public pages

## Typography

### Font stack

- Display: `Orbitron`
- Body: `Inter`
- Data: `JetBrains Mono`

### Usage

- Display font for hero headlines and key section titles only
- Body font for all copy, forms, navigation, and dense dashboards
- Mono font for addresses, transaction IDs, amounts, ledgers, and audit references

## Color Contract

### Base tokens

- `bg-canvas`: `#0B131B`
- `bg-surface`: `#0F1E28`
- `bg-surface-2`: `#132733`
- `line-subtle`: `rgba(123, 142, 162, 0.18)`
- `line-strong`: `rgba(39, 208, 247, 0.38)`
- `text-primary`: `#EAF6FF`
- `text-secondary`: `#B8C9D8`
- `text-tertiary`: `#7B8EA2`
- `accent-primary`: `#27D0F7`
- `accent-deep`: `#00B8E6`
- `success`: `#10B981`
- `warning`: `#F59E0B`
- `danger`: `#EF4444`

### Rules

- No raw hex values inside page components once the rebuild starts
- Public and app surfaces must share the same semantic tokens
- Status colors must never be the only signal for meaning

## Layout Contract

### Public

- max content width: `1440px`
- hero grid: 6 or 12 column responsive structure
- section spacing: `96px` desktop, `64px` tablet, `48px` mobile
- one primary CTA group per major section

### Investor

- top navigation with contextual page actions
- card-led information density
- summary first, details second
- no more than one primary workflow per screen

### Operator

- persistent sidebar on desktop
- page header with status summary and primary action
- data tables and split panels are first-class layouts
- audit or activity timeline visible on high-risk pages

## Component Direction

### Public components

- transparent nav with solid scroll state
- hero copy block
- lifecycle stepper
- asset-class cards
- trust and controls grid
- split CTA footer

### Investor components

- qualification banner
- portfolio summary cards
- asset detail tabs
- document list
- order and redemption timeline

### Operator components

- queue tables
- filter rails
- detail drawers
- confirmation modals
- audit event ribbons

## Interaction Rules

- Minimum hit target: `44px`
- Focus ring always visible
- Motion duration: `150ms` to `300ms`
- Page transitions should use opacity and transform only
- Buttons must show clear hover, pressed, disabled, and loading states

## Accessibility Contract

- body text minimum `16px`
- contrast minimum WCAG AA
- no icon-only interactive control without a label
- no critical information conveyed by color alone
- keyboard navigable public nav, auth, and table controls
- reduced-motion support required

## Public Route Contract

- `/` is education-first, not login-first
- `/investor/login` is for investor authentication only
- `/operator/login` is for staff and institutional operator authentication only
- public pages may tease capability, but never expose privileged actions

## Implementation Notes For Phase 2

- Use shared design tokens in one package
- Use Lucide or equivalent SVG icon set
- Use section diagrams and product cards instead of heavy decorative effects
- Keep the supplied brand mark visible in the navbar and hero
- Use subtle cyan illumination only where it helps hierarchy
- Treat `docs/brand/blockxone-brand-guide.png` as the visual authority
- Use the deterministic transparent derivatives in `apps/web/public/brand/`
