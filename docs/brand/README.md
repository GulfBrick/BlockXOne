# BlockXOne Brand Source of Truth

The files in this directory are the user-supplied BlockXOne brand masters received on 2026-07-25.

## Master assets

- `blockxone-logo-master.png` — primary BX1 emblem and BLOCKXONE wordmark artwork.
- `blockxone-brand-guide.png` — logo treatments, palette, typography, component examples, CSS tokens, and brand notes.

Do not overwrite or recompress these master files. Web-ready derivatives belong under `apps/web/public/brand/`.

## Canonical visual language

| Role | Value |
|---|---|
| Electric Cyan | `#27D0F7` |
| Cyan Deep | `#00B8E6` |
| Midnight Graphite | `#0B131B` |
| Slate Surface | `#0F1E28` |
| Steel Grey | `#7B8EA2` |
| Frost White | `#EAF6FF` |
| Accent border | `rgba(39, 208, 247, 0.32)` |
| Headline / wordmark font | Orbitron |
| Body font | Inter |
| Data font | JetBrains Mono |
| Standard radius | `16px` |
| Standard shadow | `0 12px 40px rgba(0, 0, 0, 0.35)` |

## Brand character

- Mood: futuristic, trusted, precise, powerful.
- Personality: innovative, secure, intelligent, ambitious.
- Tone: confident, clear, forward-thinking.

The interface should express this through clean geometry, disciplined cyan emphasis, readable data surfaces, and restrained illumination. Glitch effects, scanlines, continuous decorative animation, and excessive neon are not part of the production UI.

## Web derivative

The transparent web assets below are deterministic crops from the supplied RGBA master:

- `apps/web/public/brand/blockxone-mark.png`
- `apps/web/public/brand/blockxone-wordmark.png`
- `apps/web/public/brand/blockxone-lockup-stacked.png`

The application uses the exact raster wordmark for brand lockups and Orbitron for interface headlines.
