import { z } from "zod"

import type { ModelInfo } from "../model.ts"

/**
 * Roo Code Cloud is a dynamic provider - models are loaded from the /v1/models API endpoint.
 * Default model ID used as fallback when no model is specified.
 */
export const rooDefaultModelId = "gpt-4o-mini"

/**
 * Empty models object maintained for type compatibility.
 * All model data comes dynamically from the API.
 */
export const rooModels = {} as const satisfies Record<string, ModelInfo>

/**
 * Roo Code Cloud API response schemas
 */

export const RooPricingSchema = z.object({
	input: z.string(),
	output: z.string(),
	input_cache_read: z.string().optional(),
	input_cache_write: z.string().optional(),
})

export const RooModelSchema = z.object({
	id: z.string(),
	object: z.literal("model").optional(),
	created: z.number().optional(),
	owned_by: z.string().optional(),
	name: z.string().optional(),
	description: z.string().optional(),
	context_window: z.number().optional(),
	max_tokens: z.number().optional(),
	type: z.string().optional(),
	tags: z.array(z.string()).optional(),
	pricing: RooPricingSchema.optional(),
	deprecated: z.boolean().optional(),
	default_temperature: z.number().optional(),
	supported_endpoint_types: z.array(z.string()).optional(),
	settings: z.record(z.string(), z.unknown()).optional(),
	versionedSettings: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
})

export const RooModelsResponseSchema = z.object({
	object: z.literal("list"),
	data: z.array(RooModelSchema),
})

export type RooModel = z.infer<typeof RooModelSchema>
export type RooModelsResponse = z.infer<typeof RooModelsResponseSchema>
