// Converts the LCOV report of `node --test` into the Cobertura XML that GitHub Code Quality reads
// for its code coverage rule. GitHub only evaluates line coverage; branches are carried along.
// Usage: node scripts/lcov-to-cobertura.mjs coverage/lcov.info coverage/cobertura.xml
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const rate = (covered, valid) => (valid ? covered / valid : 1).toFixed(4)
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The files of an LCOV report: their path, the hits of each line and their branch counts. */
export const parseLcov = (text) => {
  const files = []
  let file = null
  for (const line of text.split(/\r?\n/)) {
    const [key, value = ''] = line.split(/:(.*)/s)
    if (key === 'SF') file = { path: value, lines: new Map(), branches: { covered: 0, valid: 0 } }
    else if (key === 'DA' && file) {
      const [number, hits] = value.split(',').map(Number)
      file.lines.set(number, (file.lines.get(number) ?? 0) + hits)
    } else if (key === 'BRDA' && file) {
      file.branches.valid++
      if (!['-', '0'].includes(value.split(',')[3])) file.branches.covered++
    } else if (key === 'end_of_record' && file) {
      files.push(file)
      file = null
    }
  }
  return files
}

const totals = (files) => files.reduce((sum, file) => ({
  linesValid: sum.linesValid + file.lines.size,
  linesCovered: sum.linesCovered + [...file.lines.values()].filter((hits) => hits > 0).length,
  branchesValid: sum.branchesValid + file.branches.valid,
  branchesCovered: sum.branchesCovered + file.branches.covered,
}), { linesValid: 0, linesCovered: 0, branchesValid: 0, branchesCovered: 0 })

const rates = (files) => {
  const t = totals(files)
  return `line-rate="${rate(t.linesCovered, t.linesValid)}" branch-rate="${rate(t.branchesCovered, t.branchesValid)}"`
}

/** The Cobertura XML of the files, one package per folder. */
export const toCobertura = (files, timestamp = Date.now()) => {
  const t = totals(files)
  const packages = Map.groupBy(files, (file) => dirname(file.path))
  const xml = [
    '<?xml version="1.0" ?>',
    '<!DOCTYPE coverage SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd">',
    `<coverage ${rates(files)} lines-covered="${t.linesCovered}" lines-valid="${t.linesValid}" branches-covered="${t.branchesCovered}" branches-valid="${t.branchesValid}" complexity="0" version="1" timestamp="${timestamp}">`,
    '  <sources><source>.</source></sources>',
    '  <packages>',
    ...[...packages].sort(([a], [b]) => a.localeCompare(b)).flatMap(([name, members]) => [
      `    <package name="${escape(name)}" ${rates(members)} complexity="0">`,
      '      <classes>',
      ...members.flatMap((file) => [
        `        <class name="${escape(file.path)}" filename="${escape(file.path)}" ${rates([file])} complexity="0">`,
        '          <methods/>',
        '          <lines>',
        ...[...file.lines].sort(([a], [b]) => a - b).map(([number, hits]) => `            <line number="${number}" hits="${hits}" branch="false"/>`),
        '          </lines>',
        '        </class>',
      ]),
      '      </classes>',
      '    </package>',
    ]),
    '  </packages>',
    '</coverage>',
  ]
  return `${xml.join('\n')}\n`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [from, to] = process.argv.slice(2)
  if (!from || !to) {
    process.stderr.write('Usage: node scripts/lcov-to-cobertura.mjs <lcov.info> <cobertura.xml>\n')
    process.exit(2)
  }
  const files = parseLcov(readFileSync(from, 'utf8'))
  writeFileSync(to, toCobertura(files))
  const t = totals(files)
  process.stdout.write(`cobertura: ${files.length} files, ${t.linesCovered}/${t.linesValid} lines\n`)
}
