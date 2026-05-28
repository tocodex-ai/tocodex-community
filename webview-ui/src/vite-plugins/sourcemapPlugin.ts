import { Plugin } from "vite"
import fs from "fs"
import path from "path"

/**
 * Custom Vite plugin to ensure source maps are properly included in the build.
 * Processes source maps one at a time to avoid OOM on large builds.
 */
export function sourcemapPlugin(): Plugin {
	return {
		name: "vite-plugin-sourcemap",
		apply: "build",

		// After the build is complete, ensure source maps are included in the build
		closeBundle: {
			order: "post",
			handler: async () => {
				console.log("Ensuring source maps are included in build...")

				// Determine the correct output directory based on the build mode
				const mode = process.env.NODE_ENV
				let outDir

				if (mode === "nightly") {
					outDir = path.resolve("../apps/vscode-nightly/build/webview-ui/build")
				} else {
					outDir = path.resolve("../src/webview-ui/build")
				}

				const assetsDir = path.join(outDir, "assets")

				console.log(`Source map processing for ${mode} build in ${outDir}`)

				// Check if build directory exists
				if (!fs.existsSync(outDir)) {
					console.warn("Build directory not found:", outDir)
					return
				}

				// Check if assets directory exists
				if (!fs.existsSync(assetsDir)) {
					console.warn("Assets directory not found:", assetsDir)
					return
				}

				// Find JS files in the assets directory
				const jsFiles = fs.readdirSync(assetsDir).filter((file) => file.endsWith(".js"))

				console.log(`Found ${jsFiles.length} JS files in assets directory`)

				// Process one file at a time to avoid holding multiple large objects in memory
				for (const jsFile of jsFiles) {
					const jsPath = path.join(assetsDir, jsFile)
					const mapPath = jsPath + ".map"

					// If source map exists, ensure it's properly referenced in the JS file
					if (fs.existsSync(mapPath)) {
						// Check if the source map reference is already in the JS file
						// Use a small read (last 200 bytes) to avoid loading the whole file
						const stat = fs.statSync(jsPath)
						const tailSize = Math.min(200, stat.size)
						const fd = fs.openSync(jsPath, "r")
						const tail = Buffer.alloc(tailSize)
						fs.readSync(fd, tail, 0, tailSize, stat.size - tailSize)
						fs.closeSync(fd)
						const tailStr = tail.toString("utf8")

						if (!tailStr.includes("//# sourceMappingURL=")) {
							console.log(`Adding source map reference to ${jsFile}`)
							fs.appendFileSync(jsPath, `\n//# sourceMappingURL=${jsFile}.map\n`)
						}

						// Process source map: use string replacement to avoid full JSON parse+stringify
						// Only fix sourceRoot and leading slashes in sources paths
						try {
							let mapContent = fs.readFileSync(mapPath, "utf8")
							let changed = false

							// Fix sourceRoot if missing: insert "sourceRoot":"" after first {
							if (!/"sourceRoot"\s*:/.test(mapContent)) {
								mapContent = mapContent.replace(/^\s*\{/, '{"sourceRoot":"",')
								changed = true
							}

							// Fix absolute source paths: remove leading slash from paths in "sources":[...]
							// Replace "/absolute/path" -> "absolute/path" using regex on the sources array content
							const fixedMap = mapContent.replace(
								/("sources"\s*:\s*\[)([^\]]*)\]/,
								(_, prefix, sourcesContent: string) => {
									const fixed = sourcesContent.replace(/"\/([^"]+)"/g, '"$1"')
									if (fixed !== sourcesContent) {
										changed = true
									}
									return prefix + fixed + "]"
								},
							)

							if (fixedMap !== mapContent) {
								changed = true
							}

							if (changed) {
								fs.writeFileSync(mapPath, fixedMap)
								console.log(`Updated source map for ${jsFile}`)
							}

							// Release memory immediately
							// eslint-disable-next-line @typescript-eslint/no-unused-vars
						} catch (error) {
							console.error(`Error processing source map for ${jsFile}:`, error)
						}
					}
				}

				// Create a special file to enable source map loading in production
				fs.writeFileSync(
					path.join(outDir, "sourcemap-manifest.json"),
					JSON.stringify({
						enabled: true,
						version: process.env.PKG_VERSION || "unknown",
						buildTime: new Date().toISOString(),
					}),
				)

				console.log("Source map processing complete")
			},
		},
	}
}
