import React, { createContext, useContext, ReactNode, useEffect, useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import i18next, { loadTranslations } from "./setup"
import { useExtensionState } from "@/context/ExtensionStateContext"

// Create context for translations
export const TranslationContext = createContext<{
	t: (key: string, options?: Record<string, any>) => string
	i18n: typeof i18next
}>({
	t: (key: string) => key,
	i18n: i18next,
})

// Translation provider component
export const TranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
	// Initialize with default configuration
	const { i18n } = useTranslation()
	// Get the extension state directly - it already contains all state properties
	const extensionState = useExtensionState()

	// 跟踪当前语言，确保语言切换后子组件能重新渲染
	const [currentLanguage, setCurrentLanguage] = useState(i18n.language)

	// Load translations once when the component mounts
	useEffect(() => {
		try {
			loadTranslations()
		} catch (error) {
			console.error("Failed to load translations:", error)
		}
	}, [])

	useEffect(() => {
		const lang = extensionState.language ?? "en"
		i18n.changeLanguage(lang).then(() => {
			setCurrentLanguage(lang)
		})
	}, [i18n, extensionState.language])

	// 将 currentLanguage 加入依赖，语言切换后 translate 引用会更新，触发子组件重渲染
	const translate = useCallback(
		(key: string, options?: Record<string, any>) => {
			return i18n.t(key, options)
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[i18n, currentLanguage],
	)

	return (
		<TranslationContext.Provider
			value={{
				t: translate,
				i18n,
			}}>
			{children}
		</TranslationContext.Provider>
	)
}

// Custom hook for easy translations
export const useAppTranslation = () => useContext(TranslationContext)

export default TranslationProvider
