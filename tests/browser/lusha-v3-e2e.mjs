import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"

const base = process.env.LUSHA_BROWSER_BASE || "http://127.0.0.1:3113"
const debuggerBase = process.env.LUSHA_BROWSER_CDP || "http://127.0.0.1:9339"
const databasePath = process.env.LUSHA_BROWSER_DB
const phase = process.env.LUSHA_BROWSER_PHASE || "search"
if (!databasePath?.startsWith("/private/tmp/") && !databasePath?.startsWith("/tmp/")) throw new Error("LUSHA_BROWSER_DB must name a disposable /tmp SQLite file")
if (!base.startsWith("http://127.0.0.1:")) throw new Error("Browser acceptance requires a loopback application")

const db = new DatabaseSync(databasePath)
const created = await fetch(`${debuggerBase}/json/new?about:blank`, { method: "PUT" }).then(response => response.json())
const socket = new WebSocket(created.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }) })
let nextId = 1
const pending = new Map()
const errors = []
const network = []
const httpFailures = []
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data)
  if (message.id) { const task = pending.get(message.id); if (task) { pending.delete(message.id); if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result) } }
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text)
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") errors.push(message.params.entry.text)
  if (message.method === "Network.requestWillBeSent") network.push({ url: message.params.request.url, method: message.params.request.method })
  if (message.method === "Network.responseReceived" && message.params.response.status >= 400) httpFailures.push({ url: message.params.response.url, status: message.params.response.status })
})
function cdp(method, params = {}) {
  const id = nextId++
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
}
async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
async function waitFor(expression, timeoutMs = 12000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try { const value = await evaluate(expression); if (value) return value } catch { /* navigation replaces the execution context */ }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`Browser condition timed out: ${expression}`)
}
async function waitDb(query, timeoutMs = 12000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) { if (db.prepare(query).get()?.n) return; await new Promise(resolve => setTimeout(resolve, 150)) }
  throw new Error(`Database condition timed out: ${query}`)
}
async function navigate(path) { await cdp("Page.navigate", { url: `${base}${path}` }); await waitFor("document.readyState === 'complete'") }
async function clickButton(text, nth = 0) {
  const expression = `(() => { const buttons = [...document.querySelectorAll('button')].filter(item => item.textContent?.trim().includes(${JSON.stringify(text)})); const item = buttons[${nth}]; if (!item || item.disabled) return null; item.scrollIntoView({block:'center'}); const r=item.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`
  const point = await evaluate(expression)
  assert.ok(point, `Expected enabled button: ${text} #${nth}`)
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 })
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 })
}
async function clickLink(text) {
  assert.equal(await evaluate(`(() => { const item = [...document.querySelectorAll('a')].find(item => item.textContent?.trim().includes(${JSON.stringify(text)})); if (!item) return false; item.click(); return true })()`), true)
}
async function clickLabel(text) {
  const point = await evaluate(`(() => { const item=[...document.querySelectorAll('label')].find(x=>x.textContent.includes(${JSON.stringify(text)})); if(!item)return null; item.scrollIntoView({block:'center'}); const r=item.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
  assert.ok(point, `Expected label: ${text}`)
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 })
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 })
}
async function snapshot(label) {
  const state = await evaluate("({url:location.href,text:document.body.innerText.slice(-3500),buttons:[...document.querySelectorAll('button')].filter(x=>x.offsetParent!==null).map(x=>x.textContent.trim()).slice(-25)})")
  console.log(`BROWSER ${label}`, JSON.stringify(state))
  return state
}

try {
  await cdp("Page.enable")
  await cdp("Runtime.enable")
  await cdp("Log.enable")
  await cdp("Network.enable")
  await navigate(phase === "pcom" ? "/login/pcom" : "/login/admin")
  await clickLink(phase === "pcom" ? "Enter local PCOM workspace" : "Enter local Admin workspace")
  await waitFor(phase === "pcom" ? "location.search.includes('tab=overview') && document.body?.innerText.includes('Overview')" : "location.search.includes('tab=admin') && document.body?.innerText.includes('Administration')")
  await waitFor("!document.body?.innerText.includes('Connecting to shared database')")
  await clickButton("Enrichment")
  await waitFor("document.body?.innerText.includes('Ada Demo-Only')")
  if (phase === "pcom") {
    await snapshot("pcom_enrichment")
    const reads = await evaluate("Promise.all([fetch('/api/enrichment').then(async r=>({status:r.status,body:await r.json()})),fetch('/api/directory').then(async r=>({status:r.status,body:await r.text()})),fetch('/api/exports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'directory',format:'csv',filters:{}})}).then(async r=>({status:r.status,body:await r.text()}))])")
    assert.equal(reads[0].status, 200)
    assert.equal(reads[0].body.historyRestricted, true)
    assert.equal(reads[0].body.history.length, 0)
    assert.equal(reads[1].status, 200)
    assert.equal(reads[2].status, 200)
    for (const item of reads.slice(1)) {
      assert.equal(item.body.includes("mock-v3-"), false)
      assert.equal(item.body.includes("@example.test"), false)
      assert.equal(item.body.includes("+1 202 555"), false)
    }
    const result = await evaluate("fetch('/api/enrichment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'lusha_approve_contact',reviewId:3,confirmed:true})}).then(async r=>({status:r.status,body:await r.json()}))")
    assert.equal(result.status, 403)
    assert.equal(await evaluate("document.body.innerText.includes('Lusha phone evidence — Admin review')"), false)
    console.log("PCOM_APPROVAL", JSON.stringify(result))
    console.log("PCOM_READS", JSON.stringify(reads.map(item => ({ status: item.status, restricted: item.body.historyRestricted ?? null }))))
  } else if (phase === "reject") {
    if (!db.prepare("SELECT count(*) AS n FROM provider_refresh_reviews WHERE alumnus_id=902 AND status='Rejected identity'").get().n) {
      assert.equal(await evaluate("(() => { const item=[...document.querySelectorAll('details')].find(x=>x.textContent.includes('Contact Search Preview') && x.textContent.includes('Bela Demo-Only')); if(!item)return false; item.querySelector('summary').click(); return true })()"), true)
      await waitFor("document.body.innerText.includes('Identity exception')")
      await clickButton("Reject Lusha identity proposal")
    }
    await waitDb("SELECT count(*) AS n FROM provider_refresh_reviews WHERE alumnus_id=902 AND status='Rejected identity'")
    const person = db.prepare("SELECT lusha_person_id,email,phone FROM alumni WHERE id=902").get()
    assert.equal(person.lusha_person_id, "")
    assert.equal(person.email, "")
    assert.equal(person.phone, "")
    console.log("REJECTED_EXCEPTION", JSON.stringify(db.prepare("SELECT status FROM provider_refresh_reviews WHERE alumnus_id=902").all()))
  } else if (phase === "failure" || phase === "staleSearch") {
    const failure = phase === "failure"
    await clickButton(failure ? "Failure Demo-Only" : "Bela Stale-Only")
    await waitFor("document.body?.innerText.includes('Contact and verification')")
    await clickButton("Prepare Email Reveal")
    await snapshot("negative_case_preflight")
    await waitFor("document.body?.innerText.includes('Confirm Contact Search')")
    await clickButton("Confirm Contact Search")
    if (failure) {
      await waitDb("SELECT count(*) AS n FROM provider_response_history WHERE alumnus_id=904 AND operation='Contact Search Preview' AND status='ambiguous'")
      assert.equal(db.prepare("SELECT count(*) AS n FROM provider_refresh_reviews WHERE alumnus_id=904").get().n, 0)
      assert.equal(db.prepare("SELECT lusha_person_id FROM alumni WHERE id=904").get().lusha_person_id, "")
      console.log("FAILED_MOCK", JSON.stringify(db.prepare("SELECT status,mode,application_units,usage_state FROM provider_response_history WHERE alumnus_id=904").all()))
    } else {
      await waitDb("SELECT count(*) AS n FROM provider_refresh_reviews WHERE alumnus_id=905 AND status='Pending identity review'")
      console.log("STALE_PENDING", JSON.stringify(db.prepare("SELECT id,status FROM provider_refresh_reviews WHERE alumnus_id=905").all()))
    }
  } else if (phase === "staleReview") {
    const id = db.prepare("SELECT id FROM provider_refresh_reviews WHERE alumnus_id=905 AND status='Pending identity review'").get()?.id
    assert.ok(id)
    db.prepare("UPDATE alumni SET record_version=record_version+1 WHERE id=905").run()
    const result = await evaluate(`fetch('/api/enrichment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'lusha_approve_identity',reviewId:${id},confirmed:true})}).then(async r=>({status:r.status,body:await r.json()}))`)
    assert.equal(result.status, 409)
    assert.equal(db.prepare("SELECT lusha_person_id FROM alumni WHERE id=905").get().lusha_person_id, "")
    console.log("STALE_APPROVAL_DENIED", JSON.stringify(result))
  } else if (phase === "duplicateApproval") {
    const before = db.prepare("SELECT record_version,lusha_person_id,email,phone FROM alumni WHERE id=901").get()
    const result = await evaluate("fetch('/api/enrichment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'lusha_approve_identity',reviewId:1,confirmed:true})}).then(async r=>({status:r.status,body:await r.json()}))")
    assert.equal(result.status, 409)
    const after = db.prepare("SELECT record_version,lusha_person_id,email,phone FROM alumni WHERE id=901").get()
    assert.equal(after.record_version, before.record_version)
    assert.equal(after.lusha_person_id, before.lusha_person_id)
    assert.equal(after.email, before.email)
    assert.equal(after.phone, before.phone)
    console.log("DUPLICATE_APPROVAL_DENIED", JSON.stringify(result))
  } else if (phase === "mismatchReview") {
    const person = db.prepare("SELECT lusha_person_id,email,phone FROM alumni WHERE id=902").get()
    assert.equal(person.lusha_person_id, "")
    assert.equal(person.email, "")
    assert.equal(person.phone, "")
    await snapshot("mismatched_identity")
    console.log("MISMATCH_REVIEW", JSON.stringify(db.prepare("SELECT status FROM provider_refresh_reviews WHERE alumnus_id=902").all()))
  } else if (phase === "mismatch") {
    await clickButton("Bela Demo-Only")
    await waitFor("document.body?.innerText.includes('Contact and verification')")
    await clickButton("Prepare Email Reveal")
    await waitFor("document.body?.innerText.includes('Confirm Contact Search')")
    await clickButton("Confirm Contact Search")
    await waitDb("SELECT count(*) AS n FROM provider_refresh_reviews WHERE alumnus_id=902 AND status='Identity exception'")
    const person = db.prepare("SELECT lusha_person_id,email,phone FROM alumni WHERE id=902").get()
    assert.equal(person.lusha_person_id, "")
    assert.equal(person.email, "")
    assert.equal(person.phone, "")
    await snapshot("mismatched_identity")
    console.log("MISMATCH_REVIEW", JSON.stringify(db.prepare("SELECT status FROM provider_refresh_reviews WHERE alumnus_id=902").all()))
  } else if (phase === "search") {
    await clickButton("Ada Demo-Only")
    await waitFor("document.body?.innerText.includes('Contact and verification')")
    await waitFor("!document.body?.innerText.includes('Connecting to shared database')")
    await clickButton("Prepare Email Reveal")
    await waitFor("document.body?.innerText.includes('Confirm Contact Search')")
    await clickButton("Confirm Contact Search")
    await waitFor("document.body?.innerText.includes('Lusha contact preview') || document.body?.innerText.includes('Unable to retrieve') || document.body?.innerText.includes('Error')")
    await snapshot("search_result")
    console.log("DB_AFTER_SEARCH", JSON.stringify(db.prepare("SELECT id,lusha_person_id,email,phone FROM alumni WHERE id=901").get()), JSON.stringify(db.prepare("SELECT id,operation,mode,status,credits_used,application_units,provider_reported_credits,usage_state FROM provider_response_history").all()))
  } else if (phase === "review") {
    await evaluate("[...document.querySelectorAll('summary')].find(x=>x.textContent.includes('View details'))?.click()")
    await waitFor("document.body?.innerText.includes('Lusha identity evidence')")
    await clickLabel("I compared the saved and returned LinkedIn profiles")
    await clickButton("Approve Lusha identity association")
    await waitFor("document.body?.innerText.includes('Approved identity') || document.body?.innerText.includes('could not be applied')")
    await snapshot("identity_approval")
    console.log("DB_AFTER_IDENTITY", JSON.stringify(db.prepare("SELECT id,lusha_person_id,email,phone,record_version FROM alumni WHERE id=901").get()), JSON.stringify(db.prepare("SELECT id,status FROM provider_refresh_reviews").all()))
  } else if (phase === "email" || phase === "phone") {
    const channel = phase === "email" ? "Email" : "Phone"
    await clickButton("Ada Demo-Only")
    await waitFor("document.body?.innerText.includes('Contact and verification') && !document.body?.innerText.includes('Connecting to shared database')")
    await clickButton(`Prepare ${channel} Reveal`)
    await waitFor(`document.body?.innerText.includes('Continue to ${channel} Reveal')`)
    await clickButton(`Continue to ${channel} Reveal`)
    await waitFor(`document.body?.innerText.includes('Confirm ${channel}-Only Reveal')`)
    await snapshot(`${phase}_confirmation`)
    await clickButton(`Confirm ${channel}-Only Reveal`)
    await waitDb(`SELECT count(*) AS n FROM provider_response_history WHERE operation='${channel} Reveal' AND mode='mock' AND status='review_required'`)
    await snapshot(`${phase}_result`)
    console.log(`DB_AFTER_${channel.toUpperCase()}_REVEAL`, JSON.stringify(db.prepare("SELECT id,lusha_person_id,email,phone,record_version FROM alumni WHERE id=901").get()), JSON.stringify(db.prepare("SELECT id,operation,mode,status,credits_used,application_units,provider_reported_credits,usage_state FROM provider_response_history").all()))
  } else if (phase === "emailReview" || phase === "phoneReview") {
    const channel = phase === "emailReview" ? "email" : "phone"
    assert.equal(await evaluate(`(() => { const item=[...document.querySelectorAll('details')].find(x=>x.textContent.includes(${JSON.stringify(`${channel === "email" ? "Email" : "Phone"} Reveal`)}) && x.textContent.includes('View details')); if(!item)return false; item.querySelector('summary').click(); return true })()`), true)
    await waitFor(`document.body?.innerText.includes('Lusha ${channel} evidence — Admin review')`)
    await snapshot(`${channel}_admin_review`)
    await clickLabel(`I verified this Lusha identity and the proposed ${channel}`)
    await clickButton(`Approve ${channel}`)
    await waitDb(`SELECT count(*) AS n FROM provider_refresh_reviews r JOIN provider_response_history h ON h.id=r.provider_response_id WHERE h.operation='${channel === "email" ? "Email" : "Phone"} Reveal' AND r.status='Applied'`)
    console.log(`DB_AFTER_${channel.toUpperCase()}_APPROVAL`, JSON.stringify(db.prepare("SELECT id,lusha_person_id,email,phone,record_version FROM alumni WHERE id=901").get()), JSON.stringify(db.prepare("SELECT id,status FROM provider_refresh_reviews").all()))
  }
} finally {
  console.log("BROWSER_ERRORS", JSON.stringify(errors))
  console.log("HTTP_FAILURES", JSON.stringify(httpFailures))
  console.log("PROVIDER_NETWORK_REQUESTS", JSON.stringify(network.filter(item => /^https:\/\/(api\.lusha\.com|.*coresignal\.com|.*brightdata\.com)/i.test(item.url))))
  socket.close()
  db.close()
}
