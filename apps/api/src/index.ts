import express from 'express'
import morgan from 'morgan'
import session from 'express-session'
import dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
dotenv.config()

const app = express()
const port = Number(process.env.PORT || 3000)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

app.use(morgan('tiny'))
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:5173')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
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

app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt } = req.body as { messages?: ChatMessage[]; systemPrompt?: string }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en el archivo .env' })
  }
  if (!messages?.length || messages.some((message) => !message.content?.trim())) {
    return res.status(400).json({ error: 'Debes enviar al menos un mensaje válido' })
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  try {
    const stream = anthropic.messages.stream({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 4096,
      ...(systemPrompt?.trim() ? { system: systemPrompt.trim() } : {}),
      messages: messages.map(({ role, content }) => ({ role, content })),
    })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') send('token', event.delta.text)
    }
    send('done', { ok: true })
  } catch (error) {
    send('error', error instanceof Error ? error.message : 'No se pudo contactar con Claude')
  } finally {
    res.end()
  }
})

app.get('/', (req, res) => {
  return res.json(req.session)
})

app.listen(port, () => {
  console.log(`Claude agent API listening on port ${port}`)
})