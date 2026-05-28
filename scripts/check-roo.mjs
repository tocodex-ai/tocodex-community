import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const d = path.join(__dirname, '..', 'webview-ui', 'src', 'i18n', 'locales')
let total = 0

for (const lang of fs.readdirSync(d)) {
  const ld = path.join(d, lang)
  if (!fs.statSync(ld).isDirectory()) continue
  for (const f of fs.readdirSync(ld).filter(x => x.endsWith('.json'))) {
    const c = fs.readFileSync(path.join(ld, f), 'utf8')
    for (const line of c.split('\n')) {
      if (/\bRoo\b/.test(line) && !/roo\//.test(line) && !/\.roo/.test(line) && !/rooTips/.test(line) && !/rooSaid/.test(line) && !/rooCloud/.test(line) && !/"roo"/.test(line)) {
        total++
        if (total <= 15) console.log(`${lang}/${f}: ${line.trim().substring(0, 120)}`)
      }
    }
  }
}
console.log(`Total remaining: ${total}`)
