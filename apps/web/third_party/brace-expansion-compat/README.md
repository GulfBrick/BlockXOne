# `brace-expansion` compatibility facade

This private package preserves the legacy CommonJS callable export required by
transitive `minimatch` consumers while delegating every expansion to the
official, patched `brace-expansion@5.0.9` implementation.

It adapts exports only:

- CommonJS receives the upstream `expand` function as the callable export and
  as `.expand`.
- ES modules receive the upstream `expand` function as both the default and
  named export.

All four exports are exact references to the official upstream function. Do not
add expansion logic, lifecycle scripts, fallbacks, or a floating upstream
version. Remove this facade when every consumer supports the official modern
export shape.
