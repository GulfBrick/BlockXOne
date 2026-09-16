import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const approvedAssets = {
  '../../public/brand/blockxone-mark.png': 'F609890C4878C45B492A27DF5D2DDB35B051AA07119D35F4BC2F8A8E92D9074F',
  '../../public/brand/blockxone-wordmark.png': '17198DF8C59F537B1AF9949A42CB909BF2687232EFEC421519111AC0516A7D0F',
  '../../public/brand/blockxone-lockup-stacked.png': 'CCE04B82528A6EFDC180F20F78D8F7EA4D6271F76350573CEE5857EA3FC0B574',
  '../../public/brand/blockxone-lockup-horizontal.png': '3E21570EB1C5EDA261B36CD1C70E2F3EA4AC27D26D759F3D7117F8524649182F',
  '../../public/brand/blockxone-emblem-containment.png': '600076BA7B49C54B61C0CB308D9E217D00812142EE9D07F1DAA57616F2612CE2',
  '../../public/brand/icon-192.png': '987A14273887E5F9C278AA8BE9128D684782B9E957E47F09EF413800AB68EE78',
  '../../public/brand/icon-512.png': 'AE2E9BF7B8DDD238F3784B783023C88AA93D58FB6AD0AE554AB527DA1150F212',
  '../../public/brand/apple-touch-icon.png': 'EADFA0C8045C602654DCB98AAF19A3793F0F7E108FEF9F2C55164C4A7CE7C9AB',
  '../../public/favicon.ico': '9AC679B242766925F6AFA7C6A2BA54E769C28E9E62C9EC4D381F72CCCDBA48E4',
} as const

describe('approved BlockXOne v2.0 brand artwork', () => {
  for (const [relativePath, approvedHash] of Object.entries(approvedAssets)) {
    it(`preserves the exact bytes for ${relativePath}`, () => {
      const bytes = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)))
      const actualHash = createHash('sha256').update(bytes).digest('hex').toUpperCase()

      expect(actualHash).toBe(approvedHash)
    })
  }
})
