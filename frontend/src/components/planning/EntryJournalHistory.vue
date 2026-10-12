<template>
 <section class="space-y-3" aria-label="Saved entry journal evidence">
  <h2 class="font-semibold">Entry journal evidence</h2>
  <p v-if="!assessments.length" class="text-sm text-gray-500 dark:text-gray-400">No entry journal assessments have been recorded.</p>
  <details v-for="a in assessments" :key="a.id" class="border-b border-gray-700 pb-3">
   <summary class="cursor-pointer text-sm">{{ label(a.stage_key) }} · session {{ a.snapshot.sessionDate }} · recorded {{ time(a.snapshot.recordedAt) }}<span v-if="a.snapshot.status==='exception'"> · Exception</span><span v-if="retrospective(a.id)"> · Retrospective</span></summary>
   <div class="mt-3 space-y-2 text-sm">
    <p>Journal reviewed: {{ a.snapshot.journalReviewed?'Yes':'Not confirmed' }} · Existing positions reviewed: {{ a.snapshot.positionsReviewed?'Yes':'Not confirmed' }}</p>
    <p v-if="a.snapshot.exceptionReason">Exception: {{ a.snapshot.exceptionReason }}</p><p v-if="a.snapshot.notes">{{ a.snapshot.notes }}</p>
    <div v-if="a.snapshot.journal" class="space-y-2"><strong>{{ a.snapshot.journal.title||'Untitled journal' }}</strong><p>Source saved {{ time(a.snapshot.journal.updatedAt) }}</p><p v-if="a.snapshot.journal.marketBias">Market bias: {{ a.snapshot.journal.marketBias }}</p><p v-if="a.snapshot.journal.keyLevels" class="whitespace-pre-wrap">Key levels: {{ a.snapshot.journal.keyLevels }}</p><p v-if="a.snapshot.journal.watchlist?.length">Watchlist: {{ a.snapshot.journal.watchlist.join(', ') }}</p><pre class="whitespace-pre-wrap break-words font-sans text-sm">{{ a.snapshot.journal.content }}</pre><RouterLink v-if="a.diary_entry_id" :to="'/diary/'+a.diary_entry_id+'/edit'" class="text-primary-500">Open current journal</RouterLink><p v-else>Original journal removed; the saved evidence is retained.</p></div>
   </div>
  </details>
 </section>
</template>
<script setup>
const props=defineProps({assessments:{type:Array,default:()=>[]},records:{type:Array,default:()=>[]},entries:{type:Array,default:()=>[]}})
const time=v=>new Date(v).toLocaleString('en-GB')
const label=key=>props.entries.find(e=>e.key===key)?.label||key
const retrospective=id=>props.records.some(a=>a.journal_evidence?.assessmentId===id&&a.journal_evidence.timing==='retrospective')
</script>
