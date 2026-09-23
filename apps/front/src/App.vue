
<template>
  <div class="container mx-auto h-screen flex flex-col justify-around transition">
    <section v-if="activeChat" class="h-full p-8">
      <DuiCard title="Chat con agente" />
    </section>
    <section class="p-4">
      <DuiTextarea />
      <DuiButton @click="activeChat = true">
        <i class="mdi mdi-access-point-check" /> Enviar
      </DuiButton>
    </section>
  </div>
</template>
<script setup lang="ts">
import { ref}  from 'vue'
import { DuiButton, DuiTextarea, DuiCard } from '@dronico/droni-kit';
const activeChat = ref(false)
</script>
