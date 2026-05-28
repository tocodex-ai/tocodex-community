import React, { useCallback, useEffect, useRef, useState } from "react"
import { Mic, MicOff } from "lucide-react"
import { cn } from "@src/lib/utils"
import { StandardTooltip } from "@src/components/ui"
import { useAppTranslation } from "@src/i18n/TranslationContext"

/**
 * Web Speech API 类型声明
 * 部分浏览器（如 Chrome）支持带 webkit 前缀的 SpeechRecognition
 */
interface SpeechRecognitionResult {
	readonly isFinal: boolean
	readonly length: number
	[index: number]: { readonly transcript: string; readonly confidence: number }
}

interface SpeechRecognitionResultList {
	readonly length: number
	[index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionEvent extends Event {
	readonly resultIndex: number
	readonly results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
	readonly error: string
	readonly message: string
}

interface SpeechRecognitionInstance extends EventTarget {
	lang: string
	continuous: boolean
	interimResults: boolean
	maxAlternatives: number
	onresult: ((event: SpeechRecognitionEvent) => void) | null
	onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
	onend: (() => void) | null
	start(): void
	stop(): void
	abort(): void
}

interface SpeechRecognitionConstructor {
	new (): SpeechRecognitionInstance
}

/**
 * 语音输入状态
 */
interface VoiceInputState {
	isRecording: boolean
	transcript: string
	interimTranscript: string
	error?: string
}

interface VoiceInputProps {
	/** 将转写文本追加到输入框 */
	onTranscript: (text: string) => void
	/** 组件是否禁用 */
	disabled?: boolean
}

// 检测浏览器是否支持 Web Speech API
function getSpeechRecognition(): SpeechRecognitionConstructor | null {
	const win = window as any
	return win.SpeechRecognition || win.webkitSpeechRecognition || null
}

/**
 * 语音输入组件 — 使用 Web Speech API 实现语音转文字
 *
 * Requirements:
 * - R19.1: 点击麦克风按钮开始录音并实时转写
 * - R19.2: 点击停止按钮结束录音，将转写文字填入输入框
 * - R19.3: 转写完成后允许用户编辑，不自动发送
 * - R19.5: 支持中英文混合输入
 */
export const VoiceInput: React.FC<VoiceInputProps> = ({ onTranscript, disabled = false }) => {
	const { t } = useAppTranslation()
	const [state, setState] = useState<VoiceInputState>({
		isRecording: false,
		transcript: "",
		interimTranscript: "",
	})

	const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
	const accumulatedRef = useRef<string>("")

	// 清理：组件卸载时停止录音
	useEffect(() => {
		return () => {
			if (recognitionRef.current) {
				recognitionRef.current.abort()
				recognitionRef.current = null
			}
		}
	}, [])

	const stopRecording = useCallback(() => {
		if (recognitionRef.current) {
			recognitionRef.current.stop()
			recognitionRef.current = null
		}
		// 将累积的转写文本传递给父组件（R19.2, R19.3: 填入输入框，不自动发送）
		const finalText = accumulatedRef.current.trim()
		if (finalText) {
			onTranscript(finalText)
		}
		accumulatedRef.current = ""
		setState({ isRecording: false, transcript: "", interimTranscript: "" })
	}, [onTranscript])

	const startRecording = useCallback(() => {
		const SpeechRecognitionClass = getSpeechRecognition()
		if (!SpeechRecognitionClass) {
			setState((prev) => ({
				...prev,
				error: t("chat:voiceInput.notSupported"),
			}))
			return
		}

		const recognition = new SpeechRecognitionClass()
		// R19.5: 支持中英文混合 — 使用 zh-CN 作为主语言，浏览器会自动识别英文混合
		recognition.lang = "zh-CN"
		recognition.continuous = true
		recognition.interimResults = true
		recognition.maxAlternatives = 1

		recognition.onresult = (event: SpeechRecognitionEvent) => {
			let interim = ""
			let finalTranscript = ""

			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i]
				if (result.isFinal) {
					finalTranscript += result[0].transcript
				} else {
					interim += result[0].transcript
				}
			}

			if (finalTranscript) {
				accumulatedRef.current += finalTranscript
			}

			setState((prev) => ({
				...prev,
				transcript: accumulatedRef.current,
				interimTranscript: interim,
			}))
		}

		recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
			// R19.4 相关：权限拒绝时的处理（任务 22.2 负责完整集成）
			if (event.error === "not-allowed") {
				setState((prev) => ({
					...prev,
					isRecording: false,
					error: t("chat:voiceInput.permissionDenied"),
				}))
			} else if (event.error === "no-speech") {
				// 无语音输入时静默忽略，不中断录音
				return
			} else {
				setState((prev) => ({
					...prev,
					isRecording: false,
					error: t("chat:voiceInput.error"),
				}))
			}
			recognitionRef.current = null
		}

		recognition.onend = () => {
			// 如果仍在录音状态但 recognition 自动结束了（如长时间静默），
			// 将已有文本传递给父组件
			if (recognitionRef.current) {
				const finalText = accumulatedRef.current.trim()
				if (finalText) {
					onTranscript(finalText)
				}
				accumulatedRef.current = ""
				recognitionRef.current = null
				setState({ isRecording: false, transcript: "", interimTranscript: "" })
			}
		}

		recognitionRef.current = recognition
		accumulatedRef.current = ""

		try {
			recognition.start()
			setState({ isRecording: true, transcript: "", interimTranscript: "" })
		} catch {
			setState((prev) => ({
				...prev,
				error: t("chat:voiceInput.error"),
			}))
		}
	}, [onTranscript, t])

	const handleClick = useCallback(() => {
		if (state.isRecording) {
			stopRecording()
		} else {
			startRecording()
		}
	}, [state.isRecording, stopRecording, startRecording])

	const isSupported = getSpeechRecognition() !== null

	// 如果浏览器不支持 Web Speech API，不渲染按钮
	if (!isSupported) {
		return null
	}

	const tooltipContent = state.isRecording
		? t("chat:voiceInput.stopRecording")
		: state.error
			? state.error
			: t("chat:voiceInput.startRecording")

	return (
		<StandardTooltip content={tooltipContent}>
			<button
				aria-label={
					state.isRecording ? t("chat:voiceInput.stopRecording") : t("chat:voiceInput.startRecording")
				}
				disabled={disabled && !state.isRecording}
				onClick={handleClick}
				className={cn(
					"relative inline-flex items-center justify-center",
					"bg-transparent border-none p-1.5",
					"rounded-md min-w-[28px] min-h-[28px]",
					"text-vscode-descriptionForeground hover:text-vscode-foreground",
					"transition-all duration-150",
					"cursor-pointer",
					state.isRecording ? "opacity-100 text-red-400 hover:text-red-300" : "opacity-50 hover:opacity-100",
					"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
					"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
					"active:bg-[rgba(255,255,255,0.1)]",
				)}>
				{state.isRecording ? <MicOff className="w-4 h-4 animate-pulse" /> : <Mic className="w-4 h-4" />}
			</button>
		</StandardTooltip>
	)
}
