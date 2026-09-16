'use client'

import { useLayoutEffect, useRef } from 'react'
import { animate, createScope, createTimeline, onScroll, splitText, spring, stagger, svg } from 'animejs'

type PublicMotionProps = {
  children: React.ReactNode
}

const motionSelectors = [
  '[data-bxo-hero-line]',
  '[data-bxo-hero-detail]',
  '[data-bxo-hero-media]',
  '[data-bxo-hero-kicker]',
  '[data-bxo-hero-copy]',
  '[data-bxo-hero-actions]',
  '[data-bxo-hero-foot]',
  '[data-bxo-hero-caption]',
  '[data-bxo-hero-aside]',
  '[data-bxo-hero-track]',
  '[data-bxo-public-header]',
  '[data-bxo-nav-brand]',
  '[data-bxo-nav]',
  '[data-bxo-nav-item]',
  '[data-bxo-nav-indicator]',
  '[data-bxo-nav-actions]',
  '[data-bxo-menu-trigger]',
  '[data-bxo-reveal]',
  '[data-bxo-reveal-group]',
  '[data-bxo-reveal-item]',
  '[data-bxo-image-reveal]',
  '[data-bxo-rule]',
  '[data-bxo-parallax]',
  '[data-bxo-flow-heading]',
  '[data-bxo-flow-copy]',
  '[data-bxo-flow-media]',
  '[data-bxo-flow-step]',
  '[data-bxo-flow-index]',
  '[data-bxo-flow-content]',
  '[data-bxo-flow-actions]',
  '[data-bxo-flow-rail]',
  '[data-bxo-media-caption]',
  '[data-bxo-media-caption-item]',
  '[data-bxo-product-story]',
  '[data-bxo-product-surface]',
  '[data-bxo-product-bar]',
  '[data-bxo-product-nav]',
  '[data-bxo-product-heading]',
  '[data-bxo-product-context]',
  '[data-bxo-product-status]',
  '[data-bxo-product-nav-item]',
  '[data-bxo-product-step]',
  '[data-bxo-product-icon]',
  '[data-bxo-product-line]',
  '[data-bxo-product-continuity-label]',
  '[data-bxo-product-evidence]',
  '[data-bxo-scroll-progress]',
  '[data-bxo-footer]',
  '[data-bxo-footer-intro]',
  '[data-bxo-footer-column]',
  '[data-bxo-footer-meta]',
]

export function PublicMotion({ children }: PublicMotionProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    const restoreStaticState = () => {
      root.querySelectorAll<HTMLElement>(motionSelectors.join(',')).forEach((element) => {
        element.style.removeProperty('opacity')
        element.style.removeProperty('transform')
        element.style.removeProperty('transform-origin')
        element.style.removeProperty('clip-path')
        element.style.removeProperty('will-change')
        element.style.removeProperty('background-color')
        element.style.removeProperty('border-color')
        element.style.removeProperty('box-shadow')
        element.style.removeProperty('filter')
      })
    }

    const scope = createScope({
      root,
      mediaQueries: {
        reduceMotion: '(prefers-reduced-motion: reduce)',
        desktop: '(min-width: 768px)',
        finePointer: '(hover: hover) and (pointer: fine)',
      },
    }).add((activeScope) => {
      if (activeScope?.matches.reduceMotion) {
        restoreStaticState()
        return
      }

      const nativeListenerCleanups: Array<() => void> = []
      const textSplitterCleanups: Array<() => void> = []
      const svgGeometryCleanups: Array<() => void> = []
      const navBrand = root.querySelectorAll<HTMLElement>('[data-bxo-nav-brand]')
      const navItems = root.querySelectorAll<HTMLElement>('[data-bxo-nav-item]')
      const navActions = root.querySelectorAll<HTMLElement>('[data-bxo-nav-actions], [data-bxo-menu-trigger]')
      const navIndicators = root.querySelectorAll<HTMLElement>('[data-bxo-nav-indicator]')

      if (document.documentElement.dataset.bxoChromeReady !== 'true') {
        const chromeTimeline = createTimeline({ defaults: { ease: 'out(4)' } })

        if (navBrand.length) {
          chromeTimeline.add(navBrand, {
            opacity: [0, 1],
            y: [-8, 0],
            duration: 460,
          }, 0)
        }

        if (navItems.length) {
          chromeTimeline.add(navItems, {
            opacity: [0, 1],
            y: [-6, 0],
            duration: 420,
            delay: stagger(34),
          }, 70)
        }

        if (navActions.length) {
          chromeTimeline.add(navActions, {
            opacity: [0, 1],
            y: [-6, 0],
            duration: 420,
            delay: stagger(40),
          }, 150)
        }

        document.documentElement.dataset.bxoChromeReady = 'true'
      }

      navIndicators.forEach((indicator) => {
        indicator.style.transformOrigin = 'left center'
        animate(indicator, {
          scaleX: [0, 1],
          opacity: [0.3, 1],
          duration: 520,
          ease: 'outExpo',
        })
      })

      const heroLines = Array.from(root.querySelectorAll<HTMLElement>('[data-bxo-hero-line]'))
      const heroMedia = Array.from(root.querySelectorAll<HTMLElement>('[data-bxo-hero-media]'))
      const heroAsides = Array.from(root.querySelectorAll<HTMLElement>('[data-bxo-hero-aside]'))
      const heroAsideItems = heroAsides.flatMap((aside) => (
        Array.from(aside.querySelectorAll<HTMLElement>('[data-bxo-reveal-item]'))
      ))
      const heroKickers = Array.from(root.querySelectorAll<HTMLElement>('[data-bxo-hero-kicker]'))
      const heroCopy = Array.from(root.querySelectorAll<HTMLElement>('[data-bxo-hero-copy]'))
      const heroActions = Array.from(root.querySelectorAll<HTMLElement>('[data-bxo-hero-actions]'))
      const heroFoot = Array.from(root.querySelectorAll<HTMLElement>('[data-bxo-hero-foot], [data-bxo-hero-caption]'))
      const semanticHeroDetails = new Set([...heroKickers, ...heroCopy, ...heroActions, ...heroFoot])
      const remainingHeroDetails = Array.from(root.querySelectorAll<HTMLElement>('[data-bxo-hero-detail]'))
        .filter((element) => !semanticHeroDetails.has(element))

      const heroWordSplits = heroLines.map((line) => splitText(line, {
        words: { wrap: 'clip', class: 'bxo-motion-word' },
        accessible: true,
      }))
      const heroWords = heroWordSplits.flatMap((split) => split.words as HTMLElement[])
      heroWordSplits.forEach((split) => textSplitterCleanups.push(() => split.revert()))

      const heroTimeline = createTimeline({ defaults: { ease: 'out(4)' } })

      if (heroMedia.length) {
        heroTimeline.add(heroMedia, {
          opacity: [0, 1],
          scale: [1.018, 1],
          duration: 900,
        }, 0)
      }

      if (heroKickers.length) {
        heroTimeline.add(heroKickers, {
          opacity: [0, 1],
          y: [12, 0],
          duration: 560,
          delay: stagger(45),
        }, 70)
      }

      if (heroWords.length) {
        heroTimeline.add(heroWords, {
          opacity: [0, 1],
          y: ['105%', '0%'],
          duration: 720,
          delay: stagger(38),
          ease: 'outExpo',
        }, 110)
      }

      if (heroCopy.length) {
        heroTimeline.add(heroCopy, {
          opacity: [0, 1],
          y: [18, 0],
          duration: 620,
          delay: stagger(45),
        }, 330)
      }

      if (heroActions.length) {
        heroTimeline.add(heroActions, {
          opacity: [0, 1],
          y: [14, 0],
          duration: 560,
          delay: stagger(45),
        }, 410)
      }

      if (heroFoot.length) {
        heroTimeline.add(heroFoot, {
          opacity: [0, 1],
          y: [10, 0],
          duration: 560,
          delay: stagger(40),
        }, 480)
      }

      if (heroAsides.length) {
        heroTimeline.add(heroAsides, {
          opacity: [0, 1],
          y: [18, 0],
          duration: 600,
          delay: stagger(45),
        }, 390)
      }

      if (heroAsideItems.length) {
        heroTimeline.add(heroAsideItems, {
          opacity: [0, 1],
          x: [10, 0],
          duration: 420,
          delay: stagger(34),
        }, 470)
      }

      if (remainingHeroDetails.length) {
        heroTimeline.add(remainingHeroDetails, {
          opacity: [0, 1],
          y: [18, 0],
          duration: 600,
          delay: stagger(55),
        }, 350)
      }

      root.querySelectorAll<HTMLElement>('[data-bxo-hero-track]').forEach((track) => {
        const hero = track.closest<HTMLElement>('section')
        if (!hero) return

        animate(track, {
          y: ['0%', '-6%'],
          opacity: [1, 0.8],
          ease: 'linear',
          autoplay: onScroll({
            target: hero,
            enter: 'top top',
            leave: 'top bottom',
            sync: 0.3,
          }),
        })
      })

      const revealTargets = Array.from(
        root.querySelectorAll<HTMLElement>('[data-bxo-reveal], [data-bxo-reveal-group], [data-bxo-image-reveal], [data-bxo-rule]'),
      ).filter((element) => (
        !element.closest('[data-bxo-flow-section]')
        && !element.closest('[data-bxo-product-story]')
        && !element.closest('[data-bxo-hero-media]')
        && !element.closest('[data-bxo-hero-aside]')
      ))

      revealTargets.forEach((element) => {
        if (element.hasAttribute('data-bxo-rule')) {
          element.style.transformOrigin = 'left center'
          element.style.transform = 'scaleX(0)'
        } else if (element.hasAttribute('data-bxo-image-reveal')) {
          element.style.opacity = '0'
          element.style.clipPath = 'inset(4% 3% 4% 3%)'
        } else if (element.hasAttribute('data-bxo-reveal-group')) {
          element.querySelectorAll<HTMLElement>('[data-bxo-reveal-item]').forEach((child) => {
            child.style.opacity = '0'
            child.style.transform = 'translateY(18px)'
          })
        } else {
          element.style.opacity = '0'
          element.style.transform = 'translateY(20px)'
        }
      })

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return
            const element = entry.target as HTMLElement
            element.style.willChange = 'transform, opacity, clip-path'
            const clearWillChange = () => element.style.removeProperty('will-change')

            if (element.hasAttribute('data-bxo-rule')) {
              animate(element, {
                scaleX: [0, 1],
                duration: 700,
                ease: 'outExpo',
                onComplete: clearWillChange,
              })
            } else if (element.hasAttribute('data-bxo-image-reveal')) {
              animate(element, {
                opacity: [0, 1],
                clipPath: ['inset(4% 3% 4% 3%)', 'inset(0% 0% 0% 0%)'],
                duration: 900,
                ease: 'outQuint',
                onComplete: clearWillChange,
              })
            } else if (element.hasAttribute('data-bxo-reveal-group')) {
              const groupItems = element.querySelectorAll<HTMLElement>('[data-bxo-reveal-item]')
              animate(groupItems, {
                opacity: [0, 1],
                y: [18, 0],
                duration: 580,
                delay: stagger(48),
                ease: 'out(4)',
                onComplete: clearWillChange,
              })
            } else {
              animate(element, {
                opacity: [0, 1],
                y: [20, 0],
                duration: 640,
                ease: 'out(4)',
                onComplete: clearWillChange,
              })
            }

            observer.unobserve(element)
          })
        },
        { rootMargin: '0px 0px -9% 0px', threshold: 0.08 },
      )

      revealTargets.forEach((element) => observer.observe(element))

      root.querySelectorAll<HTMLElement>('[data-bxo-flow-section]').forEach((section) => {
        const headings = section.querySelectorAll<HTMLElement>('[data-bxo-flow-heading]')
        const copy = section.querySelectorAll<HTMLElement>('[data-bxo-flow-copy]')
        const media = section.querySelectorAll<HTMLElement>('[data-bxo-flow-media]')
        const actions = section.querySelectorAll<HTMLElement>('[data-bxo-flow-actions]')
        const captionItems = section.querySelectorAll<HTMLElement>('[data-bxo-media-caption-item], [data-bxo-media-caption]')

        if (!headings.length && !copy.length && !media.length && !actions.length && !captionItems.length) return

        const sectionTimeline = createTimeline({
          defaults: { ease: 'linear' },
          autoplay: onScroll({
            target: section,
            enter: '88% top',
            leave: '42% top',
            sync: 0.32,
          }),
        })

        if (headings.length) {
          sectionTimeline.add(headings, {
            opacity: [0.38, 1],
            y: [22, 0],
            duration: 620,
            delay: stagger(35),
          }, 0)
        }

        if (copy.length) {
          sectionTimeline.add(copy, {
            opacity: [0.5, 1],
            y: [16, 0],
            duration: 560,
            delay: stagger(35),
          }, 100)
        }

        if (media.length) {
          sectionTimeline.add(media, {
            opacity: [0.58, 1],
            clipPath: ['inset(3% 2% 3% 2%)', 'inset(0% 0% 0% 0%)'],
            duration: 680,
          }, 180)
        }

        if (actions.length) {
          sectionTimeline.add(actions, {
            opacity: [0.48, 1],
            y: [12, 0],
            duration: 460,
            delay: stagger(35),
          }, 260)
        }

        if (captionItems.length) {
          sectionTimeline.add(captionItems, {
            opacity: [0.25, 1],
            y: [8, 0],
            duration: 360,
            delay: stagger(55),
          }, 430)
        }
      })

      root.querySelectorAll<HTMLElement>('[data-bxo-flow-step]').forEach((step) => {
        const indices = step.querySelectorAll<HTMLElement>('[data-bxo-flow-index]')
        const content = step.querySelectorAll<HTMLElement>('[data-bxo-flow-content]')
        const stepTimeline = createTimeline({
          defaults: { ease: 'linear' },
          autoplay: onScroll({
            target: step,
            enter: '84% top',
            leave: '48% top',
            sync: 0.3,
          }),
        })

        stepTimeline.add(step, {
          opacity: [0.46, 1],
          y: [14, 0],
          duration: 520,
        }, 0)

        if (indices.length) {
          stepTimeline.add(indices, {
            opacity: [0.38, 1],
            scale: [0.84, 1],
            duration: 360,
          }, 20)
        }

        if (content.length) {
          stepTimeline.add(content, {
            opacity: [0.58, 1],
            x: [8, 0],
            duration: 420,
            delay: stagger(28),
          }, 80)
        }
      })

      root.querySelectorAll<HTMLElement>('[data-bxo-flow-rail]').forEach((rail) => {
        const sequence = rail.closest<HTMLElement>('[data-bxo-flow-sequence]')
        if (!sequence) return
        rail.style.transformOrigin = 'top center'

        animate(rail, {
          scaleY: [0, 1],
          ease: 'linear',
          autoplay: onScroll({
            target: sequence,
            enter: '90% top',
            leave: '18% bottom',
            sync: 0.22,
          }),
        })
      })

      if (activeScope?.matches.desktop) {
        root.querySelectorAll<HTMLElement>('[data-bxo-parallax]').forEach((element) => {
          const frame = element.closest<HTMLElement>('[data-bxo-parallax-frame]')
            ?? element.closest<HTMLElement>('figure')
          if (!frame) return

          const isHero = element.getAttribute('data-bxo-parallax') === 'hero'
          animate(element, {
            y: isHero ? ['-1%', '1.5%'] : ['-1.2%', '1.2%'],
            scale: isHero ? [1.01, 1.03] : [1.006, 1.022],
            ease: 'linear',
            autoplay: onScroll({
              target: frame,
              enter: 'bottom top',
              leave: 'top bottom',
              sync: 0.22,
            }),
          })
        })
      }

      root.querySelectorAll<HTMLElement>('[data-bxo-product-story]').forEach((story) => {
        const surface = story.querySelectorAll<HTMLElement>('[data-bxo-product-surface]')
        const bar = story.querySelectorAll<HTMLElement>('[data-bxo-product-bar]')
        const nav = story.querySelectorAll<HTMLElement>('[data-bxo-product-nav]')
        const navItems = story.querySelectorAll<HTMLElement>('[data-bxo-product-nav-item]')
        const heading = story.querySelectorAll<HTMLElement>('[data-bxo-product-heading]')
        const context = story.querySelectorAll<HTMLElement>('[data-bxo-product-context]')
        const status = story.querySelectorAll<HTMLElement>('[data-bxo-product-status]')
        const steps = Array.from(story.querySelectorAll<HTMLElement>('[data-bxo-product-step]'))
        const icons = Array.from(story.querySelectorAll<HTMLElement>('[data-bxo-product-icon]'))
        const lines = story.querySelectorAll<HTMLElement>('[data-bxo-product-line]')
        const continuityLabels = story.querySelectorAll<HTMLElement>('[data-bxo-product-continuity-label]')
        const evidence = story.querySelectorAll<HTMLElement>('[data-bxo-product-evidence]')

        const productTimeline = createTimeline({
          defaults: { ease: 'linear' },
          autoplay: onScroll({
            target: story,
            enter: '92% top',
            leave: '22% bottom',
            sync: 0.28,
          }),
        })

        productTimeline
          .add(surface, { opacity: [0.72, 1], y: [32, 0], scale: [0.986, 1], duration: 700 }, 0)
          .add(bar, { opacity: [0.45, 1], y: [-8, 0], duration: 380 }, 120)
          .add(nav, { opacity: [0.4, 1], x: [-10, 0], duration: 440 }, 180)
          .add(navItems, {
            opacity: [0.35, 1],
            x: [-8, 0],
            duration: 360,
            delay: stagger(34),
          }, 210)
          .add(heading, { opacity: [0.45, 1], y: [10, 0], duration: 420 }, 220)

        if (context.length) {
          productTimeline.add(context, { opacity: [0.35, 1], x: [6, 0], duration: 340 }, 180)
        }

        if (status.length) {
          productTimeline.add(status, {
            opacity: [0.45, 1],
            scale: [0.65, 1.35, 1],
            duration: 360,
            ease: 'out(4)',
          }, 230)
        }

        steps.forEach((step, index) => {
          const position = 300 + index * 72
          const icon = icons[index]

          productTimeline.add(step, {
            opacity: [0.3, 1],
            x: [-10, 0],
            backgroundColor: ['rgba(46, 239, 250, 0)', 'rgba(46, 239, 250, 0.045)'],
            duration: 430,
          }, position)

          if (!icon) return

          productTimeline.add(icon, {
            opacity: [0.38, 1],
            scale: [0.82, 1.06, 1],
            boxShadow: ['0 0 0 rgba(46, 239, 250, 0)', '0 0 22px rgba(46, 239, 250, 0.18)'],
            duration: 340,
            ease: 'out(4)',
          }, position + 18)

          const geometry = icon.querySelectorAll<SVGGeometryElement>('path, line, polyline, polygon, rect, circle, ellipse')
          if (!geometry.length) return

          const drawableGeometry = Array.from(geometry)
          drawableGeometry.forEach((element) => {
            const inlineStyle = element.getAttribute('style')
            const originalAttributes = new Map([
              'pathLength',
              'draw',
              'stroke-dasharray',
              'stroke-dashoffset',
            ].map((attribute) => [attribute, element.getAttribute(attribute)]))

            svgGeometryCleanups.push(() => {
              originalAttributes.forEach((value, attribute) => {
                if (value === null) {
                  element.removeAttribute(attribute)
                } else {
                  element.setAttribute(attribute, value)
                }
              })

              if (inlineStyle === null) {
                element.removeAttribute('style')
              } else {
                element.setAttribute('style', inlineStyle)
              }
            })
          })

          productTimeline.add(svg.createDrawable(drawableGeometry, 0, 0), {
            draw: ['0 0', '0 1'],
            duration: 300,
          }, position + 20)
        })

        productTimeline
          .add(continuityLabels, {
            opacity: [0.35, 1],
            y: [5, 0],
            duration: 320,
            delay: stagger(50),
          }, 690)
          .add(lines, { scaleX: [0, 1], duration: 420, delay: stagger(80) }, 720)
          .add(evidence, {
            opacity: [0.32, 1],
            y: [9, 0],
            duration: 440,
            delay: stagger(55),
          }, 800)
      })

      root.querySelectorAll<HTMLElement>('[data-bxo-footer]').forEach((footer) => {
        const intro = footer.querySelectorAll<HTMLElement>('[data-bxo-footer-intro]')
        const columns = footer.querySelectorAll<HTMLElement>('[data-bxo-footer-column]')
        const meta = footer.querySelectorAll<HTMLElement>('[data-bxo-footer-meta]')
        const footerTimeline = createTimeline({
          defaults: { ease: 'linear' },
          autoplay: onScroll({
            target: footer,
            enter: 'bottom top',
            leave: 'bottom bottom',
            sync: 0.25,
          }),
        })

        footerTimeline
          .add(intro, { opacity: [0.36, 1], y: [18, 0], duration: 460 }, 0)
          .add(columns, {
            opacity: [0.32, 1],
            y: [14, 0],
            duration: 420,
            delay: stagger(45),
          }, 120)
          .add(meta, { opacity: [0.38, 1], y: [8, 0], duration: 320 }, 360)
      })

      const scrollProgress = root.querySelector<HTMLElement>('[data-bxo-scroll-progress]')
      if (scrollProgress) {
        scrollProgress.style.transformOrigin = 'left center'
        animate(scrollProgress, {
          scaleX: [0, 1],
          ease: 'linear',
          autoplay: onScroll({
            target: root,
            enter: 'top top',
            leave: 'bottom bottom',
            sync: true,
          }),
        })
      }

      if (activeScope?.matches.finePointer) {
        root.querySelectorAll<HTMLElement>('.bxo-primary-cta, .bxo-secondary-cta, [data-bxo-interactive]').forEach((action) => {
          let pointerActive = false
          let focusActive = false

          const setActive = (active: boolean) => {
            animate(action, {
              scale: active ? 1.012 : 1,
              duration: active ? 420 : 340,
              ease: spring({ bounce: active ? 0.08 : 0.04, duration: active ? 420 : 340 }),
            })
            const arrow = action.querySelector<SVGElement>('[data-bxo-motion-arrow]')
            if (arrow) animate(arrow, { x: active ? 4 : 0, duration: active ? 260 : 220, ease: 'out(4)' })
          }

          const enter = () => {
            pointerActive = true
            setActive(true)
          }
          const leave = () => {
            pointerActive = false
            setActive(focusActive)
          }
          const focusIn = () => {
            focusActive = true
            setActive(true)
          }
          const focusOut = () => {
            focusActive = false
            setActive(pointerActive)
          }
          const press = () => animate(action, { scale: 0.985, duration: 160, ease: 'out(3)' })
          const release = () => setActive(pointerActive || focusActive)

          action.addEventListener('pointerenter', enter)
          action.addEventListener('pointerleave', leave)
          action.addEventListener('pointerdown', press)
          action.addEventListener('pointerup', release)
          action.addEventListener('pointercancel', leave)
          action.addEventListener('focusin', focusIn)
          action.addEventListener('focusout', focusOut)

          nativeListenerCleanups.push(() => {
            action.removeEventListener('pointerenter', enter)
            action.removeEventListener('pointerleave', leave)
            action.removeEventListener('pointerdown', press)
            action.removeEventListener('pointerup', release)
            action.removeEventListener('pointercancel', leave)
            action.removeEventListener('focusin', focusIn)
            action.removeEventListener('focusout', focusOut)
          })
        })
      }

      return () => {
        observer.disconnect()
        nativeListenerCleanups.forEach((cleanup) => cleanup())
        textSplitterCleanups.forEach((cleanup) => cleanup())
        svgGeometryCleanups.forEach((cleanup) => cleanup())
        restoreStaticState()
      }
    })

    return () => scope.revert()
  }, [])

  return <div ref={rootRef}>{children}</div>
}
