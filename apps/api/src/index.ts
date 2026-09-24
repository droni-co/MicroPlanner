import express from 'express'
import morgan from 'morgan'
import session from 'express-session'
import type { SessionConfig } from 'express-session'
import dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { AzureDevOpsService } from './services/azureDevOpsService.js'
import { GitHubService } from './services/githubService.js'
dotenv.config()

const app = express()
const port = Number(process.env.PORT || 3000)
const frontendUrl = ((process.env.FRONTEND_URL || 'http://localhost:5173').split('APP_KEY=')[0] || 'http://localhost:5173').replace(/\s+$/, '')

app.use(morgan('tiny'))
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', frontendUrl)
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.header('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(session({
    secret: process.env.APP_KEY || 'local-development-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
}));

type ChatMessage = { role: 'user' | 'assistant'; content: string }

const maxContextChars = Number(process.env.MAX_CONTEXT_CHARS || 100000)
const maxMessageChars = 12000
const maxToolResultChars = 24000

const truncate = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n[Contenido truncado para mantener el contexto manejable]`
}

const compactHistory = (history: ChatMessage[]): ChatMessage[] => {
  const selected: ChatMessage[] = []
  let totalChars = 0
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]
    if (!message) continue
    const content = truncate(message.content, maxMessageChars)
    const nextSize = content.length + message.role.length
    if (selected.length && totalChars + nextSize > maxContextChars) break
    selected.unshift({ role: message.role, content })
    totalChars += nextSize
  }
  return selected
}

const azureDevOpsTools: Anthropic.Tool[] = [
  {
    name: 'list_projects',
    description: 'Lista los proyectos disponibles en la organización de Azure DevOps configurada.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project',
    description: 'Obtiene los detalles de un proyecto de Azure DevOps por nombre o ID.',
    input_schema: {
      type: 'object',
      properties: { project: { type: 'string', description: 'Nombre o ID del proyecto.' } },
      required: ['project'],
    },
  },
  {
    name: 'list_work_items',
    description: 'Lista los work items más recientes de un proyecto de Azure DevOps, con filtros opcionales.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Nombre exacto del proyecto de Azure DevOps.' },
        top: { type: 'number', description: 'Cantidad máxima de resultados, entre 1 y 200.' },
        type: { type: 'string', description: 'Tipo, por ejemplo Bug, Task, User Story o Feature.' },
        state: { type: 'string', description: 'Estado, por ejemplo Active, New, Resolved o Closed.' },
      },
      required: ['project'],
    },
  },
  {
    name: 'get_work_item',
    description: 'Obtiene el detalle completo de un work item de Azure DevOps por su ID.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'ID numérico del work item.' } },
      required: ['id'],
    },
  },
  {
    name: 'update_work_item',
    description: 'Actualiza campos de un work item. Usa nombres de campo Azure como System.Title, System.State o System.AssignedTo.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID numérico del work item.' },
        fields: { type: 'object', description: 'Mapa de nombres de campo Azure DevOps a sus nuevos valores.' },
      },
      required: ['id', 'fields'],
    },
  },
  {
    name: 'search_work_items',
    description: 'Busca work items de un proyecto por palabras contenidas en título o descripción.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Nombre exacto del proyecto de Azure DevOps.' },
        query: { type: 'string', description: 'Texto que debe aparecer en el título o descripción.' },
        top: { type: 'number', description: 'Cantidad máxima de resultados, entre 1 y 200.' },
      },
      required: ['project', 'query'],
    },
  },
]

const githubTools: Anthropic.Tool[] = [
  {
    name: 'search_repositories',
    description: 'Busca repositorios dentro de la organización de GitHub configurada.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto para buscar por nombre, descripción o topics.' },
        top: { type: 'number', description: 'Cantidad máxima de resultados, entre 1 y 100.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_repository',
    description: 'Obtiene los detalles de un repositorio de GitHub. Por defecto busca en la organización configurada.',
    input_schema: {
      type: 'object',
      properties: {
        repository: { type: 'string', description: 'Nombre del repositorio.' },
        owner: { type: 'string', description: 'Owner alternativo, solo si el repositorio no pertenece a la organización configurada.' },
      },
      required: ['repository'],
    },
  },
]

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Los argumentos de la herramienta no son válidos')
  return value as Record<string, unknown>
}

const requiredString = (input: Record<string, unknown>, name: string): string => {
  const value = input[name]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Falta el argumento ${name}`)
  return value.trim()
}

const requiredNumber = (input: Record<string, unknown>, name: string): number => {
  const value = input[name]
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`El argumento ${name} debe ser un número entero`)
  return value
}

const optionalNumber = (input: Record<string, unknown>, name: string): number | undefined => {
  const value = input[name]
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

const executeTool = async (name: string, input: unknown, config: SessionConfig): Promise<unknown> => {
  return name === 'search_repositories' || name === 'get_repository'
    ? executeGitHubTool(name, input, config)
    : executeAzureTool(name, input, config)
}

const streamWithOpenAIProvider = async (
  messages: ChatMessage[],
  systemPrompt: string | undefined,
  send: (event: string, data: unknown) => void,
  config: SessionConfig,
) => {
  const client = new OpenAI({
    apiKey: config.iaApiKey,
    baseURL: 'https://api.deepseek.com',
  })
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [...azureDevOpsTools, ...githubTools].map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description || '', parameters: tool.input_schema },
  }))
  const conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    ...(systemPrompt?.trim() ? [{ role: 'system' as const, content: truncate(systemPrompt.trim(), maxMessageChars) }] : []),
    ...compactHistory(messages).map(({ role, content }) => ({ role, content })),
  ]

  for (let turn = 0; turn < 8; turn += 1) {
    const stream = await client.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      max_tokens: 4096,
      messages: conversation,
      tools,
      stream: true,
    })
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (delta?.content) send('token', delta.content)
      for (const toolCall of delta?.tool_calls || []) {
        const current = toolCalls.get(toolCall.index) || { id: '', name: '', arguments: '' }
        if (toolCall.id) current.id = toolCall.id
        if (toolCall.function?.name) current.name += toolCall.function.name
        if (toolCall.function?.arguments) current.arguments += toolCall.function.arguments
        toolCalls.set(toolCall.index, current)
      }
    }
    if (!toolCalls.size) return

    conversation.push({
      role: 'assistant',
      content: null,
      tool_calls: [...toolCalls.values()].map((toolCall) => ({
        id: toolCall.id,
        type: 'function' as const,
        function: { name: toolCall.name, arguments: toolCall.arguments },
      })),
    })
    for (const toolCall of toolCalls.values()) {
      send('tool', { name: toolCall.name, status: 'running' })
      try {
        const result = await executeTool(toolCall.name, JSON.parse(toolCall.arguments), config)
        conversation.push({ role: 'tool', tool_call_id: toolCall.id, content: truncate(JSON.stringify(result), maxToolResultChars) })
        send('tool', { name: toolCall.name, status: 'completed' })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo ejecutar la herramienta'
        conversation.push({ role: 'tool', tool_call_id: toolCall.id, content: message })
        send('tool', { name: toolCall.name, status: 'error', message })
      }
    }
  }
}

const executeAzureTool = async (name: string, rawInput: unknown, config: SessionConfig): Promise<unknown> => {
  const input = asRecord(rawInput)
  const service = new AzureDevOpsService(config.devopsOrg, config.devopsPat)
  if (name === 'list_projects') return service.listProjects()
  if (name === 'get_project') return service.getProject(requiredString(input, 'project'))
  if (name === 'list_work_items') {
    const top = optionalNumber(input, 'top')
    return service.listWorkItems(requiredString(input, 'project'), {
      ...(top !== undefined ? { top } : {}),
      ...(typeof input.type === 'string' ? { type: input.type } : {}),
      ...(typeof input.state === 'string' ? { state: input.state } : {}),
    })
  }
  if (name === 'get_work_item') return service.getWorkItem(requiredNumber(input, 'id'))
  if (name === 'search_work_items') return service.searchWorkItems(requiredString(input, 'project'), requiredString(input, 'query'), optionalNumber(input, 'top'))
  if (name === 'update_work_item') {
    const fields = asRecord(input.fields)
    return service.updateWorkItem(requiredNumber(input, 'id'), { fields })
  }
  throw new Error(`Herramienta desconocida: ${name}`)
}

const executeGitHubTool = async (name: string, rawInput: unknown, config: SessionConfig): Promise<unknown> => {
  const input = asRecord(rawInput)
  const service = new GitHubService(config.ghOrg, config.ghPat)
  if (name === 'search_repositories') return service.searchRepositories(requiredString(input, 'query'), optionalNumber(input, 'top'))
  if (name === 'get_repository') return service.getRepository(requiredString(input, 'repository'), typeof input.owner === 'string' && input.owner.trim() ? input.owner.trim() : undefined)
  throw new Error(`Herramienta desconocida: ${name}`)
}

const isSessionConfig = (value: unknown): value is SessionConfig => {
  if (!value || typeof value !== 'object') return false
  const config = value as Record<string, unknown>
  return (config.iaApiProvider === 'deepseek' || config.iaApiProvider === 'anthropic')
    && ['iaApiKey', 'devopsOrg', 'devopsPat', 'ghOrg', 'ghPat'].every((key) => typeof config[key] === 'string' && Boolean(config[key]))
}

app.get('/api/config', (req, res) => {
  return res.json(req.session.config || null)
})

app.put('/api/config', (req, res) => {
  const body = req.body as Partial<SessionConfig>
  const config = {
    iaApiProvider: body.iaApiProvider,
    iaApiKey: body.iaApiKey?.trim(),
    devopsOrg: body.devopsOrg?.trim(),
    devopsPat: body.devopsPat?.trim(),
    ghOrg: body.ghOrg?.trim(),
    ghPat: body.ghPat?.trim(),
  }
  if (!isSessionConfig(config)) {
    return res.status(400).json({ error: 'Debes completar el proveedor, API key, organizaciones y PATs' })
  }
  req.session.config = config
  return res.json({ ok: true, config })
})

app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt } = req.body as { messages?: ChatMessage[]; systemPrompt?: string }
  const config = req.session.config
  if (!config || !isSessionConfig(config)) {
    return res.status(400).json({ error: 'Configura el proveedor de IA y las conexiones antes de iniciar el chat' })
  }
  const provider = config.iaApiProvider.toUpperCase()
  console.log(`[chat] request provider=${provider} messages=${messages?.length || 0}`)

  if (!messages?.length || messages.some((message) => !message.content?.trim())) {
    return res.status(400).json({ error: 'Debes enviar al menos un mensaje válido' })
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    ;(res as express.Response & { flush?: () => void }).flush?.()
  }

  send('connected', { ok: true })

  try {
    if (provider === 'DEEPSEEK') {
      await streamWithOpenAIProvider(messages, systemPrompt, send, config)
      send('done', { ok: true })
      return
    }
    const anthropic = new Anthropic({ apiKey: config.iaApiKey })
    const conversation: Anthropic.MessageParam[] = compactHistory(messages)
      .map(({ role, content }) => ({ role, content }))
    for (let turn = 0; turn < 8; turn += 1) {
      const stream = anthropic.messages.stream({
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
        max_tokens: 4096,
        ...(systemPrompt?.trim() ? { system: truncate(systemPrompt.trim(), maxMessageChars) } : {}),
        messages: conversation,
        tools: [...azureDevOpsTools, ...githubTools],
      })
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') send('token', event.delta.text)
      }
      const response = await stream.finalMessage()
      const toolUses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
      if (!toolUses.length) break

      conversation.push({ role: 'assistant', content: response.content as Anthropic.ContentBlockParam[] })
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const toolUse of toolUses) {
        send('tool', { name: toolUse.name, status: 'running' })
        try {
          const result = await executeTool(toolUse.name, toolUse.input, config)
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: truncate(JSON.stringify(result), maxToolResultChars) })
          send('tool', { name: toolUse.name, status: 'completed' })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'No se pudo ejecutar la herramienta'
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: message, is_error: true })
          send('tool', { name: toolUse.name, status: 'error', message })
        }
      }
      conversation.push({ role: 'user', content: toolResults })
    }
    send('done', { ok: true })
  } catch (error) {
    console.error('[chat] error', error)
    send('error', error instanceof Error ? error.message : 'No se pudo contactar con Claude')
  } finally {
    res.end()
  }
})

app.get('/', (req, res) => {
  return res.json({ ok: true, service: 'micro-planner-api' })
})

app.listen(port, () => {
  console.log(`Claude agent API listening on port ${port}`)
})