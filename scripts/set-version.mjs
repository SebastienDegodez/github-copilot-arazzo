// Called by semantic-release: writes the next version into every manifest that carries one.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  process.stderr.write('Usage: node scripts/set-version.mjs <semver>\n')
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const setVersion = (file, update) => {
  const path = join(root, file)
  const json = JSON.parse(readFileSync(path, 'utf8'))
  update(json)
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`)
}

setVersion('plugin.json', (json) => { json.version = version })
setVersion('package.json', (json) => { json.version = version })
setVersion('package-lock.json', (json) => {
  json.version = version
  if (json.packages?.['']) json.packages[''].version = version
})
process.stdout.write(`version ${version}\n`)
