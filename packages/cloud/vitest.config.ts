import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		watch: false,
		pool: "forks",
		poolOptions: {
			forks: { singleFork: true },
		},
	},
	resolve: {
		alias: {
			vscode: new URL("./src/__mocks__/vscode.ts", import.meta.url).pathname,
		},
	},
})
