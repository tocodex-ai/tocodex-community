import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const localesDir = path.join(__dirname, '..', 'webview-ui', 'src', 'i18n', 'locales')

const dirs = fs.readdirSync(localesDir)

for (const lang of dirs) {
  const langDir = path.join(localesDir, lang)
  if (!fs.statSync(langDir).isDirectory()) continue

  const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json'))

  for (const file of files) {
    const filePath = path.join(langDir, file)
    let content = fs.readFileSync(filePath, 'utf8')
    const original = content

    // Step 1: Replace compound brand names first (longer first)
    content = content.replace(/Roo Code Cloud/g, 'ToCodex')
    content = content.replace(/Roo Code/g, 'ToCodex')

    // Step 2: Replace ALL remaining "Roo" that are NOT part of:
    // - .roo (paths), rooXxx (camelCase keys)
    // Negative lookbehind: not preceded by .
    // Negative lookahead: not followed by lowercase ASCII letter or /
    content = content.replace(/(?<!\.)Roo(?![a-z/])/g, 'ToCodex AI')
    // Also handle Roo followed by apostrophe (Turkish etc)
    content = content.replace(/(?<!\.)Roo'/g, "ToCodex AI'")

    // Step 3: Clean up double replacements like "ToCodex AI AI"
    content = content.replace(/ToCodex AI AI/g, 'ToCodex AI')
    // Clean up "ToCodex AI Code" from partial replacements
    content = content.replace(/ToCodex AI Code/g, 'ToCodex')

    if (content !== original) {
      // Validate JSON before writing
      try {
        JSON.parse(content)
        fs.writeFileSync(filePath, content, 'utf8')
        console.log(`Updated: ${lang}/${file}`)
      } catch (e) {
        console.error(`SKIPPED (invalid JSON): ${lang}/${file} - ${e.message}`)
      }
    }
  }
}

console.log('Done!')
