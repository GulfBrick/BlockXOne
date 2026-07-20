# BlockXOne Design System

## Overview

BlockXOne features an institutional-grade UI design system combining a Bloomberg-meets-Stripe aesthetic with a dark-first philosophy. The design prioritizes clarity, efficiency, and premium presentation suitable for institutional finance applications.

## Color Palette

### Primary Background
- **--bxo-bg-primary**: `#0B0F1A` - Deep navy-black base background
- **--bxo-surface**: `#111827` - Primary surface for cards and panels
- **--bxo-surface-secondary**: `#161f36` - Secondary surface
- **--bxo-surface-elevated**: `#1F2937` - Elevated surfaces for depth

### Accent Colors
- **--bxo-accent-primary**: `#3B82F6` - Electric blue (primary CTA)
- **--bxo-accent-primary-dark**: `#2563EB` - Darker blue for hover states
- **--bxo-accent-primary-light**: `#60A5FA` - Lighter blue for disabled/secondary states

### Semantic Colors
- **Success**: `#10B981` (green) - Positive status, confirmations
- **Warning**: `#F59E0B` (amber) - Caution, warnings
- **Danger**: `#EF4444` (red) - Errors, critical actions
- **Info**: `#06B6D4` (cyan) - Informational states

### Text Colors
- **--bxo-text-primary**: `#F9FAFB` - Primary text
- **--bxo-text-secondary**: `#9CA3AF` - Secondary text
- **--bxo-text-tertiary**: `#6B7280` - Tertiary text
- **--bxo-text-disabled**: `#4B5563` - Disabled text

### Borders & Dividers
- **--bxo-border-subtle**: `#1F2937` - Subtle borders
- **--bxo-border-default**: `#2D3748` - Default borders
- **--bxo-border-strong**: `#4B5563` - Strong borders
- **--bxo-divider**: `rgba(255, 255, 255, 0.06)` - Divider lines

## Spacing Scale

4px base unit:
```
--bxo-space-1: 4px
--bxo-space-2: 8px
--bxo-space-3: 12px
--bxo-space-4: 16px
--bxo-space-5: 20px
--bxo-space-6: 24px
--bxo-space-8: 32px
--bxo-space-10: 40px
--bxo-space-12: 48px
```

## Border Radius

```
--bxo-radius-xs: 2px
--bxo-radius-sm: 4px
--bxo-radius-base: 6px
--bxo-radius-md: 8px
--bxo-radius-lg: 12px
--bxo-radius-xl: 16px
--bxo-radius-2xl: 20px
--bxo-radius-full: 9999px
```

## Shadows

```
--bxo-shadow-xs: 0 1px 2px 0 rgba(0, 0, 0, 0.05)
--bxo-shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.1)
--bxo-shadow-base: 0 4px 6px -1px rgba(0, 0, 0, 0.1)
--bxo-shadow-md: 0 10px 15px -3px rgba(0, 0, 0, 0.1)
--bxo-shadow-lg: 0 20px 25px -5px rgba(0, 0, 0, 0.1)
--bxo-shadow-xl: 0 25px 50px -12px rgba(0, 0, 0, 0.25)

/* Accent shadows for emphasis */
--bxo-shadow-accent-sm: 0 0 8px rgba(59, 130, 246, 0.2)
--bxo-shadow-accent-md: 0 0 16px rgba(59, 130, 246, 0.3)
--bxo-shadow-accent-lg: 0 0 24px rgba(59, 130, 246, 0.4)
```

## Typography

### Font Families
- **UI**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto'...` (system fonts)
- **Mono**: `'JetBrains Mono', 'Fira Code'...` (for data/numbers)

### Font Sizes
```
--bxo-text-xs: 12px
--bxo-text-sm: 14px
--bxo-text-base: 16px
--bxo-text-lg: 18px
--bxo-text-xl: 20px
--bxo-text-2xl: 24px
--bxo-text-3xl: 30px
--bxo-text-4xl: 36px
```

### Line Heights
```
--bxo-line-height-tight: 1.2
--bxo-line-height-snug: 1.375
--bxo-line-height-normal: 1.5
--bxo-line-height-relaxed: 1.625
--bxo-line-height-loose: 2
```

## Animations

### Durations
```
--bxo-duration-xfast: 75ms
--bxo-duration-fast: 100ms
--bxo-duration-base: 200ms
--bxo-duration-slow: 300ms
--bxo-duration-slower: 500ms
```

### Easing Functions
```
--bxo-ease-linear: linear
--bxo-ease-in: cubic-bezier(0.4, 0, 1, 1)
--bxo-ease-out: cubic-bezier(0, 0, 0.2, 1)
--bxo-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)
--bxo-ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55)
```

### Keyframe Animations
- `fade-in`: Opacity fade from 0 to 1
- `slide-up`: Slide with fade from bottom
- `slide-down`: Slide with fade from top
- `scale-in`: Scale and fade from 95%
- `pulse-subtle`: Subtle pulse opacity

## Components

### Data Table (`src/components/ui/data-table.tsx`)
Institutional data table with:
- Sortable columns (click header to toggle)
- Pagination with customizable page sizes
- Row selection support
- Loading skeleton states
- Empty state messaging
- Column visibility control
- Density options (compact, normal, spacious)

```tsx
import { DataTable } from '@/components/ui/data-table'

const columns = [
  { header: 'Name', accessorKey: 'name' },
  { header: 'Amount', accessorKey: 'amount' },
]

<DataTable
  columns={columns}
  data={data}
  defaultPageSize={20}
  onRowClick={(row) => handleRowClick(row)}
  density="normal"
/>
```

### Stat Card (`src/components/ui/stat-card.tsx`)
Dashboard KPI card with:
- Animated number counter
- Trend indicator (up/down/stable)
- 7-day sparkline chart
- Icon slot
- Loading skeleton

```tsx
import { StatCard } from '@/components/ui/stat-card'

<StatCard
  value={1250000}
  label="Total Assets"
  change={{ value: 12.5, isPositive: true }}
  icon={<DollarSign />}
  sparklineData={[100, 150, 120, 200, 180, 220, 210]}
/>
```

### Status Badge (`src/components/ui/status-badge.tsx`)
Status indicators with variants:
- `success`: Positive status (green)
- `warning`: Caution status (amber)
- `error`: Error status (red)
- `info`: Informational status (cyan)
- `pending`: Loading/processing status (blue with animation)
- `neutral`: Neutral status (gray)

```tsx
import { StatusBadge } from '@/components/ui/status-badge'

<StatusBadge variant="success" label="Active" size="md" showDot animated={false} />
<StatusBadge variant="pending" label="Processing" size="md" animated={true} />
```

### Sidebar Navigation (`src/components/ui/sidebar-nav.tsx`)
Institutional sidebar with:
- Collapsible sections
- Active state indicators (left border accent)
- Role-based visibility
- Mobile responsive (slide-out drawer)
- Badge support for counts
- Icon + label layout

```tsx
import { SidebarNav } from '@/components/ui/sidebar-nav'

const items = [
  { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard /> },
  {
    label: 'Funds',
    icon: <Wallet />,
    children: [
      { label: 'Active', href: '/funds/active' },
      { label: 'Closed', href: '/funds/closed' },
    ],
  },
]

<SidebarNav
  items={items}
  userRole="admin"
  onItemClick={(item) => console.log(item)}
/>
```

### Command Palette (`src/components/ui/command-palette.tsx`)
Cmd+K command palette with:
- Keyboard navigation (↑↓ arrows, Enter to select)
- Category grouping (pages, actions, settings)
- Recent items tracking
- Blur backdrop modal
- Search filtering

```tsx
import { CommandPalette } from '@/components/ui/command-palette'

const commands = [
  {
    id: 'dashboard',
    label: 'Go to Dashboard',
    category: 'page',
    description: 'View main dashboard',
    onSelect: () => router.push('/dashboard'),
  },
]

<CommandPalette items={commands} />
```

### Dashboard Layout (`src/components/layout/dashboard-layout.tsx`)
Master layout component with:
- Collapsible sidebar navigation
- Top bar with search, notifications, user menu
- Breadcrumb navigation
- System status footer
- Responsive design

```tsx
import { DashboardLayout } from '@/components/layout/dashboard-layout'

<DashboardLayout
  navItems={navItems}
  userRole="admin"
  userName="John Doe"
  breadcrumbs={[
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Funds' },
  ]}
  footerItems={[
    { label: 'API', status: 'operational' },
    { label: 'Database', status: 'operational' },
  ]}
>
  <YourContent />
</DashboardLayout>
```

### Chart Card (`src/components/ui/chart-card.tsx`)
Chart wrapper with:
- Time range selector (1d, 7d, 30d, 90d, all)
- Expand button for full-screen
- Loading skeleton
- Auto-updating timestamp
- SVG line chart helper

```tsx
import { ChartCard, SimpleLineChart } from '@/components/ui/chart-card'

<ChartCard
  title="Assets Under Management"
  subtitle="Historical trend"
  timeRange="30d"
  onTimeRangeChange={(range) => fetchData(range)}
  height="md"
>
  <SimpleLineChart
    data={chartData}
    dataKey="value"
    xAxisKey="date"
  />
</ChartCard>
```

### Toast Notifications (`src/components/ui/toast.tsx`)
Toast notification system with:
- Variants: success, error, warning, info
- Auto-dismiss with progress bar
- Stack management (max 3 visible)
- Optional action button
- Animated entry

```tsx
import { ToastProvider, useToast } from '@/components/ui/toast'

function MyComponent() {
  const { addToast } = useToast()

  const handleSuccess = () => {
    addToast('Operation successful', {
      variant: 'success',
      description: 'Your changes have been saved',
      duration: 5000,
    })
  }

  return <button onClick={handleSuccess}>Save</button>
}
```

Wrap your app with `ToastProvider`:
```tsx
<ToastProvider>
  <App />
</ToastProvider>
```

## Usage Examples

### Accessing Design Tokens

#### Via CSS Variables
```css
.my-element {
  background: var(--bxo-bg-primary);
  color: var(--bxo-text-primary);
  border: 1px solid var(--bxo-border-default);
  border-radius: var(--bxo-radius-lg);
  padding: var(--bxo-space-4);
  box-shadow: var(--bxo-shadow-md);
  transition: all var(--bxo-duration-base) var(--bxo-ease-out);
}
```

#### Via Tailwind Classes
```tsx
<div className="bg-bxo-surface border border-bxo-border-subtle rounded-lg p-4 shadow-md text-bxo-text-primary hover:border-bxo-accent-primary">
  Your content here
</div>
```

### Common Patterns

#### Card Component
```tsx
<div className="bg-bxo-surface border border-bxo-border-subtle rounded-lg p-6 hover:border-bxo-accent-primary/30 transition-colors">
  <h3 className="text-lg font-semibold text-bxo-text-primary mb-2">
    Title
  </h3>
  <p className="text-sm text-bxo-text-secondary">Content</p>
</div>
```

#### Interactive Button
```tsx
<button className="px-4 py-2 bg-bxo-accent-primary text-white rounded-lg hover:bg-bxo-accent-primary-dark transition-colors focus-ring">
  Click me
</button>
```

#### Loading State
```tsx
<div className="h-10 bg-bxo-surface-elevated rounded skeleton" />
```

#### Glass Morphism
```tsx
<div className="glass-base border border-bxo-border-subtle rounded-lg p-6">
  Blurred background content
</div>
```

## Z-Index Scale

```
--bxo-z-hide: -1
--bxo-z-auto: auto
--bxo-z-0: 0
--bxo-z-10: 10
--bxo-z-20: 20
--bxo-z-30: 30
--bxo-z-40: 40
--bxo-z-50: 50
--bxo-z-dropdown: 1000
--bxo-z-sticky: 1020
--bxo-z-fixed: 1030
--bxo-z-modal: 1040
--bxo-z-popover: 1050
--bxo-z-tooltip: 1060
```

## Accessibility

All components include:
- Semantic HTML (`button`, `nav`, `main`, etc.)
- ARIA labels for interactive elements
- Keyboard navigation support
- Focus management
- Proper color contrast ratios
- Reduced motion support

## Configuration Files

### Design Tokens
- **File**: `src/styles/design-tokens.css`
- **Purpose**: Central CSS custom properties for the entire design system
- **Scope**: Colors, spacing, typography, shadows, animations

### Tailwind Configuration
- **File**: `tailwind.config.ts`
- **Purpose**: Extends Tailwind with custom design token values
- **Features**: Custom colors, spacing, fonts, animations, shadows

### Global Styles
- **File**: `src/app/globals.css`
- **Purpose**: Imports design tokens and applies base styles
- **Includes**: Dark mode setup, utility classes, gradient definitions

## Best Practices

1. **Use Design Tokens**: Always use CSS variables for colors, spacing, etc.
2. **Semantic HTML**: Use proper HTML elements for structure
3. **Color Intent**: Use semantic colors (success, warning, error) rather than brand colors
4. **Spacing**: Use the spacing scale for consistency
5. **Animations**: Keep animations under 500ms for responsiveness
6. **Accessibility**: Include ARIA labels and keyboard support
7. **Performance**: Lazy load components and use code splitting
8. **Testing**: Test components in light/dark modes

## Migration Guide

If updating an existing codebase:

1. **Import design tokens** in `globals.css`:
   ```css
   @import '../styles/design-tokens.css';
   ```

2. **Update color references** from old system to new:
   ```tsx
   // Old
   className="bg-blue-600"

   // New
   className="bg-bxo-accent-primary"
   ```

3. **Use new components** instead of custom implementations:
   ```tsx
   // Old
   <CustomDataTable />

   // New
   <DataTable columns={columns} data={data} />
   ```

## Support & Contribution

For design system questions or improvements:
1. Check existing component documentation
2. Review component source code for implementation details
3. Test with different screen sizes and browsers
4. Submit feedback for new component requests

---

**Design System Version**: 1.0.0
**Last Updated**: March 29, 2024
**Maintenance**: BlockXOne Core Team
