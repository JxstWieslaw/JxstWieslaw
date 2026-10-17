// Guards README.md against silent decay: leftover merge-conflict markers and
// third-party widget images that have stopped answering.
//
// Usage: node scripts/check-readme.mjs
//
// View counters (hits.sh, komarev.com) are skipped on purpose: fetching them
// from CI would inflate the very number they display.
//
// The stats and streak cards answer HTTP 200 with an SVG even when they are
// broken, so for those hosts the body is searched for their error text too.

import { readFileSync } from 'node:fs'

const README = new URL('../README.md', import.meta.url)
const COUNTER_HOSTS = new Set(['hits.sh', 'komarev.com'])
const CARD_ERRORS = {
  'streak-stats.demolab.com': /could not find a user|something went wrong/i,
  'github-readme-stats-theta-one-24.vercel.app': /something went wrong|could not fetch|user not found/i,
}
const ATTEMPTS = 3
const TIMEOUT_MS = 20_000

const text = readFileSync(README, 'utf8')
// Commented-out blocks are not rendered, so they are not checked.
const visible = text.replace(/<!--[\s\S]*?-->/g, '')
const failures = []

if (/^(<{7}|>{7})( |$)/m.test(visible)) {
  failures.push('README.md contains merge-conflict markers')
}

const urls = new Set()
for (const [, url] of visible.matchAll(/(?:src="|!\[[^\]]*\]\()(https:\/\/[^"\s)]+)/g)) {
  urls.add(url)
}

async function probe(url) {
  const cardError = CARD_ERRORS[new URL(url).hostname]
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let reason
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' })
      const type = res.headers.get('content-type') ?? ''
      if (res.ok && type.startsWith('image/')) {
        if (!cardError) {
          await res.body?.cancel()
          return null
        }
        if (!cardError.test(await res.text())) return null
        reason = 'renders an error card'
      } else {
        await res.body?.cancel()
        reason = `HTTP ${res.status} (${type || 'no content-type'})`
      }
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
