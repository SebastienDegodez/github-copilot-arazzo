// The Stryker configs carry the SKRAFT quality bar: core (domain + application) breaks under 100,
// boundary (infrastructure + presentation) under 80, with the TAP runner and a JSON report.
import { readFileSync } from 'node:fs'

const expected = { 'stryker.core.config.json': 100, 'stryker.boundary.config.json': 80 }
let failed = false
for (const [file, bar] of Object.entries(expected)) {
  const config = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
  const { high, low, break: breaks } = config.thresholds ?? {}
  const problems = [
    ...(high === bar && low === bar && breaks === bar ? [] : [`thresholds must all be ${bar}`]),
    ...(config.testRunner === 'tap' ? [] : ['testRunner must be tap']),
    ...(config.reporters?.includes('json') ? [] : ['reporters must include json']),
    ...(config.mutate?.length ? [] : ['mutate must list the files to mutate']),
  ]
  for (const problem of problems) process.stderr.write(`${file}: ${problem}\n`)
  failed ||= problems.length > 0
}
if (failed) process.exit(1)
process.stdout.write('quality bar: core 100, boundary 80\n')
