<template>
 <span v-if="id" class="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap" :title="id" :aria-label="'Order ID '+id">Order {{ label }}</span>
</template>
<script setup>
import {computed} from 'vue'
const props=defineProps({orderId:{type:[String,Number],default:null}})
const id=computed(()=>props.orderId==null?'':String(props.orderId))
const label=computed(()=>id.value.length>16?id.value.slice(0,6)+'\u2026'+id.value.slice(-6):id.value)
</script>
