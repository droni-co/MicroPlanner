
<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">C</span><div><p class="eyebrow">Personal agent workspace</p><h1>Claude, a tu lado</h1></div></div>
      <div class="topbar-actions">
        <button class="print-button" type="button" title="Imprimir conversación" aria-label="Imprimir conversación" @click="printConversation"><span aria-hidden="true">&#128424;</span><span>Imprimir</span></button>
        <button class="settings-toggle" type="button" @click="showSettings = !showSettings"><span>{{ showSettings ? 'Ocultar' : 'Configurar' }}</span><span aria-hidden="true">&#9881;</span></button>
      </div>
    </header>
    <section v-if="showSettings" class="settings-panel">
      <div class="settings-heading"><p class="eyebrow">Configuración de sesión</p><h2>Conexiones del agente</h2><p class="muted">Estos valores se guardan en tu sesión y se mantienen al recargar.</p></div>
      <div class="config-grid">
        <label>Proveedor de IA<select v-model="configForm.iaApiProvider"><option value="anthropic">Anthropic</option><option value="deepseek">DeepSeek</option></select></label>
        <label>API key de IA<input v-model="configForm.iaApiKey" type="password" autocomplete="off" placeholder="sk-..." /></label>
        <label>Organización Azure DevOps<input v-model="configForm.devopsOrg" placeholder="mi-organizacion" /></label>
        <label>PAT Azure DevOps<input v-model="configForm.devopsPat" type="password" autocomplete="off" /></label>
        <label>Organización GitHub<input v-model="configForm.ghOrg" placeholder="mi-organizacion" /></label>
        <label>PAT GitHub<input v-model="configForm.ghPat" type="password" autocomplete="off" /></label>
        <div class="config-actions"><button class="save-config-button" type="button" :disabled="isSavingConfig" @click="saveConfig">{{ isSavingConfig ? 'Guardando...' : 'Guardar conexiones' }}</button><span v-if="configMessage" class="config-message">{{ configMessage }}</span></div>
      </div>
      <div class="system-prompt-setting"><p class="eyebrow">Contexto del agente</p><textarea v-model="systemPrompt" class="prompt-input" aria-label="System prompt" placeholder="Eres mi agente de desarrollo. Ayúdame a..." /></div>
    </section>
    <section ref="conversationElement" class="conversation" :class="{ empty: !messages.length }" @click="handleConversationClick">
      <div v-if="!messages.length" class="welcome"><span class="welcome-symbol">✦</span><h2>¿Qué construimos hoy?</h2><p>Describe una tarea y Claude trabajará contigo paso a paso.</p></div>
      <article v-for="message in messages" :key="message.id" class="message" :class="message.role">
        <div class="message-label">{{ message.role === 'user' ? 'Tú' : 'Claude' }}</div>
        <div v-if="message.role === 'assistant'" class="message-content markdown-body" v-html="renderMarkdown(message.content)" />
        <div v-else class="message-content">{{ message.content }}</div>
        <span v-if="message.streaming" class="cursor" />
      </article>
      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    </section>
    <form class="composer" @submit.prevent="sendMessage">
      <textarea v-model="draft" class="composer-input" rows="1" placeholder="Pide una tarea a tu agente..." :disabled="isStreaming" @keydown.enter.exact.prevent="sendMessage" />
      <button class="send-button" type="submit" :disabled="!draft.trim() || isStreaming" aria-label="Enviar mensaje">{{ isStreaming ? '...' : 'Enviar' }} <span aria-hidden="true">&#8599;</span></button>
    </form>
    <p class="footer-note">El contexto se mantiene mientras esta pestaña esté abierta.</p>
  </main>
</template>

<script setup lang="ts">
import { nextTick, onUpdated, ref } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import mermaid from 'mermaid'

type Provider = 'anthropic' | 'deepseek'
type SessionConfig = { iaApiProvider: Provider; iaApiKey: string; devopsOrg: string; devopsPat: string; ghOrg: string; ghPat: string }
type Message = { id: number; role: 'user' | 'assistant'; content: string; streaming?: boolean }
const messages = ref<Message[]>([])
const draft = ref('')
const systemPrompt = ref('Eres mi agente personal. Sé claro, práctico y directo. Ayúdame a completar tareas y explica las decisiones importantes.')
const showSettings = ref(true)
const isConfigured = ref(false)
const isSavingConfig = ref(false)
const configMessage = ref('')
const configForm = ref<SessionConfig>({ iaApiProvider: 'anthropic', iaApiKey: '', devopsOrg: '', devopsPat: '', ghOrg: '', ghPat: '' })
const isStreaming = ref(false)
const errorMessage = ref('')
const conversationElement = ref<HTMLElement | null>(null)
const mermaidSources = new Map<string, string>()
let mermaidCounter = 0
marked.setOptions({ breaks: true, gfm: true })
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  htmlLabels: false,
  themeVariables: {
    darkMode: true,
    background: '#202522',
    primaryColor: '#303a34',
    primaryTextColor: '#f2f4ef',
    primaryBorderColor: '#b8c6b9',
    lineColor: '#d9e2d9',
    secondaryColor: '#26302a',
    tertiaryColor: '#202522',
    edgeLabelBackground: '#202522',
  },
})
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character)
marked.use({
  renderer: {
    code(token) {
      if (token.lang?.toLowerCase() !== 'mermaid') return false
      const id = `diagram-${++mermaidCounter}`
      mermaidSources.set(id, token.text)
      return `<div class="mermaid-block" data-mermaid-block="${id}"><div class="mermaid-toolbar"><span>Diagrama</span><button type="button" class="mermaid-toggle" data-mermaid-toggle="${id}">Ver código</button></div><div class="mermaid-render" data-mermaid-render="${id}"></div><pre class="mermaid-source" data-mermaid-source="${id}" hidden><code>${escapeHtml(token.text)}</code></pre><p class="mermaid-error" data-mermaid-error="${id}" hidden></p></div>`
    },
  },
})
const renderMarkdown = (content: string) => DOMPurify.sanitize(marked.parse(content) as string, {
  ADD_ATTR: ['data-mermaid-block', 'data-mermaid-render', 'data-mermaid-source', 'data-mermaid-error', 'data-mermaid-toggle'],
})
const printConversation = () => window.print()
const renderMermaidDiagrams = async () => {
  const blocks = conversationElement.value?.querySelectorAll<HTMLElement>('[data-mermaid-block]') || []
  for (const block of blocks) {
    const id = block.dataset.mermaidBlock
    const target = id ? block.querySelector<HTMLElement>(`[data-mermaid-render="${id}"]`) : null
    const source = id ? mermaidSources.get(id) : null
    if (!id || !target || !source || target.dataset.rendered === 'true') continue
    try {
      const result = await mermaid.render(`mermaid-svg-${id}`, source)
      target.innerHTML = DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true } })
      target.dataset.rendered = 'true'
    } catch (error) {
      const errorElement = block.querySelector<HTMLElement>(`[data-mermaid-error="${id}"]`)
      if (errorElement) { errorElement.textContent = error instanceof Error ? error.message : 'No se pudo renderizar el diagrama'; errorElement.hidden = false }
      console.error('[Mermaid] No se pudo renderizar el diagrama', error)
    }
  }
}
onUpdated(() => { void renderMermaidDiagrams() })
const handleConversationClick = (event: MouseEvent) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mermaid-toggle]')
  if (!button) return
  const id = button.dataset.mermaidToggle
  const source = id ? conversationElement.value?.querySelector<HTMLElement>(`[data-mermaid-source="${id}"]`) : null
  if (!source) return
  source.hidden = !source.hidden
  button.textContent = source.hidden ? 'Ver código' : 'Ocultar código'
}
const scrollToBottom = async () => { await nextTick(); conversationElement.value?.scrollTo({ top: conversationElement.value.scrollHeight, behavior: 'smooth' }); await renderMermaidDiagrams() }

const loadConfig = async () => {
  const response = await fetch('/api/config', { credentials: 'include' })
  const savedConfig = await response.json() as SessionConfig | null
  if (savedConfig) { configForm.value = savedConfig; isConfigured.value = true; showSettings.value = false }
}

const saveConfig = async () => {
  isSavingConfig.value = true; configMessage.value = ''
  try {
    const response = await fetch('/api/config', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(configForm.value) })
    const result = await response.json() as { error?: string; config?: SessionConfig }
    if (!response.ok || !result.config) throw new Error(result.error || 'No se pudo guardar la configuración')
    configForm.value = result.config; isConfigured.value = true; configMessage.value = 'Configuración guardada'; showSettings.value = false
  } catch (error) { configMessage.value = error instanceof Error ? error.message : 'No se pudo guardar la configuración' }
  finally { isSavingConfig.value = false }
}

void loadConfig().catch(() => { configMessage.value = 'No se pudo cargar la configuración de sesión' })

const sendMessage = async () => {
  const content = draft.value.trim()
  if (!content || isStreaming.value || !isConfigured.value) return
  errorMessage.value = ''; draft.value = ''
  messages.value.push({ id: Date.now(), role: 'user', content })
  const assistantMessage: Message = { id: Date.now() + 1, role: 'assistant', content: '', streaming: true }
  messages.value.push(assistantMessage); isStreaming.value = true; await scrollToBottom()
  try {
    const response = await fetch('/api/chat', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemPrompt: systemPrompt.value, messages: messages.value.filter(({ content: text }) => text).map(({ role, content: text }) => ({ role, content: text })) }) })
    if (!response.ok || !response.body) { const result = await response.json().catch(() => ({ error: 'Error de conexión' })); throw new Error(result.error) }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
    while (true) {
      const { value, done } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const events = buffer.split('\n\n'); buffer = events.pop() || ''
      for (const event of events) {
        const dataLine = event.split('\n').find((line) => line.startsWith('data: ')); if (!dataLine) continue
        const data = JSON.parse(dataLine.slice(6)) as string | { ok: boolean }
        if (event.startsWith('event: token')) assistantMessage.content += data as string
        if (event.startsWith('event: error')) throw new Error(data as string)
        await scrollToBottom()
      }
      if (done) break
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'No se pudo completar la solicitud'
    if (!assistantMessage.content) messages.value.pop()
  } finally { assistantMessage.streaming = false; isStreaming.value = false }
}
</script>
