export function sectorEnrichmentMessage(status) {
  if(status?.processing)return 'Processing symbols in background...'
  if(status?.running)return 'Sector classification coverage · awaiting scheduled enrichment'
  return 'Sector classification coverage · background enrichment is off'
}
