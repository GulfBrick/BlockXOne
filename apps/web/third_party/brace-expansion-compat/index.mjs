import { expand } from 'brace-expansion-upstream'

if (typeof expand !== 'function') {
  throw new TypeError('brace-expansion 5.0.9 did not expose expand()')
}

export { expand }
export default expand
