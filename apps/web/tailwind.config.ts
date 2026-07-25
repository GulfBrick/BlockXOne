import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        /* Existing shadcn/ui colors */
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        brand: {
          cyan: 'var(--bxo-accent-primary)',
          'cyan-deep': 'var(--bxo-accent-primary-dark)',
          dark: 'var(--bxo-bg-primary)',
          surface: 'var(--bxo-surface)',
          steel: 'var(--bxo-text-tertiary)',
          frost: 'var(--bxo-text-primary)',
        },

        /* BlockXOne Design System Colors */
        bxo: {
          'bg-primary': 'var(--bxo-bg-primary)',
          'bg-secondary': 'var(--bxo-bg-secondary)',
          'surface': 'var(--bxo-surface)',
          'surface-secondary': 'var(--bxo-surface-secondary)',
          'surface-elevated': 'var(--bxo-surface-elevated)',

          'accent-primary': 'var(--bxo-accent-primary)',
          'accent-primary-dark': 'var(--bxo-accent-primary-dark)',
          'accent-primary-light': 'var(--bxo-accent-primary-light)',
          'accent-soft': 'var(--bxo-accent-soft)',
          'accent-muted': 'var(--bxo-accent-muted)',
          'accent-border': 'var(--bxo-accent-border)',

          'success': 'var(--bxo-success)',
          'success-dark': 'var(--bxo-success-dark)',
          'success-light': 'var(--bxo-success-light)',

          'warning': 'var(--bxo-warning)',
          'warning-dark': 'var(--bxo-warning-dark)',
          'warning-light': 'var(--bxo-warning-light)',

          'danger': 'var(--bxo-danger)',
          'danger-dark': 'var(--bxo-danger-dark)',
          'danger-light': 'var(--bxo-danger-light)',

          'info': 'var(--bxo-info)',
          'info-dark': 'var(--bxo-info-dark)',
          'info-light': 'var(--bxo-info-light)',

          'text-primary': 'var(--bxo-text-primary)',
          'text-secondary': 'var(--bxo-text-secondary)',
          'text-tertiary': 'var(--bxo-text-tertiary)',
          'text-disabled': 'var(--bxo-text-disabled)',

          'border-subtle': 'var(--bxo-border-subtle)',
          'border-default': 'var(--bxo-border-default)',
          'border-strong': 'var(--bxo-border-strong)',
          'divider': 'var(--bxo-divider)',
        },
      },
      spacing: {
        ...Object.fromEntries(
          Array.from({ length: 25 }, (_, i) => {
            const key = i === 0 ? '0' : i;
            return [key.toString(), `var(--bxo-space-${key})`];
          })
        ),
      },
      borderRadius: {
        'none': 'var(--bxo-radius-none)',
        'xs': 'var(--bxo-radius-xs)',
        'sm': 'var(--bxo-radius-sm)',
        'base': 'var(--bxo-radius-base)',
        'md': 'var(--bxo-radius-md)',
        'lg': 'var(--bxo-radius-lg)',
        'xl': 'var(--bxo-radius-xl)',
        '2xl': 'var(--bxo-radius-2xl)',
        'full': 'var(--bxo-radius-full)',
      },
      fontFamily: {
        'display': 'var(--bxo-font-display)',
        'ui': 'var(--bxo-font-ui)',
        'mono': 'var(--bxo-font-mono)',
        sans: 'var(--bxo-font-ui)',
      },
      boxShadow: {
        'xs': 'var(--bxo-shadow-xs)',
        'sm': 'var(--bxo-shadow-sm)',
        'base': 'var(--bxo-shadow-base)',
        'md': 'var(--bxo-shadow-md)',
        'lg': 'var(--bxo-shadow-lg)',
        'xl': 'var(--bxo-shadow-xl)',
        'accent-sm': 'var(--bxo-shadow-accent-sm)',
        'accent-md': 'var(--bxo-shadow-accent-md)',
        'accent-lg': 'var(--bxo-shadow-accent-lg)',
      },
      transitionDuration: {
        'xfast': 'var(--bxo-duration-xfast)',
        'fast': 'var(--bxo-duration-fast)',
        'base': 'var(--bxo-duration-base)',
        'slow': 'var(--bxo-duration-slow)',
        'slower': 'var(--bxo-duration-slower)',
      },
      transitionTimingFunction: {
        'ease-out': 'var(--bxo-ease-out)',
        'ease-in-out': 'var(--bxo-ease-in-out)',
      },
      fontSize: {
        'xs': 'var(--bxo-text-xs)',
        'sm': 'var(--bxo-text-sm)',
        'base': 'var(--bxo-text-base)',
        'lg': 'var(--bxo-text-lg)',
        'xl': 'var(--bxo-text-xl)',
        '2xl': 'var(--bxo-text-2xl)',
        '3xl': 'var(--bxo-text-3xl)',
        '4xl': 'var(--bxo-text-4xl)',
      },
      lineHeight: {
        'tight': 'var(--bxo-line-height-tight)',
        'snug': 'var(--bxo-line-height-snug)',
        'normal': 'var(--bxo-line-height-normal)',
        'relaxed': 'var(--bxo-line-height-relaxed)',
        'loose': 'var(--bxo-line-height-loose)',
      },
      zIndex: {
        'hide': 'var(--bxo-z-hide)',
        'auto': 'var(--bxo-z-auto)',
        'dropdown': 'var(--bxo-z-dropdown)',
        'sticky': 'var(--bxo-z-sticky)',
        'fixed': 'var(--bxo-z-fixed)',
        'modal': 'var(--bxo-z-modal)',
        'popover': 'var(--bxo-z-popover)',
        'tooltip': 'var(--bxo-z-tooltip)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.85' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.3s ease-out',
        'slide-down': 'slide-down 0.3s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
        'pulse-subtle': 'pulse-subtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
