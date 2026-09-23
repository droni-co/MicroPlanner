
<template>
  <div class="container mx-auto h-screen border flex flex-col justify-around transition">
    <section v-if="activeChat" class="transition border bg-rose-300 h-full">
      <ChatPanel />
    </section>
    <section class="p-4">
      <DuiTextarea />
      <DuiButton>
        <i class="mdi mdi-access-point-check" /> Enviar
      </DuiButton>
    </section>
  </div>
</template>
<script setup lang="ts">
import { ref}  from 'vue'
import ChatPanel from './components/ChatPanel.vue';
import { DuiButton, DuiTextarea } from '@dronico/droni-kit';
const activeChat = ref(false)
</script>
