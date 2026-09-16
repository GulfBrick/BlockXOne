import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const inspectionRoots = ['src', 'scripts', 'public'].map((directory) => path.join(process.cwd(), directory))
const prohibitedCharacters = new Set([
  String.fromCodePoint(0x2013),
  String.fromCodePoint(0x2014),
])
const supportedExtensions = new Set(['.css', '.html', '.js', '.jsx', '.json', '.md', '.mjs', '.ts', '.tsx'])
const clientCopyExtensions = new Set(['.jsx', '.tsx'])
const prohibitedClientPhrases = [
  /\bcontrolled pilot\b/i,
  /\bpaid pilot\b/i,
  /\bpilot environment\b/i,
  /\bpilot scope\b/i,
  /\bpilot issuance\b/i,
  /\bpilot journey\b/i,
  /\bpilot (?:asset|wallet|provider|operation)\b/i,
  /\blocal-pilot\b/i,
  /\bsynthetic pilot\b/i,
  /\bproof run\b/i,
  /\bpersisted name\b/i,
  /\bruntime scope\b/i,
  /\bdemo (?:toggles|rules)\b/i,
]
const findings = []

function inspectDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      inspectDirectory(target)
      continue
    }
    if (!supportedExtensions.has(path.extname(entry.name))) continue

    const extension = path.extname(entry.name)
    const lines = readFileSync(target, 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      if ([...line].some((character) => prohibitedCharacters.has(character))) {
        findings.push(`${path.relative(process.cwd(), target)}:${index + 1} prohibited punctuation`)
      }
      if (clientCopyExtensions.has(extension) && !entry.name.includes('.test.')) {
        for (const phrase of prohibitedClientPhrases) {
          if (phrase.test(line)) {
            findings.push(`${path.relative(process.cwd(), target)}:${index + 1} internal-stage client copy`)
            break
          }
        }
      }
    })
  }
}

for (const inspectionRoot of inspectionRoots) inspectDirectory(inspectionRoot)

if (findings.length) {
  console.error('Copy policy failed. Correct the client-facing copy at:')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}

console.log('Copy policy passed.')
