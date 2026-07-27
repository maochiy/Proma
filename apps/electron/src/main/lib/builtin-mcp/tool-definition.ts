import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z, type ZodObject, type ZodRawShape } from 'zod'

export interface BuiltinMcpToolDefinition {
  name: string
  description: string
  inputSchema: ZodObject<ZodRawShape>
  annotations?: ToolAnnotations
  execute(input: unknown): Promise<CallToolResult>
}

export interface BuiltinMcpServerDefinition extends Record<string, unknown> {
  kind: 'proma-builtin-mcp'
  name: string
  version: string
  tools: BuiltinMcpToolDefinition[]
}

interface ToolOptions {
  annotations?: ToolAnnotations
}

export interface BuiltinMcpToolFactory {
  tool<Shape extends ZodRawShape>(
    name: string,
    description: string,
    inputSchema: Shape,
    handler: (args: z.infer<ZodObject<Shape>>) => CallToolResult | Promise<CallToolResult>,
    options?: ToolOptions,
  ): BuiltinMcpToolDefinition
  createSdkMcpServer(input: {
    name: string
    version: string
    tools: BuiltinMcpToolDefinition[]
  }): BuiltinMcpServerDefinition
}

export const builtinMcpToolFactory: BuiltinMcpToolFactory = {
  tool(name, description, inputSchema, handler, options) {
    const schema = z.object(inputSchema)
    return {
      name,
      description,
      inputSchema: schema as ZodObject<ZodRawShape>,
      annotations: options?.annotations,
      execute: async (input) => handler(schema.parse(input)),
    }
  },
  createSdkMcpServer(input) {
    return {
      kind: 'proma-builtin-mcp',
      ...input,
    }
  },
}

export function isBuiltinMcpServerDefinition(value: unknown): value is BuiltinMcpServerDefinition {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BuiltinMcpServerDefinition>
  return candidate.kind === 'proma-builtin-mcp'
    && typeof candidate.name === 'string'
    && typeof candidate.version === 'string'
    && Array.isArray(candidate.tools)
}
