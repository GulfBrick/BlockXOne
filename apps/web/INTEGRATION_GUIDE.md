# BlockXOne Design System - Integration Guide

## Quick Start

### Step 1: Import Design Tokens
The design tokens are already imported in `src/app/globals.css`. No action needed.

### Step 2: Install Toast Provider at App Root

In your main app layout (`src/app/layout.tsx`):

```tsx
import { ToastProvider } from '@/components/ui/toast'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  )
}
```

### Step 3: Use Components in Pages

```tsx
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { DataTable } from '@/components/ui/data-table'
import { StatCard } from '@/components/ui/stat-card'

export default function Dashboard() {
  return (
    <DashboardLayout
      navItems={navItems}
      userRole="admin"
      userName="John Doe"
    >
      <div className="space-y-8">
        <h1 className="text-3xl font-bold">Welcome</h1>

        <div className="grid grid-cols-4 gap-4">
          <StatCard value={1000000} label="AUM" />
          <StatCard value={42} label="Funds" />
          <StatCard value={284} label="Investors" />
          <StatCard value={8.5} label="Avg Return %" />
        </div>

        <DataTable columns={columns} data={data} />
      </div>
    </DashboardLayout>
  )
}
```

## Component Import Guide

### Core Components

#### Data Table
```tsx
import { DataTable } from '@/components/ui/data-table'
import type { DataTableProps } from '@/components/ui/data-table'

// Usage
<DataTable<FundType>
  columns={columns}
  data={funds}
  defaultPageSize={20}
  density="normal"
  onRowClick={handleRowClick}
/>
```

#### Stat Card
```tsx
import { StatCard } from '@/components/ui/stat-card'

<StatCard
  value={2500000}
  label="Total Assets"
  change={{ value: 12.5, isPositive: true }}
  icon={<DollarSign />}
  sparklineData={[100, 150, 120, 200, 180, 220, 210]}
/>
```

#### Status Badge
```tsx
import { StatusBadge } from '@/components/ui/status-badge'

<StatusBadge
  variant="success"
  label="Active"
  size="md"
  showDot
/>
```

#### Sidebar Navigation
```tsx
import { SidebarNav, type NavItem } from '@/components/ui/sidebar-nav'

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: <LayoutDashboard />,
  },
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
  items={navItems}
  userRole="admin"
  onItemClick={handleNavClick}
/>
```

#### Command Palette
```tsx
import { CommandPalette, type CommandItem } from '@/components/ui/command-palette'

const commands: CommandItem[] = [
  {
    id: 'dashboard',
    label: 'Go to Dashboard',
    description: 'View main dashboard',
    category: 'page',
    onSelect: () => router.push('/dashboard'),
  },
]

<CommandPalette items={commands} />
```

#### Chart Card
```tsx
import { ChartCard, SimpleLineChart } from '@/components/ui/chart-card'

<ChartCard
  title="AUM Trend"
  subtitle="Last 30 days"
  timeRange="30d"
  height="md"
>
  <SimpleLineChart
    data={chartData}
    dataKey="value"
    xAxisKey="date"
  />
</ChartCard>
```

#### Toast System
```tsx
import { useToast, useToastShortcuts } from '@/components/ui/toast'

function MyComponent() {
  const { addToast } = useToast()
  const toast = useToastShortcuts()

  const handleSuccess = () => {
    // Method 1: Generic addToast
    addToast('Success!', {
      variant: 'success',
      description: 'Operation completed',
      duration: 5000,
    })

    // Method 2: Convenience shortcuts
    toast.success('Success!', 'Operation completed')
    toast.error('Error!', 'Something went wrong')
    toast.warning('Warning!', 'Please review')
    toast.info('Info', 'New information')
  }

  return <button onClick={handleSuccess}>Action</button>
}
```

#### Dashboard Layout
```tsx
import { DashboardLayout } from '@/components/layout/dashboard-layout'

<DashboardLayout
  navItems={navItems}
  userRole="admin"
  currentPath="/dashboard"
  userName="John Doe"
  userAvatar="/avatar.jpg"
  onLogout={handleLogout}
  notificationCount={3}
  onNotificationClick={handleNotifications}
  showSearch
  onSearch={handleSearch}
  breadcrumbs={[
    { label: 'Dashboard', href: '/' },
    { label: 'Reports' },
  ]}
  footerItems={[
    { label: 'API', status: 'operational' },
    { label: 'Database', status: 'operational' },
  ]}
>
  <YourPageContent />
</DashboardLayout>
```

## Design Tokens Usage

### Via CSS Variables

```css
.my-element {
  /* Colors */
  background: var(--bxo-bg-primary);
  color: var(--bxo-text-primary);
  border: 1px solid var(--bxo-border-default);

  /* Spacing */
  padding: var(--bxo-space-4);
  margin: var(--bxo-space-6);

  /* Borders & Radius */
  border-radius: var(--bxo-radius-lg);

  /* Shadows */
  box-shadow: var(--bxo-shadow-md);

  /* Animations */
  transition: all var(--bxo-duration-base) var(--bxo-ease-out);
}
```

### Via Tailwind Classes

```tsx
<div className="bg-bxo-surface border border-bxo-border-subtle rounded-lg p-6 shadow-md text-bxo-text-primary">
  <h2 className="text-2xl font-bold mb-4">Title</h2>
  <p className="text-bxo-text-secondary">Subtitle</p>
</div>
```

### Available Tailwind Classes

#### Colors
- `bg-bxo-*` / `text-bxo-*`
- `border-bxo-*`
- Variants: bg-primary, surface, surface-secondary, surface-elevated, accent-primary, success, warning, danger, info, text-primary, text-secondary, text-tertiary, text-disabled, border-subtle, border-default, border-strong, divider

#### Spacing
- `p-*` / `m-*` for padding/margin (0-24+)
- `gap-*` for flexbox/grid gaps
- Example: `p-4` (16px), `gap-8` (32px)

#### Border Radius
- `rounded-none`, `rounded-xs`, `rounded-sm`, `rounded-base`, `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-full`

#### Shadows
- `shadow-xs` through `shadow-xl`
- `shadow-accent-sm` through `shadow-accent-lg`

#### Font Families
- `font-display` / `font-ui` (Archivo product typography)
- `font-editorial` (Abril Fatface selected public display)
- `font-reading` (STIX Two Text editorial copy)
- `font-mono` (JetBrains Mono)
- `font-sans` (Archivo default UI font)

#### Animations
- `animate-fade-in`
- `animate-slide-up`
- `animate-slide-down`
- `animate-scale-in`
- `animate-pulse-subtle`

## Common Patterns

### Card Component
```tsx
<div className="bg-bxo-surface border border-bxo-border-subtle rounded-lg p-6 hover:border-bxo-accent-primary/30 transition-colors">
  <h3 className="text-lg font-semibold text-bxo-text-primary mb-2">Card Title</h3>
  <p className="text-sm text-bxo-text-secondary">Card content</p>
</div>
```

### Button Variants
```tsx
// Primary
<button className="px-4 py-2 bg-bxo-accent-primary text-white rounded-lg hover:bg-bxo-accent-primary-dark transition-colors">
  Primary Button
</button>

// Secondary
<button className="px-4 py-2 bg-bxo-surface border border-bxo-border-default text-bxo-text-primary rounded-lg hover:bg-bxo-surface-elevated transition-colors">
  Secondary Button
</button>

// Danger
<button className="px-4 py-2 bg-bxo-danger/10 text-bxo-danger rounded-lg hover:bg-bxo-danger/20 transition-colors">
  Danger Button
</button>
```

### Input Field
```tsx
<input
  type="text"
  placeholder="Enter text..."
  className="w-full px-4 py-2 bg-bxo-surface border border-bxo-border-default rounded-lg text-bxo-text-primary placeholder-bxo-text-tertiary focus:outline-none focus:ring-2 focus:ring-bxo-accent-primary"
/>
```

### Loading State
```tsx
<div className="h-10 w-32 bg-bxo-surface-elevated rounded skeleton" />
```

### Glass Morphism
```tsx
<div className="glass-base border border-bxo-border-subtle rounded-lg p-6">
  Blurred background content
</div>
```

## Type Definitions

### For Custom Data Tables

```tsx
type DataRow = {
  id: string
  name: string
  amount: number
  status: 'active' | 'inactive'
}

const columns: ColumnDef<DataRow>[] = [
  {
    header: 'Name',
    accessorKey: 'name',
  },
  {
    header: 'Amount',
    accessorKey: 'amount',
    cell: (info) => `$${info.getValue().toLocaleString()}`,
  },
  {
    header: 'Status',
    accessorKey: 'status',
    cell: (info) => (
      <StatusBadge
        variant={info.getValue() === 'active' ? 'success' : 'neutral'}
        label={info.getValue()}
        size="sm"
      />
    ),
  },
]
```

### Navigation Items

```tsx
interface NavItem {
  label: string
  href?: string
  icon?: React.ReactNode
  children?: NavItem[]
  requiredRole?: string | string[]
  badge?: string | number
  action?: () => void
}
```

### Command Items

```tsx
interface CommandItem {
  id: string
  label: string
  description?: string
  category: 'page' | 'action' | 'setting'
  icon?: React.ReactNode
  shortcut?: string
  onSelect: () => void
}
```

## Migration Tips

### From Old Design System

```tsx
// Old
<div className="bg-blue-600 text-white">Old Button</div>

// New
<div className="bg-bxo-accent-primary text-white">New Button</div>

// Old
<h2 className="text-blue-500">Old Title</h2>

// New
<h2 className="text-bxo-accent-primary">New Title</h2>

// Old
<div className="p-4 rounded-md shadow-md">Old Card</div>

// New
<div className="p-4 rounded-lg shadow-md bg-bxo-surface border border-bxo-border-subtle">
  New Card
</div>
```

## Best Practices

1. **Always use design tokens** for colors, spacing, and shadows
2. **Prefer semantic colors** (success, warning, error) over brand colors
3. **Use the spacing scale** for consistency (don't use random pixel values)
4. **Implement accessibility** (ARIA labels, keyboard navigation)
5. **Keep animations under 500ms** for better perceived performance
6. **Use TypeScript** for component props
7. **Test in dark mode** (it's the default)
8. **Responsive design** - test on mobile, tablet, desktop
9. **Loading states** - always include skeleton loaders
10. **Error handling** - use toast notifications for user feedback

## Performance Tips

- Components use React.memo where appropriate
- Lazy load heavy components with Next.js dynamic imports
- Use useCallback for event handlers in data-heavy components
- TanStack React Table is optimized for large datasets
- CSS is scoped to prevent style conflicts

## Accessibility

All components include:
- Semantic HTML elements
- ARIA labels where needed
- Keyboard navigation support
- Focus management
- Color contrast ratios >= 4.5:1
- Reduced motion support

## Testing

When testing components:

1. **Visual Testing**: Check in dark mode (default)
2. **Keyboard Navigation**: Test Cmd+K for command palette
3. **Responsive**: Test at 320px, 768px, 1024px, 1440px widths
4. **Accessibility**: Use browser accessibility inspector
5. **Performance**: Check bundle size impact

## Troubleshooting

### Styles not applying?
- Ensure design tokens CSS is imported: `@import '../styles/design-tokens.css'`
- Check that ToastProvider is wrapped around your app
- Verify Tailwind is processing your JSX files (check content in tailwind.config.ts)

### Colors look different?
- Ensure dark mode class strategy is enabled in tailwind.config.ts
- Check browser color profile settings
- Verify you're using `--bxo-*` variables, not hardcoded colors

### Components not responsive?
- Check viewport meta tag in HTML
- Test with browser dev tools device emulation
- Verify tailwind responsive prefixes (sm:, md:, lg:)

### TypeScript errors?
- Ensure components are typed with React.ReactNode or JSX.Element
- Check that context providers are properly typed
- Verify generic type parameters are passed correctly

## Support Resources

1. **Documentation**: See DESIGN_SYSTEM.md for complete reference
2. **Examples**: Check DesignSystemShowcase.tsx for usage examples
3. **Type Definitions**: Review component props interfaces
4. **Tailwind Docs**: https://tailwindcss.com (for class utilities)
5. **React Docs**: https://react.dev (for hooks and patterns)

## File Locations

```
apps/web/
├── src/
│   ├── styles/
│   │   └── design-tokens.css
│   ├── components/
│   │   ├── ui/
│   │   │   ├── data-table.tsx
│   │   │   ├── stat-card.tsx
│   │   │   ├── status-badge.tsx
│   │   │   ├── sidebar-nav.tsx
│   │   │   ├── command-palette.tsx
│   │   │   ├── chart-card.tsx
│   │   │   └── toast.tsx
│   │   ├── layout/
│   │   │   └── dashboard-layout.tsx
│   │   └── examples/
│   │       └── DesignSystemShowcase.tsx
│   └── app/
│       └── globals.css
├── tailwind.config.ts
├── DESIGN_SYSTEM.md
└── INTEGRATION_GUIDE.md
```

---

**Ready to use! Start building with BlockXOne Design System.**
