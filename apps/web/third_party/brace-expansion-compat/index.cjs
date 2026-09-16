'use strict'

const upstream = require('brace-expansion-upstream')
const expand = upstream.expand

if (typeof expand !== 'function') {
  throw new TypeError('brace-expansion 5.0.9 did not expose expand()')
}

module.exports = expand
module.exports.expand = expand
