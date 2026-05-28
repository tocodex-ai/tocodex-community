import { useState } from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"

const RooHero = () => {
	const { t } = useAppTranslation()
	const [imagesBaseUri] = useState(() => {
		const w = window as any
		return w.IMAGES_BASE_URI || ""
	})

	return (
		<div className="mb-2 flex items-center justify-start gap-3 pt-2 w-full group cursor-default">
			<div
				className="animate-fade-in-up shrink-0 transition-all duration-300 ease-out group-hover:scale-110 group-hover:rotate-6 group-hover:drop-shadow-[0_0_8px_var(--vscode-focusBorder)]"
				style={{
					backgroundColor: "var(--vscode-foreground)",
					WebkitMaskImage: `url('${imagesBaseUri}/tocodex-logo.svg')`,
					WebkitMaskRepeat: "no-repeat",
					WebkitMaskSize: "contain",
					maskImage: `url('${imagesBaseUri}/tocodex-logo.svg')`,
					maskRepeat: "no-repeat",
					maskSize: "contain",
				}}>
				<img src={imagesBaseUri + "/tocodex-logo.svg"} alt="tocodex-Community logo" className="h-8 opacity-0" />
			</div>
			<div className="flex flex-col transition-all duration-300 group-hover:translate-x-0.5">
				<span className="text-lg font-semibold text-vscode-foreground leading-tight animate-fade-in-up-delay-1 transition-colors duration-300 group-hover:text-vscode-textLink-foreground">
					tocodex-Community
				</span>
				<span className="text-xs text-vscode-descriptionForeground animate-fade-in-up-delay-2">
					{t("welcome:tagline")}
				</span>
			</div>
		</div>
	)
}

export default RooHero
