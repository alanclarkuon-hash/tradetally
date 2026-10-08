
<template>
 <div class="planning-workspace" v-if="draft" :inert="busy" :aria-busy="busy">
  <div class="journey" aria-label="Plan milestones"><div v-for="m in milestones" :key="m.label"><small>{{ m.date }}</small><strong class="block">{{ m.label }}</strong></div></div>
  <nav class="workflow-tabs" aria-label="Plan workflow"><button v-for="s in screens" :key="s" :class="{active:screen===s}" :aria-current="screen===s?'step':undefined" @click="moveScreen(s)">{{ s }}</button></nav>
  <p v-if="error" class="text-red-400 bg-red-500/10 p-3" role="alert">{{ error }}</p>
  <section v-if="managing&&planCommitments.length" class="card p-5"><h2 class="font-semibold">Awaiting execution confirmation</h2><div v-for="c in planCommitments" :key="c.id" class="flex justify-between flex-wrap gap-3 mt-3"><span>{{ c.snapshot.stage.label }} · {{ money(c.risk_amount,c.currency) }} reserved</span><button class="btn-secondary" :disabled="busy" @click="releaseCommitment(c)">Release unfilled commitment</button></div></section><section v-if="managing" class="card p-5 space-y-3">
   <div class="flex justify-between"><h2 class="font-semibold text-lg">Portfolio risk</h2><span>{{ risk?.unknown?'Incomplete coverage':'Recorded stop risk' }}</span></div>
   <div class="relative h-4 rounded bg-gray-600">
    <div class="h-full rounded" :class="riskExceeded?'bg-red-500':'bg-emerald-400'" :style="{width:barWidth(currentRisk)+'%'}"></div>
    <div class="absolute h-4 top-0 bg-amber-400/50" :style="{left:barWidth(currentRisk)+'%',width:Math.max(0,barWidth(projectedRisk)-barWidth(currentRisk))+'%'}"></div>
    <span v-if="risk?.limit" class="absolute h-7 border-l-2 border-white -top-1" style="left:80%" aria-label="Risk limit"></span>
   </div>
   <div class="flex flex-wrap gap-5 text-sm"><span>Known risk {{ money(currentRisk,risk?.currency) }}</span><span>With all unlinked entries {{ money(projectedRisk,risk?.currency) }}</span><span>Limit {{ money(risk?.limit,risk?.currency) }}</span><span>{{ risk?.unknown||0 }} positions with unknown risk</span></div>
   <p v-if="riskExceeded||projectedExceeded" class="text-amber-700 dark:text-amber-300">Risk limit exceeded{{ riskExceeded?'':' if remaining entries are taken' }}.</p>
   <details><summary>Set portfolio limit and exposure level</summary><div class="grid sm:grid-cols-3 gap-3 mt-3"><label>Limit<input type="number" v-model.number="settings.portfolioLimit" class="input"></label><label>Currency<select v-model="settings.currency" class="input"><option>GBP</option><option>USD</option></select></label><label>Applied level<select v-model.number="settings.selectedLevel" class="input"><option v-for="v in [.05,.1,.2,.3]" :value="v" :key="v">{{ v }}%</option></select></label></div><label class="block mt-3">Reason<input v-model="settings.reason" class="input"></label><button class="btn-secondary mt-3" @click="saveSettings">Save risk settings</button></details>
  </section>
  <template v-if="screen==='Plan'||managing">
   <div class="detail-grid">
    <div class="space-y-5 min-w-0">
     <PlanningSnapshot :url="draft.chartUrl" :asset="asset" :retained-url="retainedUrl"><button v-if="draft.chartUrl&&plan.id&&!retainedUrl" class="btn-secondary" @click="retainChart">Retain chart snapshot</button></PlanningSnapshot>
     <section v-if="!managing" class="card p-5 space-y-4">
      <h2 class="font-semibold text-lg">Setup and entry tactics</h2><div class="setup-summary"><strong>{{ asset }}</strong><label>Setup<TagSelect :model-value="draft.setup?[draft.setup]:[]" :tags="setupTags" :multiple="false" :disabled="true" :show-picker="false" label="Playbook setup"/><small v-if="!setupTags.length">Define a Setup in the selected playbook.</small></label><p>{{ draft.thesis }}</p></div><details :open="!plan.id"><summary>Edit plan details</summary><div class="grid sm:grid-cols-2 gap-4 mt-4">
       <label>Ticker<input v-model="draft.symbol" class="input" :disabled="hasLinks"></label><label>Asset name<input v-model="draft.assetName" class="input"></label>
       <label>Title<input v-model="draft.title" class="input"></label>
       <label>Instrument<select v-model="draft.instrument" class="input" :disabled="hasLinks"><option value="stock">Shares</option><option value="crypto">Crypto</option><option value="spread_bet">Spread betting</option><option value="option">Single-leg option</option></select></label>
       <label>Direction<select v-model="draft.direction" class="input" :disabled="hasLinks"><option value="long">Long / bullish</option><option value="short">Short / bearish</option></select></label>
       <label>Account<select v-model="draft.accountId" class="input" :disabled="hasLinks"><option :value="null">Unassigned</option><option v-for="a in accounts" :value="a.id" :key="a.id">{{ a.accountName }}</option></select></label>
       <label>Playbook<select v-model="draft.playbookId" class="input" @change="offerTemplate"><option :value="null">Choose playbook</option><option v-for="p in playbooks" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>

       <label>Price / risk currency<select v-model="draft.currency" class="input" :disabled="hasLinks"><option>USD</option><option>GBP</option><option>EUR</option></select></label>
      </div><label class="block">Thesis<textarea v-model="draft.thesis" class="input" rows="3"></textarea></label><label class="block mt-4">Snapshot link<input v-model="draft.chartUrl" type="url" class="input"></label></details>
     </section>
    </div>
    <aside class="space-y-5 min-w-0">
     <section v-if="!managing" class="card p-5 space-y-4"><h2 class="font-semibold text-lg">Preparation</h2><label v-for="p in draft.preparation" :key="p.key" class="flex gap-3"><input type="checkbox" v-model="p.done">{{ p.label }}</label><label class="block">Evidence exception reason<textarea v-model="draft.exceptionReason" class="input" rows="2"></textarea></label>
      <details><summary>Define a tag</summary><div class="space-y-3 mt-3"><select v-model="newTag.kind" class="input"><option value="entry">Entry tactic</option><option value="exit">Exit tactic</option><option value="context">Market context</option></select><input v-model="newTag.name" class="input" placeholder="Tag name"><textarea v-model="newTag.definition" class="input" placeholder="Definition"></textarea><button class="btn-secondary" @click="createTag">Add tag</button></div></details>
     </section>
     <section class="card p-5 space-y-4">
      <div class="flex justify-between"><h2 class="font-semibold text-lg">{{ managing?'Position':'Risk and sizing' }}</h2><button class="btn-secondary currency-toggle" :aria-label="'Showing '+positionCurrency+'; switch currency'" @click="positionCurrency=flip(positionCurrency)">{{ symbol(positionCurrency) }}</button></div>
      <template v-if="!managing">
       <label class="block">Portfolio amount ({{ positionCurrency }})<input :value="displayValue(draft.portfolioAmount,positionCurrency,2)" aria-label="Portfolio amount" type="number" step="any" class="input" readonly></label><small>{{ portfolioLoading?'Loading selected-account value…':portfolioCapital?portfolioCapital.label+(portfolioCapital.incomplete?' · Incomplete valuation':''):'Selected-account value unavailable · saved capital shown' }}</small>
       <label class="block">Portfolio risk %<input aria-label="Portfolio risk percent" v-model.number="draft.portfolioRiskPercent" type="number" step="any" class="input" @input="applyPortfolioRisk"></label>
       <label class="flex gap-3"><input v-model="draft.exposureSystem" type="checkbox">Use this plan in exposure recommendations</label><div class="text-right text-sm text-gray-400">Recommended level {{ recommendation?.level==null?'Unavailable':recommendation.level+'%' }}</div>
       <label class="block">Risk amount ({{ positionCurrency }})<input :value="displayValue(draft.riskBudget,positionCurrency)" aria-label="Risk amount" type="number" step="any" class="input" @change="draft.riskBudget=priceValue($event,positionCurrency);syncPortfolioPercent()"></label>

       <details><summary>Quantity increment</summary><label class="block mt-3">Quantity increment<input v-model.number="draft.quantityStep" type="number" step="any" class="input"></label></details>
       <label v-if="draft.instrument==='spread_bet'">Price units per stake point<input v-model.number="draft.pointSize" type="number" step="any" class="input"></label>
      </template>
      <div v-else class="position-metrics"><div class="position-overview">
       <div><small>Linked entries</small><strong>{{ (ledger.records||[]).filter(r=>r.action==='entry'&&r.valid&&!r.fill?.provisional).length }}</strong></div>
       <div><small>Original plan risk</small><strong>{{ convertedMoney(workflow?.baseline?.riskBudget??draft.riskBudget,draft.currency,positionCurrency) }}</strong></div>
       <div><small>Position stage</small><strong class="stage-value">{{ ledger.economicallyClosed?'Has exited':ledger.openQuantity>0?'In trade':'Awaiting entry' }}</strong></div></div>
       <div><small>Total position size</small><strong>{{ convertedMoney(ledger.positionValue,ledger.currency,positionCurrency) }}</strong></div>
       <div><small>Current risk to stop</small><strong>{{ convertedMoney(ledger.capitalRisk,ledger.currency,positionCurrency) }}</strong></div>
       <div><small>Open units</small><strong>{{ number(ledger.openQuantity) }}</strong></div>
       <div><small>AVG price</small><strong>{{ convertedMoney(ledger.averagePrice,ledger.currency,positionCurrency) }}</strong></div>
       <div><small>Total realised profit</small><strong>{{ convertedMoney(ledger.realisedProfit,ledger.currency,positionCurrency) }}</strong></div>
       <div><small>Realised % gain</small><strong>{{ percent(ledger.percentGain) }}</strong></div>
       <div><small>R:R</small><strong>{{ number(ledger.realisedR) }}</strong></div>
      </div>
      <p v-if="ledger.unresolved" class="text-amber-700 dark:text-amber-300">Source fills changed. Correct their links before completing review.</p>
     </section>
    </aside>
   </div>
   <section v-if="draft.instrument==='option'" class="card p-5">
    <h2 class="font-semibold text-lg mb-4">Option contract and sizing</h2>
    <div class="grid sm:grid-cols-3 gap-4">
     <label>Contract<input v-model="draft.options.contract" :disabled="hasLinks" class="input"></label>
     <label>Type<select v-model="draft.options.type" :disabled="hasLinks" class="input"><option>call</option><option>put</option></select></label>
     <label>Expiry<input v-model="draft.options.expiry" :disabled="hasLinks" type="date" class="input"></label>
     <label v-for="k in optionNumbers" :key="k">{{ optionLabels[k] }}<input v-model.number="draft.options[k]" :disabled="hasLinks" type="number" step="any" class="input"></label>
    </div><p class="text-sm text-amber-300 mt-3">ATR/delta stop risk is an estimate. Underlying exit levels do not predict an option's premium.</p>
   </section>
   <template v-for="kind in ['entry','exit']" :key="kind"><section class="card p-5">
    <div class="flex justify-between items-center mb-4"><h2 class="font-semibold text-lg">{{ kind==='entry'?'Entries':'Exits' }}</h2><div class="flex gap-2"><button class="btn-secondary currency-toggle" :aria-label="'Showing '+currencies[kind]+'; switch currency'" @click="currencies[kind]=flip(currencies[kind])">{{ symbol(currencies[kind]) }}</button><button class="btn-secondary" @click="addRow(kind)">Add {{ kind }}</button><button v-if="kind==='exit'&&!rows(kind).some(e=>e.key==='runner')" class="btn-secondary" @click="addRunner">Add runner</button></div></div>
    <div v-if="kind==='entry'" class="flex flex-wrap gap-6 mb-4"><label v-if="!managing">Risk amount <strong>{{ convertedMoney(draft.riskBudget,draft.currency,currencies[kind]) }}</strong></label><label>SL invalidation level <input :value="displayValue(draft.stopPrice,currencies[kind])" type="number" step="any" class="ladder-input" @change="changeStop($event,currencies[kind])"></label></div>
    <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr><th>Fib level</th><th>Price level ({{ symbol(currencies[kind]) }})</th><th>{{ kind==='entry'?'Risk %':'Exit %' }}</th><th>{{ kind==='entry'?(draft.instrument==='option'?'Contracts':'Units (shares to buy)'):'Units sold' }}</th><th>{{ kind==='entry'?'Position size':'Profit at exit' }}</th><th v-if="kind==='exit'&&draft.instrument==='option'">Premium target</th><th>Market context</th><th>{{ kind==='entry'?'Entry tactic':'Exit tactic' }}</th><th v-if="managing">Executed</th><th v-if="managing">Linked trade</th><th></th></tr></thead>
     <tbody><tr v-for="(e,i) in rows(kind)" :key="e.key">
      <td><input v-model="e.label" :aria-label="kind+' '+(i+1)+' Fib level'" class="ladder-input" :disabled="linked(kind,e.key)"></td>
      <td><input :aria-label="kind+' '+(i+1)+' price level'" :value="displayValue(e.price,currencies[kind])" type="number" step="any" class="ladder-input" :disabled="linked(kind,e.key)" @change="e.price=priceValue($event,currencies[kind])"></td>
      <td><input v-if="kind==='entry'" :aria-label="'Entry '+(i+1)+' risk percent'" v-model.number="e.riskWeight" type="number" step="any" class="ladder-input" :disabled="linked(kind,e.key)"><input v-else :aria-label="'Exit '+(i+1)+' percent'" v-model.number="e.percent" type="number" step="any" class="ladder-input" :disabled="linked(kind,e.key)"></td>
      <td><input :aria-label="kind+' '+(i+1)+' units'" :value="e.units??rowUnits(kind,e,i)" type="number" step="any" class="ladder-input" :disabled="linked(kind,e.key)" @change="e.units=Number($event.target.value)"></td>
      <td>{{ convertedMoney(kind==='entry'?calculation?.stages[i]?.positionValue:exitProfit(e),draft.currency,currencies[kind]) }}</td>
      <td v-if="kind==='exit'&&draft.instrument==='option'"><input v-model.number="e.premium" type="number" step="any" class="ladder-input" :disabled="linked(kind,e.key)"></td>
      <td><TagSelect v-model="e.marketContext" :tags="library.context" :disabled="!managing&&linked(kind,e.key)"/></td>
      <td><TagSelect v-model="e.tactics" :tags="library[kind]" :disabled="!managing&&linked(kind,e.key)"/><details v-if="kind==='entry'" class="trigger-details"><summary>Trigger condition</summary><textarea v-model="e.tactic" class="input" :disabled="linked(kind,e.key)" aria-label="Entry trigger condition" rows="2"></textarea></details></td>
      <td v-if="managing"><input type="checkbox" :aria-label="kind+' '+(i+1)+' executed'" :checked="linked(kind,e.key)||e.executed" :disabled="linked(kind,e.key)" @change="e.executed=$event.target.checked"></td>
      <td v-if="managing"><button class="btn-secondary whitespace-nowrap" @click="findFills(kind,e.key)">{{ linked(kind,e.key)?'View / add fills':'Find and link trade' }}</button></td>
      <td><button class="text-red-400" :disabled="linked(kind,e.key)||(kind==='entry'&&draft.entries.length===1)" @click="rows(kind).splice(i,1)">Remove</button></td>
     </tr>

     </tbody><tfoot>
      <tr v-if="kind==='entry'"><th>Total</th><td></td><td>{{ number(draft.entries.reduce((s,e)=>s+Number(e.riskWeight||0),0)) }}%</td><td>{{ number(calculation?.plannedQuantity) }}</td><td>{{ convertedMoney(calculation?.plannedValue,draft.currency,currencies.entry) }}</td></tr>
      <tr v-else><th>Total potential profit</th><td>{{ convertedMoney(calculation?.reward?.fixedTargetProfit,draft.currency,currencies.exit) }}</td><th>Total % gain</th><td>{{ number(potentialPercent) }}%</td><th>R:R</th><td>{{ number(calculation?.reward?.fixedTargetRR) }}</td></tr>
      <tr v-if="kind==='exit'&&managing"><th>Total realised profit</th><td>{{ convertedMoney(ledger.realisedProfit,ledger.currency,currencies.exit) }}</td><th>Realised % gain</th><td>{{ percent(ledger.percentGain) }}</td><th>R:R</th><td>{{ number(ledger.realisedR) }}</td></tr>
     </tfoot></table></div>
    <p v-if="kind==='entry'&&managing" class="text-sm text-gray-400 mt-3">Provisional: ticked rows use entered quantities and levels until fills are linked.</p>
   </section>
   <section v-if="managing&&draft.instrument==='option'&&kind==='entry'" class="card p-5 space-y-4">
    <h2 class="font-semibold text-lg">Roll option</h2><button class="btn-secondary" @click="loadRollFills">Find roll trades</button>
    <div v-if="rollFills.length" class="grid sm:grid-cols-2 gap-4">
     <label>Closing fill<select v-model="roll.closeKey" class="input"><option value="">Select</option><option v-for="f in rollFills.filter(f=>f.action==='exit')" :key="f.tradeId+f.key" :value="f.tradeId+'|'+f.key">{{ f.contract?.symbol }} {{ f.contract?.strike }} {{ f.contract?.expiry }} @ {{ money(f.price,f.currency) }}</option></select></label>
     <label>Opening fill<select v-model="roll.openKey" class="input"><option value="">Select</option><option v-for="f in rollFills.filter(f=>f.action==='entry')" :key="f.tradeId+f.key" :value="f.tradeId+'|'+f.key">{{ f.contract?.symbol }} {{ f.contract?.strike }} {{ f.contract?.expiry }} @ {{ money(f.price,f.currency) }}</option></select></label>
     <label>Contracts closed<input v-model.number="roll.closeQuantity" type="number" class="input" min="1" step="1"></label><label>Contracts opened<input v-model.number="roll.openQuantity" type="number" class="input" min="1" step="1"></label>
     <label>New share-equivalent delta<input v-model.number="roll.delta" type="number" step="any" class="input"></label><label>Reason<input v-model="roll.reason" class="input"></label>
    </div><button v-if="rollFills.length" class="btn-primary" :disabled="busy" @click="recordRoll">Link credit roll</button>
   </section>
   </template>
   <section v-if="managing" class="card p-5"><h2 class="font-semibold text-lg">Final exit</h2><p class="mt-2">{{ ledger.economicallyClosed?'Position has exited':'Link remaining exits to finish the position.' }}</p></section>
   <section v-if="managing" class="card p-5"><h2 class="font-semibold text-lg">Linked trades</h2><div v-for="a in (ledger.records||[]).filter(a=>!a.fill?.provisional)" :key="a.id" class="flex gap-4 flex-wrap border-b border-gray-700 py-3"><RouterLink :to="'/trades/'+a.trade_id" class="text-primary-400">{{ a.action }} · {{ number(a.quantity) }} @ {{ money(a.fill.price,a.fill.currency) }}</RouterLink><span v-if="!a.valid" class="text-amber-700 dark:text-amber-300">Needs reconciliation</span><button class="text-red-400" @click="unlink(a)">Correct link</button></div></section>
   <section v-if="managing&&ledger.provisionalCount" class="card p-5"><h2>Provisional executions · not linked</h2><p>Ticked entries and exits use your entered values until you select a broker trade.</p><div v-for="a in (ledger.records||[]).filter(a=>a.fill?.provisional)" :key="a.id" class="py-3 border-b border-gray-700">{{ a.action }} · {{ number(a.quantity) }} @ {{ money(a.fill.price,a.fill.currency) }} · Provisional</div></section><section v-if="managing" class="card p-5 management-timeline"><h2 class="font-semibold text-lg">Management timeline</h2><div v-for="(e,i) in workflow?.history||[]" :key="i" class="py-3 border-b border-gray-700"><strong>{{ e.event_type.replaceAll('_',' ') }}</strong> · {{ new Date(e.created_at).toLocaleString() }}<p v-if="e.event_type==='stop_changed'">{{ money(e.snapshot.previous,e.snapshot.currency) }} to {{ money(e.snapshot.next,e.snapshot.currency) }} · {{ e.snapshot.reason }}</p><p v-else-if="e.snapshot.reason">{{ e.snapshot.reason }}</p></div></section>
  </template>
  <template v-if="screen==='Review'">
   <section class="card p-5" aria-label="Plan result">
    <div class="result-metrics">
     <div><small>Realised result</small><strong>{{ money(ledger.realisedProfit,ledger.currency) }}</strong></div>
     <div><small>Initial plan risk budget</small><strong>{{ money(workflow?.baseline?.riskBudget??draft.riskBudget,draft.currency) }}</strong></div>
     <div><small>Plan result</small><strong>{{ ledger.realisedR==null?'Unavailable':number(ledger.realisedR)+' R' }}</strong></div>
     <div><small>% gain/loss</small><strong>{{ percent(ledger.percentGain) }}</strong></div>
     <div><small>Evidence</small><strong class="evidence-value">{{ ledger.unresolved?'Needs reconciliation':ledger.economicallyClosed?'Reconciled exits':'Awaiting exits' }}</strong></div>
    </div>
   </section>
   <div class="detail-grid">
    <div class="space-y-5 min-w-0">
     <section class="card p-5"><h2>Original plan → actual execution</h2>
      <p class="mb-4">{{ asset }} · {{ draft.instrument==='option'?'Single-leg option':'Shares / '+draft.instrument }} · {{ draft.direction }}</p>
      <details class="mb-4"><summary>Linked trades</summary><div class="linked-review-trades"><RouterLink v-for="id in [...new Set((ledger.records||[]).filter(a=>!a.fill.provisional).map(a=>a.trade_id))]" :key="id" :to="'/trades/'+id" class="text-primary-400">Open trade · playbook review {{ workflow?.tradeReviews?.find(r=>r.trade_id===id)?'completed':'not completed' }}</RouterLink><p v-if="!ledger.records?.length" class="text-gray-400">No source trades linked.</p></div></details>
      <div class="table-scroll"><table class="w-full"><thead><tr><th>Action</th><th>Planned tactic</th><th>Actual tactic used</th><th>Actual / assessment</th></tr></thead><tbody><tr v-for="k in ['entry','exit']" :key="k"><td class="capitalize">{{ k }}</td><td>{{ baselineTags(k)||'—' }}</td><td>{{ actualTags(k)||'—' }}</td><td><textarea v-model="review[k+'Assessment']" class="input deviation-textarea" rows="3" :aria-label="k+' deviations'" placeholder="Describe deviations"></textarea></td></tr></tbody></table></div>
     </section>
     <section class="card p-5 space-y-4"><h2>Playbook assessment</h2><label class="flex gap-3"><input v-model="review.processFollowed" type="checkbox">Process followed</label><label class="block">Lessons · repeat / change<textarea v-model="review.notes" class="input" rows="4"></textarea></label><div class="flex gap-3 flex-wrap"><button class="btn-secondary" :disabled="busy" @click="saveReviewDraft">Save review draft</button><button class="btn-primary" :disabled="busy||!ledger.economicallyClosed" @click="saveReview">Complete review</button></div></section>
    </div>
    <aside class="space-y-5 min-w-0">
     <section class="card p-5"><h2>Whole-plan timeline</h2><div v-for="m in milestones" :key="m.label" class="risk-row"><span>{{ m.label }}</span><strong>{{ m.date }}</strong></div><div class="risk-row"><span>Final exit</span><strong>{{ finalExitDate }}</strong></div><div class="risk-row"><span>Stage</span><strong>{{ plan.status.replaceAll('_',' ') }}</strong></div></section>
     <section class="card p-5 space-y-3"><h2>Review and reconciliation</h2><p v-if="workflow?.needsUpdate" class="text-amber-700 dark:text-amber-300">Review needs updating because source evidence changed.</p><p v-else>{{ ledger.economicallyClosed?'All linked exits reconciled.':'Reconcile all exits before completing review.' }}</p><p v-if="ledger.unresolved" class="text-amber-700 dark:text-amber-300">Correct changed source-fill links before completing review.</p></section>
     <section class="card p-5 space-y-3"><h2>Linked analysis</h2><RouterLink to="/analysis/playbooks" class="text-primary-400 block">Playbook analysis</RouterLink><RouterLink to="/diary" class="text-primary-400 block">Journal</RouterLink></section>
    </aside>
   </div>
  </template>
  <div v-if="screen==='Close'" class="completion-summary">
   <section class="card p-5 space-y-4"><h2>Completion checks</h2>
    <div class="risk-row"><span>Position has exited / final exit confirmed</span><strong>{{ ledger.economicallyClosed?'Confirmed':'Pending' }}</strong></div>
    <div class="risk-row"><span>Whole-plan review completed</span><strong>{{ workflow?.needsUpdate?'Needs updating':['reviewed','completed'].includes(plan.status)?'Completed':'Pending' }}</strong></div>
    <div class="risk-row"><span>Entries, exits and lessons retained</span><strong>One plan history</strong></div>
    <p>{{ plan.status==='completed'?'Completed plan retained with its trade links and review.':'Close finishes the reviewed plan.' }}</p>
    <button v-if="plan.status!=='completed'" class="btn-primary" :disabled="plan.status!=='reviewed'||workflow?.needsUpdate||busy" @click="action('complete')">Close reviewed plan</button><button v-else class="btn-secondary" @click="reopenReview">Reopen review</button>
   </section>
   <section class="card p-5 space-y-4"><h2>Completed plans and reviews</h2><p>Open the original plan, its management history and the saved review here, or find it in All plans and the calendar.</p><div class="flex flex-wrap gap-3"><button class="btn-secondary" @click="moveScreen('Plan')">View original plan</button><button class="btn-secondary" @click="moveScreen('Trade & Manage')">View entries, management and exits</button><button class="btn-secondary" @click="moveScreen('Review')">View saved review</button></div></section>
  </div>
  <div class="flex justify-between flex-wrap gap-3"><button class="btn-secondary" :disabled="busy||plan.status==='completed'" @click="save">Save changes</button><button v-if="screen==='Plan'" class="btn-primary" :disabled="busy" @click="continueToManage">{{ plan.status==='ready'?'Continue to Trade & Manage':'Finalise plan · Ready' }}</button><button v-if="managing" class="btn-primary" @click="moveScreen('Review')">Continue to Review</button><button v-if="screen==='Review'" class="btn-primary" @click="moveScreen('Close')">Continue to Close</button></div>
  <div v-if="finder" class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-5" role="dialog" aria-modal="true" aria-labelledby="fill-title"><section class="card p-6 max-w-5xl w-full max-h-[85vh] overflow-auto space-y-4"><div class="flex justify-between"><h2 id="fill-title" class="text-lg font-semibold">Find and link {{ finder.action }}</h2><button class="btn-secondary" @click="finder=null">Close</button></div><p class="text-sm text-gray-400">{{ asset }} · {{ instrumentLabel }} · {{ accounts.find(a=>a.id===draft.accountId)?.accountName||'Unassigned' }} · {{ draft.direction==='short'?'Short / bearish':'Long / bullish' }}</p><p v-if="!fills.length">No matching {{ finder.action }} fills with available quantity for this asset, instrument and account.</p><div v-for="f in fills" :key="f.tradeId+f.key" class="grid sm:grid-cols-[1fr_8rem_10rem] gap-3 items-center border-b border-gray-700 py-3"><span>{{ new Date(f.time).toLocaleString() }} · {{ number(f.available) }} @ {{ money(f.price,f.currency) }} · {{ f.action }}</span><input v-model.number="f.allocate" type="number" step="any" min="0" :max="f.available" class="input" aria-label="Allocation quantity"><button class="btn-primary" :disabled="busy||!(f.allocate>0)" @click="linkFill(f)">Link fill</button></div><label class="flex gap-3"><input v-model="splitConfirmed" type="checkbox">Confirm splitting a fill already used by another plan.</label><p v-if="error" role="alert" class="text-red-400">{{ error }}</p></section></div>
 </div>
</template>

<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue'
import api from '@/services/api'
import PlanningSnapshot from './PlanningSnapshot.vue'
import TagSelect from './PlanningTagSelect.vue'
const props=defineProps({plan:Object,accounts:Array,playbooks:Array,commitments:{type:Array,default:()=>[]},portfolioCapital:{type:Object,default:null},portfolioLoading:Boolean}),emit=defineEmits(['updated'])
const managed=ref({entry:[],exit:[]}),plan=ref(props.plan),draft=ref(null),screen=ref('Plan'),busy=ref(false),error=ref(''),calculation=ref(null),workflow=ref(null),risk=ref(null)
const planCommitments=computed(()=>props.commitments.filter(c=>c.plan_id===plan.value.id))
const screens=['Plan','Trade & Manage','Review','Close'],managing=computed(()=>screen.value==='Trade & Manage')
const currencies=ref({entry:'USD',exit:'USD'}),positionCurrency=ref('GBP'),tags=ref([]),fx=ref(null),settings=ref({portfolioLimit:null,currency:'GBP',selectedLevel:.3,reason:''})
const retainedUrl=ref(''),recommendation=ref(null),rollFills=ref([]),roll=ref({closeKey:'',openKey:'',closeQuantity:1,openQuantity:1,delta:null,reason:''})
const newTag=ref({kind:'entry',name:'',definition:''}),finder=ref(null),fills=ref([]),splitConfirmed=ref(false),review=ref({notes:'',entryAssessment:'',exitAssessment:'',processFollowed:false})
const optionNumbers=['strike','premium','multiplier','contractDelta','atr','atrMultiplier'],optionLabels={strike:'Strike',premium:'Premium',multiplier:'Contract multiplier',contractDelta:'Share-equivalent delta',atr:'Completed-candle ATR',atrMultiplier:'ATR multiplier'}
let previewTimer,saveTimer,sequence=0,hydrating=false,dirty=false
const ledger=computed(()=>workflow.value?.ledger||{}),hasLinks=computed(()=>!!ledger.value.records?.some(a=>!a.fill?.provisional))
const instrumentLabel=computed(()=>({stock:'Shares',crypto:'Crypto',spread_bet:'Spread betting',option:'Single-leg option'}[draft.value?.instrument]||draft.value?.instrument))
const asset=computed(()=>draft.value?.assetName?draft.value.assetName+' ('+draft.value.symbol+')':draft.value?.symbol||'Plan')
function applyPlaybookSetup(){const book=props.playbooks.find(p=>p.id===draft.value?.playbookId);if(book)draft.value.setup=book.requiredSetup||''}
const setupTags=computed(()=>{const book=props.playbooks.find(p=>p.id===draft.value?.playbookId);return book?.requiredSetup?[{id:book.id,name:book.requiredSetup,definition:book.requiredSetup}]:[]})
function materializeRunner(d){if(d.runnerMode==='row')return;const percent=Math.max(0,100-d.exits.reduce((s,e)=>s+Number(e.percent||0),0));if(percent>0&&!d.exits.some(e=>e.key==='runner'))d.exits.push({key:'runner',label:'Runner',price:d.runnerEstimatePrice??null,percent,units:null,premium:null,marketContext:[],tactics:[]});d.runnerMode='row'}
function syncPortfolioPercent(){draft.value.portfolioRiskPercent=draft.value.portfolioAmount>0&&draft.value.riskBudget!=null?draft.value.riskBudget/draft.value.portfolioAmount*100:null}
function applySelectedCapital(){if(!draft.value||!props.portfolioCapital||!fx.value)return;const r=rate(props.portfolioCapital.currency,draft.value.currency);if(!r)return;hydrating=true;draft.value.portfolioAmount=props.portfolioCapital.amount*r;syncPortfolioPercent();queueMicrotask(()=>hydrating=false)}
const library=computed(()=>Object.fromEntries(['entry','exit','context'].map(k=>[k,tags.value.filter(t=>t.kind===k)])))
const milestones=computed(()=>[{label:'Planned',type:'ready'},{label:'Entry',type:'trade_linked'},{label:'Review',type:'reviewed'}].map(m=>{
 const events=(workflow.value?.history||[]).filter(e=>e.event_type===m.type&&(m.type!=='trade_linked'||e.snapshot?.action==='entry')).map(e=>m.type==='trade_linked'?e.snapshot?.source?.time||e.created_at:e.created_at).sort();
 return {label:m.label,date:events.length?new Date(events[0]).toLocaleDateString():'Pending'};
}))

const finalExitDate=computed(()=>{
 const dates=(ledger.value.records||[]).filter(r=>r.action==='exit'&&r.valid).map(r=>r.fill?.time).filter(Boolean).sort();
 return ledger.value.economicallyClosed&&dates.length?new Date(dates.at(-1)).toLocaleDateString():'Pending';
})

function symbol(c){return c==='GBP'?'£':c==='USD'?'$':c}
const flip=c=>c==='USD'?'GBP':'USD'
function money(v,c){if(v==null||v===''||!Number.isFinite(Number(v)))return 'Unavailable';return new Intl.NumberFormat(undefined,{style:'currency',currency:c||'USD'}).format(v)}
const number=v=>v==null||!Number.isFinite(Number(v))?'Unavailable':Number(v).toLocaleString(undefined,{maximumFractionDigits:6})
const percent=v=>v==null?'Unavailable':number(v)+'%'
function rate(from,to){if(from===to)return 1;const rates={USD:1,...fx.value?.rates};return rates[from]>0&&rates[to]>0?rates[to]/rates[from]:null}
function convertedMoney(v,from,to){const r=rate(from,to);if(v===0)return money(0,to);return v==null?'Unavailable':r?money(v*r,to):'FX unavailable'}
function displayValue(v,to,decimals){const r=rate(draft.value.currency,to);if(v==null||!r)return '';return decimals==null?Number((v*r).toFixed(6)):(v*r).toFixed(decimals)}
function priceValue(e,from){if(e.target.value==='')return null;const r=rate(from,draft.value.currency);if(!r){error.value='Stored FX is unavailable';throw new Error('FX unavailable')}return Number(e.target.value)*r}
function rows(k){return managing.value?managed.value[k]:draft.value[k==='entry'?'entries':'exits']}
function linked(k,key){return ledger.value.records?.some(a=>!a.fill?.provisional&&a.action===k&&a.stage_key===key)}
function rowUnits(k,e,i){return k==='entry'?calculation.value?.stages[i]?.quantity:(calculation.value?.plannedQuantity||0)*e.percent/100}
const runnerPercent=computed(()=>Math.max(0,100-(draft.value?.exits||[]).reduce((s,e)=>s+Number(e.percent||0),0)))
const potentialPercent=computed(()=>calculation.value?.plannedValue>0&&calculation.value?.reward?.fixedTargetProfit!=null?calculation.value.reward.fixedTargetProfit/calculation.value.plannedValue*100:null)
function exitProfit(e){
 const q=e.units??(calculation.value?.plannedQuantity||0)*e.percent/100,total=calculation.value?.plannedQuantity;if(!(total>0))return null
 if(draft.value.instrument==='option')return e.premium>0&&draft.value.options.premium>0?q*(e.premium-draft.value.options.premium)*draft.value.options.multiplier:null
 if(!(e.price>0))return null
 const avg=calculation.value.stages.reduce((s,a)=>s+a.quantity*a.price,0)/total
 return q*(draft.value.direction==='short'?avg-e.price:e.price-avg)*(draft.value.instrument==='spread_bet'?1/draft.value.pointSize:1)
}
const currentRisk=computed(()=>{const r=risk.value;if(!r)return null;const provisional=ledger.value.provisionalCount>0&&ledger.value.capitalRisk!=null&&!(r.positions||[]).some(p=>p.symbol===draft.value.symbol&&p.accountId===draft.value.accountId)?ledger.value.capitalRisk*(rate(ledger.value.currency,r.currency)||0):0;return r.knownRisk+provisional})
const projectedRisk=computed(()=>{if(!risk.value||!calculation.value)return null;const r=rate(draft.value.currency,risk.value.currency);return r?currentRisk.value+calculation.value.stages.filter(s=>!linked('entry',s.key)&&!managed.value.entry.find(e=>e.key===s.key)?.executed&&!planCommitments.value.some(c=>c.stage_key===s.key)).reduce((sum,s)=>sum+(s.estimatedRisk||0)*r,0):null})
const riskExceeded=computed(()=>risk.value?.limit&&currentRisk.value>risk.value.limit),projectedExceeded=computed(()=>risk.value?.limit&&projectedRisk.value>risk.value.limit)
function barWidth(v){const scale=risk.value?.limit?risk.value.limit/0.8:Math.max(projectedRisk.value||0,1);return Math.min(100,Math.max(0,(v||0)/scale*100))}
function clean(){const d=JSON.parse(JSON.stringify(draft.value));d.symbol=d.symbol.trim().toUpperCase();for(const k of ['riskBudget','stopPrice','runnerEstimatePrice','portfolioAmount','portfolioRiskPercent'])if(d[k]==='')d[k]=null;for(const e of [...d.entries,...d.exits])for(const k of ['price','units','premium'])if(e[k]==='')e[k]=null;for(const k of ['strike','premium','contractDelta','atr','expiry','asOf'])if(d.options[k]==='')d.options[k]=null;return d}
function fail(e){error.value=e.response?.data?.error||'Request failed. Your edits remain here.'}
function adopt(p){hydrating=true;plan.value=p;draft.value=JSON.parse(JSON.stringify(p.definition));materializeRunner(draft.value);for(const e of [...draft.value.entries,...draft.value.exits]){e.marketContext??=[];e.tactics??=[];e.units??=null}draft.value.exposureSystem??=false;draft.value.setup??='';applyPlaybookSetup();draft.value.portfolioAmount??=null;draft.value.portfolioRiskPercent??=null;calculation.value=p.calculation;applySelectedCapital();dirty=false;hydrateManagement();queueMicrotask(()=>hydrating=false)}

function hydrateManagement(){
 hydrating=true;
 for(const kind of ['entry','exit'])managed.value[kind]=(draft.value?.[kind==='entry'?'entries':'exits']||[]).map(e=>{
  const m=plan.value.management?.[kind]?.[e.key]||{},a=ledger.value.records?.filter(a=>a.action===kind&&a.stage_key===e.key&&!a.fill.provisional)||[];
  const q=a.reduce((sum,a)=>sum+a.quantity,0),price=q>0?a.reduce((sum,a)=>sum+a.quantity*a.fill.price*(rate(a.fill.currency,draft.value.currency)||1),0)/q:null;
  return {...JSON.parse(JSON.stringify(e)),...m,...(a.length?{units:q,price,executed:true}:{}),executed:a.length?true:!!m.executed,time:m.time||new Date().toISOString()}
 });
 queueMicrotask(()=>hydrating=false)
}
async function saveManagement(){
 const management=Object.fromEntries(['entry','exit'].map(k=>[k,Object.fromEntries(managed.value[k].map(e=>[e.key,{executed:!!e.executed,units:e.units??rowUnits(k,e,managed.value[k].indexOf(e)),price:e.price,time:e.time||new Date().toISOString(),tactics:e.tactics||[],marketContext:e.marketContext||[],...(k==='exit'?{percent:e.percent,premium:e.premium??null}:{})}]))]));
 await api.put('/trade-plans/'+plan.value.id+'/management',{version:plan.value.version,management});
 await reload()
}
async function loadChart(){try{const r=await api.get('/trade-plans/'+plan.value.id+'/chart',{responseType:'blob'});if(retainedUrl.value)URL.revokeObjectURL(retainedUrl.value);retainedUrl.value=URL.createObjectURL(r.data)}catch{if(retainedUrl.value)URL.revokeObjectURL(retainedUrl.value);retainedUrl.value=''}}
async function retainChart(){if(dirty&&!await save())return;try{await api.post('/trade-plans/'+plan.value.id+'/chart');await loadChart()}catch(e){fail(e)}}
async function reload(){const r=await api.get('/trade-plans/'+plan.value.id);adopt(r.data.plan);emit('updated',r.data.plan);workflow.value=(await api.get('/trade-plans/'+plan.value.id+'/workflow')).data;hydrateManagement();const savedReview=workflow.value.review||workflow.value.reviewDraft;if(savedReview)review.value={notes:savedReview.notes,entryAssessment:savedReview.entryAssessment,exitAssessment:savedReview.exitAssessment,processFollowed:savedReview.processFollowed};risk.value=(await api.get('/trade-plans/risk')).data;await loadChart()}
async function save(){clearTimeout(saveTimer);if(busy.value)return false;busy.value=true;error.value='';try{if(managing.value&&plan.value.id){await saveManagement();return true}const body={definition:clean(),version:plan.value.version};const r=plan.value.id?await api.put('/trade-plans/'+plan.value.id,body):await api.post('/trade-plans',body);adopt(r.data.plan);emit('updated',r.data.plan);return true}catch(e){fail(e);return false}finally{busy.value=false}}
async function moveScreen(s){if(screen.value==='Review'&&!['reviewed','completed'].includes(plan.value.status)&&review.value.notes&&!await saveReviewDraft())return;if(dirty&&plan.value.id&&!await save())return;screen.value=s}
async function releaseCommitment(c){
 const reason=window.prompt('Why is this unfilled commitment being released?');
 if(!reason||!window.confirm('Confirm that the order was never placed or has been cancelled and is no longer live.'))return;
 await action('commitments/'+c.id+'/release',{externalOrderNotLive:true,reason})
}
async function action(name,body={}){if(busy.value)return;busy.value=true;error.value='';try{await api.post('/trade-plans/'+plan.value.id+'/'+name,{version:plan.value.version,...body});await reload()}catch(e){fail(e)}finally{busy.value=false}}
async function continueToManage(){if(plan.value.status==='ready'&&!dirty){screen.value='Trade & Manage';return}if(!await save())return;if(['draft','watching'].includes(plan.value.status))await action('status',{status:'ready'});if(!error.value)screen.value='Trade & Manage'}
async function findFills(kind,key){if(dirty&&!await save())return;if(!plan.value.id){error.value='Save and finalise the plan before linking a trade';return}error.value='';finder.value={action:kind,stageKey:key};try{fills.value=(await api.get('/trade-plans/'+plan.value.id+'/fills')).data.fills.filter(f=>f.action===kind).map(f=>({...f,allocate:f.available}))}catch(e){fail(e)}}
async function linkFill(f){await action('allocations',{tradeId:f.tradeId,sourceKey:f.key,fingerprint:f.fingerprint,stageKey:finder.value.stageKey,action:finder.value.action,quantity:f.allocate,splitConfirmed:splitConfirmed.value});if(!error.value)finder.value=null}
async function unlink(a){const reason=window.prompt('Why are you correcting this link?');if(!reason)return;busy.value=true;try{await api.delete('/trade-plans/'+plan.value.id+'/allocations/'+a.id,{data:{version:plan.value.version,reason}});await reload()}catch(e){fail(e)}finally{busy.value=false}}
async function changeStop(e,c){let price;try{price=priceValue(e,c)}catch{return}if(hasLinks.value||managing.value){const reason=window.prompt('Why are you changing the SL invalidation level?');if(!reason){e.target.value=displayValue(draft.value.stopPrice,c);return}if(dirty&&!await save())return;await action('stop',{stopPrice:price,reason})}else draft.value.stopPrice=price}

async function loadRollFills(){if(dirty&&!await save())return;try{rollFills.value=(await api.get('/trade-plans/'+plan.value.id+'/fills',{params:{purpose:'roll'}})).data.fills.filter(f=>f.contract)}catch(e){fail(e)}}
async function recordRoll(){
 const select=(key,quantity)=>{const f=rollFills.value.find(f=>f.tradeId+'|'+f.key===key);if(!f)throw new Error('Choose both roll fills');return {tradeId:f.tradeId,sourceKey:f.key,fingerprint:f.fingerprint,quantity}}
 try{await action('roll',{close:select(roll.value.closeKey,roll.value.closeQuantity),open:select(roll.value.openKey,roll.value.openQuantity),delta:roll.value.delta,reason:roll.value.reason});if(!error.value)rollFills.value=[]}catch(e){error.value=e.message}
}

async function saveReviewDraft(){
 if(busy.value)return false;busy.value=true;error.value='';
 try{await api.put('/trade-plans/'+plan.value.id+'/review-draft',{version:plan.value.version,...review.value});await reload();return true}catch(e){fail(e);return false}finally{busy.value=false}
}
async function saveReview(){await action('review',{...review.value});if(!error.value)screen.value='Close'}
async function reopenReview(){const reason=window.prompt('Why reopen the review?');if(reason){await action('reopen-review',{reason});if(!error.value)screen.value='Review'}}
async function saveSettings(){try{settings.value=(await api.put('/trade-plans/settings',settings.value)).data.settings;recommendation.value=(await api.get('/trade-plans/recommendation')).data;risk.value=(await api.get('/trade-plans/risk')).data}catch(e){fail(e)}}
async function createTag(){try{const r=await api.post('/trade-plans/library',newTag.value);tags.value=tags.value.filter(t=>t.id!==r.data.tag.id).concat(r.data.tag);newTag.value={kind:'entry',name:'',definition:''}}catch(e){fail(e)}}
function applyPortfolioRisk(){if(draft.value.portfolioAmount>0&&typeof draft.value.portfolioRiskPercent==='number'&&draft.value.portfolioRiskPercent>0)draft.value.riskBudget=draft.value.portfolioAmount*draft.value.portfolioRiskPercent/100}
function addRunner(){rows('exit').push({key:'runner',label:'Runner',price:null,percent:0,units:null,premium:null,marketContext:[],tactics:[]})}
function addRow(k){rows(k).push(k==='entry'?{key:crypto.randomUUID().replaceAll('-',''),label:'Entry '+(rows(k).length+1),price:null,riskWeight:0,units:null,tactic:'',marketContext:[],tactics:[]}:{key:crypto.randomUUID().replaceAll('-',''),label:'TP'+(rows(k).length+1),price:null,percent:0,units:null,premium:null,marketContext:[],tactics:[]})}
function offerTemplate(){applyPlaybookSetup();const t=props.playbooks.find(p=>p.id===draft.value.playbookId)?.planningTemplate;if(!t||hasLinks.value||!window.confirm('Apply this playbook template and replace unlinked rows?'))return;draft.value.entries=t.entries.map(e=>({...e,price:null,units:null,tactic:e.tactic||'',marketContext:[],tactics:[]}));draft.value.exits=t.exits.map(e=>({...e,price:null,units:null,marketContext:[],tactics:[]}));draft.value.runnerRule=t.runnerRule||'';draft.value.runnerMode='legacy';materializeRunner(draft.value)}
function baselineTags(k){return (workflow.value?.baseline?.[k==='entry'?'entries':'exits']||[]).flatMap(e=>e.tactics||[e.tactic]).filter(Boolean).join(', ')}
function actualTags(k){return managed.value[k].flatMap(e=>e.tactics||[e.tactic]).filter(Boolean).join(', ')}
watch([()=>props.portfolioCapital,()=>draft.value?.currency,fx],applySelectedCapital,{deep:true})
watch(()=>props.playbooks,()=>{if(!draft.value)return;hydrating=true;applyPlaybookSetup();queueMicrotask(()=>hydrating=false)},{deep:true})
watch(()=>props.plan,p=>{if(p&&(p.id!==plan.value?.id||p.version!==plan.value?.version))adopt(p)})
watch(()=>draft.value?.instrument,v=>{if(v==='option'&&!hydrating)draft.value.quantityStep=1})
function previewDefinition(){const d=clean();if(managing.value){d.entries=managed.value.entry.map(({executed,time,...e})=>e);d.exits=managed.value.exit.map(({executed,time,...e})=>e)}return d}
watch([draft,managed],()=>{if(hydrating)return;dirty=true;clearTimeout(saveTimer);if(plan.value.id&&!planCommitments.value.length&&!['reviewed','completed','cancelled'].includes(plan.value.status))saveTimer=setTimeout(save,900);clearTimeout(previewTimer);const seq=++sequence;previewTimer=setTimeout(async()=>{try{const r=await api.post('/trade-plans/calculate',{definition:previewDefinition()});if(seq===sequence)calculation.value=r.data.calculation}catch(e){fail(e)}},350)},{deep:true})
function leaving(e){if(dirty){e.preventDefault();e.returnValue=''}}
onMounted(async()=>{adopt(props.plan);window.addEventListener('beforeunload',leaving);try{const r=await api.get('/trade-plans/library');tags.value=r.data.tags||[];fx.value=r.data.fx;settings.value={...settings.value,...r.data.settings};recommendation.value=(await api.get('/trade-plans/recommendation')).data;if(plan.value.id)await reload()}catch(e){fail(e)}})
onBeforeUnmount(()=>{if(retainedUrl.value)URL.revokeObjectURL(retainedUrl.value);clearTimeout(saveTimer);clearTimeout(previewTimer);window.removeEventListener('beforeunload',leaving)})
</script>
<style scoped>
.planning-workspace{container-type:inline-size;container-name:planning;min-width:0;display:flex;flex-direction:column;gap:18px;font-size:15px;line-height:1.5}
.planning-workspace>.card,.detail-grid .card,.completion-summary .card{border-radius:10px;padding:22px;border:1px solid #374151;box-shadow:none}
.journey{display:flex;justify-content:space-between;gap:12px;padding:10px 0}
.journey>div{border-left:2px solid #fb923c;padding-left:9px;flex:1;font-size:12px}
.journey strong{font-size:14px;font-weight:600;margin-top:2px}
.workflow-tabs{display:flex;flex-wrap:wrap;gap:27px;border-bottom:1px solid #374151}
.workflow-tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;padding:10px 0;min-height:44px;color:#9ca3af;font-weight:500}
.workflow-tabs button.active{border-color:#fb923c;color:#fb923c}
.detail-grid{min-width:0;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,1fr);gap:18px}
h2{font-size:18px;font-weight:600;margin:0 0 16px;line-height:1.4}
.planning-workspace label{font-size:13px;color:#d1d5db}
.planning-workspace label .input{margin-top:6px}
.planning-workspace .input{border-radius:6px;border:1px solid #4b5563;background:#111827;padding:10px;color:#f3f4f6;font-size:14px;min-height:42px;box-shadow:none}
.planning-workspace button{min-height:42px}
.planning-workspace button.text-red-400{font-size:12px}
.currency-toggle{min-width:42px;font-size:18px;color:#fb923c;padding:6px 12px}
th{text-align:left;font-size:12px;font-weight:600;color:#9ca3af;white-space:nowrap}
td,th{padding:16px 11px;border-bottom:1px solid #374151;vertical-align:top;font-variant-numeric:tabular-nums}
td:first-child,th:first-child{padding-left:0}
tbody tr:last-child td{border-bottom:0}
tfoot{border-top:1px solid #4b5563}
tfoot th,tfoot td{font-size:14px;white-space:nowrap}
small{color:#9ca3af}
.ladder-input{width:120px;min-width:120px;max-width:120px;height:42px;border-radius:8px;border:1px solid #4b5563;background:#111827;padding:8px 10px;color:inherit;font:inherit;font-size:14px;appearance:textfield}
input::-webkit-inner-spin-button,input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
input[type=checkbox]{width:18px;height:18px;flex-shrink:0;accent-color:#f97316;margin-top:2px}
button:disabled,input:disabled{opacity:.6}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid #fb923c;outline-offset:3px}
.setup-summary{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}.setup-summary span{color:#9ca3af;font-size:13px}.setup-summary p{font-size:14px}
summary{cursor:pointer;font-size:13px;color:#9ca3af;min-height:28px}
.trigger-details{margin-top:8px;max-width:220px}
.position-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:20px;font-variant-numeric:tabular-nums}
.position-overview{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.position-overview strong{font-size:20px}
.position-metrics small,.result-metrics small{display:block;font-size:12px;margin-bottom:5px}
.position-metrics strong,.result-metrics strong{display:block;font-size:24px;font-weight:600;overflow-wrap:anywhere}
.position-metrics .stage-value,.result-metrics .evidence-value{font-size:17px}
.result-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:20px}
.risk-row{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid #374151;font-size:14px}
.risk-row strong{text-align:right;font-weight:500}
.completion-summary{width:100%;max-width:820px;align-self:center;display:flex;flex-direction:column;gap:18px}
.table-scroll{overflow-x:auto}
.deviation-textarea{min-width:250px;min-height:80px}
.linked-review-trades{display:flex;flex-direction:column;gap:10px;padding-top:12px;font-size:14px}
.management-timeline>div{border-left:2px solid #fb923c;padding-left:12px;margin-left:4px}
@container planning (max-width:850px){.detail-grid{grid-template-columns:minmax(0,1fr)}}
@media(max-width:850px){.detail-grid{grid-template-columns:minmax(0,1fr)}}
@media(max-width:600px){.planning-workspace>.card,.detail-grid .card,.completion-summary .card{padding:16px}.workflow-tabs{gap:18px}.workflow-tabs button{font-size:14px}.position-metrics{gap:16px}.position-metrics strong,.result-metrics strong{font-size:21px}}

:global(html:not(.dark) .planning-workspace label){color:#374151}
:global(html:not(.dark) .planning-workspace .input),:global(html:not(.dark) .planning-workspace .ladder-input){background:#fff;color:#111827;border-color:#d1d5db}
:global(html:not(.dark) .planning-workspace .card){border-color:#d1d5db}
:global(html:not(.dark) .planning-workspace th),:global(html:not(.dark) .planning-workspace small),:global(html:not(.dark) .planning-workspace summary){color:#4b5563}
:global(html:not(.dark) .planning-workspace .position-metrics small),:global(html:not(.dark) .planning-workspace .result-metrics small){color:#4b5563}
</style>
