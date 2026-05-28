import { HTMLAttributes } from "react"

import type { Experiments, ImageGenerationModel, ImageGenerationProvider } from "@roo-code/types"

import { EXPERIMENT_IDS, experimentConfigsMap, experimentDefault } from "@roo/experiments"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"

import { SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { ExperimentalFeature } from "./ExperimentalFeature"
import { ImageGenerationSettings } from "./ImageGenerationSettings"
import { CustomToolsSettings } from "./CustomToolsSettings"

type ExperimentalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	experiments: Experiments
	setExperimentEnabled: SetExperimentEnabled
	apiConfiguration?: any
	setApiConfigurationField?: any
	imageGenerationProvider?: ImageGenerationProvider
	openRouterImageApiKey?: string
	openRouterImageGenerationSelectedModel?: string
	imageGenerationModels?: ImageGenerationModel[]
	imageGenerationSize?: string
	customImageBaseUrl?: string
	customImageApiKey?: string
	setImageGenerationProvider?: (provider: ImageGenerationProvider) => void
	setOpenRouterImageApiKey?: (apiKey: string) => void
	setCustomImageBaseUrl?: (baseUrl: string) => void
	setCustomImageApiKey?: (apiKey: string) => void
	setImageGenerationSelectedModel?: (model: string) => void
	setImageGenerationSize?: (size: string) => void
}

export const ExperimentalSettings = ({
	experiments,
	setExperimentEnabled,
	apiConfiguration,
	setApiConfigurationField,
	imageGenerationProvider,
	openRouterImageApiKey,
	openRouterImageGenerationSelectedModel,
	imageGenerationModels,
	imageGenerationSize,
	customImageBaseUrl,
	customImageApiKey,
	setImageGenerationProvider,
	setOpenRouterImageApiKey,
	setCustomImageBaseUrl,
	setCustomImageApiKey,
	setImageGenerationSelectedModel,
	setImageGenerationSize,
	className,
	...props
}: ExperimentalSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>{t("settings:sections.imageGen")}</SectionHeader>

			<Section>
				{Object.entries(experimentConfigsMap)
					.filter(([key]) => key in EXPERIMENT_IDS)
					.map((config) => {
						// Use the same translation key pattern as ExperimentalFeature
						const experimentKey = config[0]
						const label = t(`settings:experimental.${experimentKey}.name`)

						if (
							config[0] === "IMAGE_GENERATION" &&
							setImageGenerationProvider &&
							setOpenRouterImageApiKey &&
							setImageGenerationSelectedModel
						) {
							return (
								<SearchableSetting
									key={config[0]}
									settingId={`experimental-${config[0].toLowerCase()}`}
									section="imageGen"
									label={label}>
									<ImageGenerationSettings
										enabled={
											experiments[EXPERIMENT_IDS.IMAGE_GENERATION] ??
											experimentDefault[EXPERIMENT_IDS.IMAGE_GENERATION]
										}
										onChange={(enabled) =>
											setExperimentEnabled(EXPERIMENT_IDS.IMAGE_GENERATION, enabled)
										}
										imageGenerationProvider={imageGenerationProvider}
										openRouterImageApiKey={openRouterImageApiKey}
										openRouterImageGenerationSelectedModel={openRouterImageGenerationSelectedModel}
										imageGenerationModels={imageGenerationModels}
										imageGenerationSize={imageGenerationSize}
										customImageBaseUrl={customImageBaseUrl}
										customImageApiKey={customImageApiKey}
										setImageGenerationProvider={setImageGenerationProvider}
										setOpenRouterImageApiKey={setOpenRouterImageApiKey}
										setCustomImageBaseUrl={setCustomImageBaseUrl ?? (() => {})}
										setCustomImageApiKey={setCustomImageApiKey ?? (() => {})}
										setImageGenerationSelectedModel={setImageGenerationSelectedModel}
										setImageGenerationSize={setImageGenerationSize!}
									/>
								</SearchableSetting>
							)
						}
						if (config[0] === "CUSTOM_TOOLS") {
							return (
								<SearchableSetting
									key={config[0]}
									settingId={`experimental-${config[0].toLowerCase()}`}
									section="imageGen"
									label={label}>
									<CustomToolsSettings
										enabled={
											experiments[EXPERIMENT_IDS.CUSTOM_TOOLS] ??
											experimentDefault[EXPERIMENT_IDS.CUSTOM_TOOLS]
										}
										onChange={(enabled) =>
											setExperimentEnabled(EXPERIMENT_IDS.CUSTOM_TOOLS, enabled)
										}
									/>
								</SearchableSetting>
							)
						}
						return (
							<SearchableSetting
								key={config[0]}
								settingId={`experimental-${config[0].toLowerCase()}`}
								section="imageGen"
								label={label}>
								<ExperimentalFeature
									experimentKey={config[0]}
									enabled={
										experiments[EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS]] ??
										experimentDefault[EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS]]
									}
									onChange={(enabled) =>
										setExperimentEnabled(
											EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS],
											enabled,
										)
									}
								/>
							</SearchableSetting>
						)
					})}
			</Section>
		</div>
	)
}
