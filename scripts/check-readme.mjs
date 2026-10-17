// Guards README.md against silent decay: leftover merge-conflict markers and
// third-party widget images that have stopped answering.
//
// Usage: node scripts/check-readme.mjs
//
// View counters (hits.sh, komarev.com) are skipped on purpose: fetching them
// from CI would inflate the very number they display.

import { readFileSync } from 'node:fs'

const README = new URL('../README.md', import.meta.url)
const COUNTER_HOSTS = new Set(['hits.sh', 'komarev.com'])
const ATTEMPTS = 3
const TIMEOUT_MS = 20_000

const text = readFileSync(README, 'utf8')
const failures = []

if (/^(<{7}|={7}|>{7})( |$)/m.test(text)) {
  failures.push('README.md contains merge-conflict markers')
}

const urls = new Set()
for (const [, url] of text.matchAll(/(?:src="|\]\()(https:\/\/[^"\s)]+)/g)) {
  urls.add(url)
}

async function probe(url) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' })
      const type = res.headers.get('content-type') ?? ''
      if (res.ok && type.startsWith('image/')) return null
      var reason = `HTTP ${res.status} (${type || 'no content-type'})`
    } catch (err) {
      reason = String(err?.cause?.code ?? err?.message ?? err)
    }
    if (attempt === ATTEMPTS) return reason
    await new Promise((r) => setTimeout(r, 2000 * attempt))
  }
}

const targets = [...urls].filter((u) => !COUNTER_HOSTS.has(new URL(u).hostname))
const results = await Promise.all(targets.map(async (u) => [u, await probe(u)]))

for (const [url, reason] of results) {
  if (reason) failures.push(`${reason}  ${url}`)
}

console.log(`Checked ${targets.length} images (${urls.size - targets.length} counter URLs skipped).`)
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('README OK')
