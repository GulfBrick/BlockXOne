# BlockXOne brand assets

The sole source of truth for this application is:

- `BlockXOne_Brand_Kit_v2.0_Exact_Logo.zip`
- ZIP SHA-256: `D85045DE6E70321B977DFFE5D86B46826B9682BF2029F65EC118802AAB623BCC`
- Brand system: `BlockXOne Brand System v2.0`
- Category: `Multi-Asset Tokenisation Platform`

The approved files in `public/brand` are byte-for-byte extracts from that kit.
`src/lib/brand-assets.test.ts` locks their SHA-256 digests so a redraw, recompression,
recolour, crop, flatten, or accidental replacement fails the normal test suite.

## Usage rules

- Use the full-colour artwork on carbon or midnight surfaces.
- Use `blockxone-emblem-containment.png` on light, photographic, or visually busy surfaces.
- Use the emblem for small icon contexts and the approved wordmark artwork for the name.
- Never reproduce the wordmark with live type.
- Preserve aspect ratio and transparent clear space. Do not crop or stretch.
- Keep clear space of at least 12% of the emblem width.
- Do not add effects that compete with the chrome/cyan master artwork.
- Use Archivo for product and interface typography, Abril Fatface for selected editorial display moments, STIX Two Text for reading copy, and JetBrains Mono for exact technical data.
- Support `prefers-reduced-motion`; brand motion should reveal, confirm, or connect.

## Application mapping

| Application file | Approved kit source |
| --- | --- |
| `blockxone-mark.png` | `BlockXOne_Emblem_Master_Transparent.png` |
| `blockxone-wordmark.png` | `BlockXOne_Wordmark_Master_Transparent.png` |
| `blockxone-lockup-stacked.png` | `BlockXOne_Logo_Stacked_Master_Transparent.png` |
| `blockxone-lockup-horizontal.png` | `BlockXOne_Logo_Horizontal_Transparent.png` |
| `blockxone-emblem-containment.png` | `BlockXOne_Emblem_Containment_512.png` |
| `icon-192.png` | `android-chrome-192x192.png` |
| `icon-512.png` | `android-chrome-512x512.png` |
| `apple-touch-icon.png` | `apple-touch-icon.png` |
| `../favicon.ico` | `favicon.ico` |
