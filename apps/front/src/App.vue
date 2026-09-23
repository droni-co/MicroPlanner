
<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">C</span><div><p class="eyebrow">Personal agent workspace</p><h1>Claude, a tu lado</h1></div></div>
      <button class="settings-toggle" type="button" @click="showSettings = !showSettings"><span>{{ showSettings ? 'Ocultar' : 'Configurar' }}</span><span aria-hidden="true">&#9881;</span></button>
    </header>
    <section v-if="showSettings" class="settings-panel">
      <div><p class="eyebrow">Contexto persistente</p><h2>System prompt</h2><p class="muted">Define sus skills, tono, límites e información de referencia.</p></div>
      <textarea v-model="systemPrompt" class="prompt-input" aria-label="System prompt" placeholder="Eres mi agente de desarrollo. Ayúdame a..." />
    </section>
    <section ref="conversationElement" class="conversation" :class="{ empty: !messages.length }">
      <div v-if="!messages.length" class="welcome"><span class="welcome-symbol">✦</span><h2>¿Qué construimos hoy?</h2><p>Describe una tarea y Claude trabajará contigo paso a paso.</p></div>
      <article v-for="message in messages" :key="message.id" class="message" :class="message.role">
        <div class="message-label">{{ message.role === 'user' ? 'Tú' : 'Claude' }}</div><div class="message-content">{{ message.content }}<span v-if="message.streaming" class="cursor" /></div>
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
import { nextTick, ref } from 'vue'

type Message = { id: number; role: 'user' | 'assistant'; content: string; streaming?: boolean }
const messages = ref<Message[]>([])
const draft = ref('')
const systemPrompt = ref('Eres mi agente personal. Sé claro, práctico y directo. Ayúdame a completar tareas y explica las decisiones importantes.')
const showSettings = ref(false)
const isStreaming = ref(false)
const errorMessage = ref('')
const conversationElement = ref<HTMLElement | null>(null)
const scrollToBottom = async () => { await nextTick(); conversationElement.value?.scrollTo({ top: conversationElement.value.scrollHeight, behavior: 'smooth' }) }

const sendMessage = async () => {
  const content = draft.value.trim()
  if (!content || isStreaming.value) return
  errorMessage.value = ''; draft.value = ''
  messages.value.push({ id: Date.now(), role: 'user', content })
  const assistantMessage: Message = { id: Date.now() + 1, role: 'assistant', content: '', streaming: true }
  messages.value.push(assistantMessage); isStreaming.value = true; await scrollToBottom()
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemPrompt: systemPrompt.value, messages: messages.value.filter(({ content: text }) => text).map(({ role, content: text }) => ({ role, content: text })) }) })
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
