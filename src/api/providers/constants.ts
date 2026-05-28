import { Package } from "../../shared/package"

export const DEFAULT_TOCODEX_API_URL = process.env.TOCODEX_API_URL ?? "https://ruteapi.com"

export const DEFAULT_HEADERS = {
	"HTTP-Referer": "https://github.com/tocodex/ToCodex",
	"X-Title": "ToCodex",
	"User-Agent": `ToCodex/${Package.version}`,
}
