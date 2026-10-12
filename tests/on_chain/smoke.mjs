/* Redact and the reading room against GenLayer Studio (chain 61999), with throwaway accounts. Deploys its own copies.
 *
 *   npm ci                                                  # genlayer-js 1.1.8 and viem 2.56.8
 *   node tests/on_chain/smoke.mjs                           # the whole run, from a fresh state
 *   RESUME=1 node tests/on_chain/smoke.mjs                  # continue a run that was cut off
 *   STATE=/some/dir/run.json RESUME=1 node tests/on_chain/smoke.mjs   # the same, with the state kept elsewhere
 *
 * Four generated accounts play the story: P publishes, F finds the leak, G is a second finder who
 * points at a public official, and S is a stranger who reports in the wrong category, reports late,
 * certifies and buys.
 *
 *   1  deploy Redact, then deploy ReadingRoom bound to it with a floor of 1200 s and 1 GEN; a release
 *      with a ten-minute window is refused and its 2 GEN come back. F deposits 0.1 GEN of credit for
 *      report bonds and G deposits 0.2 GEN.
 *   2  P publishes R1, "Minutes of the Riverside parish council, 14 March": six sentences, bounty
 *      1 GEN, bond 2 GEN, window 2400 s. Sentence 4 still gives away a resident's street address and
 *      her stroke. P publishes R2, the April minutes, fully redacted: bond 1 GEN, window 1200 s, and
 *      R3, the same April minutes with a bounty of 0.5 GEN. Certifying R2 at once is refused.
 *   3  The reading room before anything is certified: P offers R1 and R2 at 2 GEN; P offering R3 is
 *      refused, because its bounty is under the room's floor; F offering R2 is refused (only the
 *      publisher offers); S buying R2 now is refused and refunded, because R2 is not certified. P
 *      withdraws R3, which nobody has reported, and its 0.5 GEN come back.
 *   4  The reports on R1, each staking its report bond from credit, so no report carries value. S
 *      reports with no credit: refused, nothing taken. S deposits 0.1 GEN and reports sentence 4 as
 *      money, the wrong category: read clean, S's report bond goes to P. Then F reports sentence 4
 *      as home and G reports sentence 1 (Councillor Ellis opening the meeting) as identity, back to
 *      back. F's is read as a leak: the 1 GEN bounty goes from P's bond to F in the same transaction,
 *      and sentence 4 is closed. G's is read clean: a councillor in office is not a private person,
 *      and G's 0.1 GEN report bond goes to P. G reports sentence 4 again, as health: refused with no
 *      model asked. F and G each take back what is left of their credit.
 *   5  R1's window passes on the chain clock. S reports R1 late: refused. S certifies R1: leaky, and
 *      the 1 GEN left of the bond goes back to P. S certifies R2: clean, its 1 GEN back to P.
 *   6  S buys R2 from the room: the 2 GEN go to P in the same call. S tries to buy R1: refused, with
 *      the 2 GEN back, because R1 is leaky on Redact.
 *   7  the views read back, the code deployed at both addresses compared with the two files byte for
 *      byte, both contracts' balances read, and every account's net movement checked against what
 *      the receipts say.
 *
 * Every refusal is a signed transaction. Balances are read after finalisation, because a transfer
 * lands at FINALIZED, not at ACCEPTED. Transactions are polled with eth_getTransactionByHash, never
 * with views (gen_call is rate limited per client, shared with sim_fundAccount). A round no majority
 * carried stores nothing and, since a report carries no value, strands nothing; it is sent again and
 * both transactions are kept. Every step is saved as it is made, so a run cut off part way continues
 * without sending anything twice. Every id (R1, R2, F1, ...) is read from the receipt that created it,
 * never assumed. Every wait for a window reads the chain's own clock off the release view. A whole
 * run takes about 50 to 65 minutes, most of it R1's 2400-second window: the room's steps and three
 * judged reports, each asked four ways by every validator, must land inside it.
 *
 * A state file remembers the sha256 of both contracts it deployed, and a RESUME against a state made
 * from other files stops before sending anything.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { generatePrivateKey } from "viem/accounts";
import { getAddress } from "viem";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RPC = "https://studio.genlayer.com/api";
const STATE = process.env.STATE || join(tmpdir(), "redact-smoke-state.json");
const RECORD = process.env.RECORD || STATE.replace(/\.json$/, "") + "-record.json";
const REDACT_FILE = new URL("../../contracts/redact.py", import.meta.url);
const ROOM_FILE = new URL("../../contracts/fixtures/reading_room.py", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const rpc = async (m, p) => {
  let last;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
      const j = await r.json();
      if (j.error && (j.error.code === -32029 || r.status === 429)) { await sleep(((j.error.data?.retry_after_seconds) || 20) * 1000); continue; }
      if (j.error) { last = new Error(m + ": " + JSON.stringify(j.error).slice(0, 200)); await sleep(6000); continue; }
      return j.result;
    } catch (e) { last = e; await sleep(4000); }
  }
  throw last;
};
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  - " + d : ""}`); return !!c; };
const GEN = 10n ** 18n;
const tally = (v) => `${v.agree} agree, ${v.disagree} disagree, ${v.idle} idle`;
const sha = (b) => createHash("sha256").update(b).digest("hex");

// ---------- state: keys, addresses and every step already made survive a cut-off run ----------
const st = existsSync(STATE) && process.env.RESUME ? JSON.parse(readFileSync(STATE, "utf8")) : {};
st.keys = st.keys || {}; st.steps = st.steps || {}; st.views = st.views || {}; st.order = st.order || [];
const SOURCE_SHA = { redact: sha(readFileSync(REDACT_FILE)), room: sha(readFileSync(ROOM_FILE)) };
if (st.source_sha256 && (st.source_sha256.redact !== SOURCE_SHA.redact || st.source_sha256.room !== SOURCE_SHA.room)) {
  console.log(`the state file ${STATE} belongs to a run of other contract files; start a fresh run without RESUME, or name another STATE`);
  process.exit(2);
}
st.source_sha256 = SOURCE_SHA;
const save = () => {
  writeFileSync(STATE, JSON.stringify(st, null, 1));
  const { keys, ...shown } = st;       // the record carries no key
  writeFileSync(RECORD, JSON.stringify(shown, null, 1));
};
const ROLES = { p: "the publisher", f: "the finder, who points at the leaking sentence", g: "the second finder, who points at a public official", s: "a stranger, who reports in the wrong category, reports late, certifies and buys" };
for (const k of Object.keys(ROLES)) st.keys[k] = st.keys[k] || generatePrivateKey();
const acct = {}, client = {};
for (const k of Object.keys(ROLES)) { acct[k] = createAccount(st.keys[k]); client[k] = createClient({ chain: studionet, account: acct[k] }); }
const rd = createClient({ chain: studionet });
st.accounts = Object.fromEntries(Object.keys(ROLES).map((k) => [k, getAddress(acct[k].address)]));
const low = (a) => String(a).toLowerCase();
save();

const balance = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]) || "0x0");
const nonceOf = async (a) => Number(BigInt(await rpc("eth_getTransactionCount", [a, "latest"]) || "0x0"));
const fundOnce = async (k, whole) => {
  st.funded = st.funded || {};
  if (st.funded[k]) return;
  await rpc("sim_fundAccount", { account_address: getAddress(acct[k].address), amount: whole * 1e18 });   // checksummed; amount in atto, as a number
  for (let i = 0; i < 20 && (await balance(acct[k].address)) === 0n; i++) await sleep(3000);
  st.funded[k] = String(await balance(acct[k].address)); save();
};

// ---------- transactions ----------
const errText = (e) => String(e?.details || e?.shortMessage || e?.cause?.message || e?.message || e);
// A request the network refused or never received is made again. When the failure is ambiguous the
// sender's nonce says whether the transaction landed after all, and its hash is read back, so
// nothing is ever sent twice.
const sendRaw = async (who, what, make) => {
  const addr = acct[who].address;
  for (let i = 0; ; i++) {
    const n0 = await nonceOf(addr);
    try { return await make(); } catch (e) {
      if (i >= 8) throw e;
      console.log(`      ${what} was not taken (${errText(e).slice(0, 70)}); looking again in 20s`);
      await sleep(20000);
      if ((await nonceOf(addr)) > n0) {
        const list = await rpc("sim_getTransactionsForAddress", [addr]);
        const hit = (list || []).find((t) => low(t.from_address) === low(addr) && Number(t.nonce) === n0);
        if (hit?.hash) return hit.hash;
        throw new Error(what + " landed but its hash could not be read back");
      }
    }
  }
};
const countVotes = (t) => { let a = 0, d = 0, idl = 0; for (const k in (t.consensus_data?.votes || {})) { const v = t.consensus_data.votes[k]; if (v === "agree") a++; else if (v === "disagree") d++; else idl++; } return { agree: a, disagree: d, idle: idl }; };
const wait = async (tx) => {
  let stuck = 0;
  for (let i = 0; i < 900; i++) {
    await sleep(4000);
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "FINALIZED") {
      const lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr;
      let msg = "";
      try { msg = Buffer.from(one.result, "base64").toString("utf8").replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {}
      const v = countVotes(t);
      return { tx, msg, exec: one?.execution_result || "", votes: v, applied: v.agree * 2 > v.agree + v.disagree + v.idle, address: t.data?.contract_address || t.to_address || "" };
    }
    // a round no majority carried is final as it stands once it has been left alone for ten minutes
    if (t?.status === "UNDETERMINED" && (stuck = stuck + 1) > 150) return { tx, msg: "UNDETERMINED", exec: "", votes: countVotes(t), applied: false, address: "" };
    if (t?.status === "CANCELED") return { tx, msg: "CANCELED", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
    if (i > 0 && i % 75 === 0) console.log(`      [${stamp()}] still ${t?.status || "unknown"} after ${Math.round(i * 4 / 60)} minutes: ${tx}`);
  }
  return { tx, msg: "TIMEOUT", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
};
const jsonOf = (msg) => { const b = String(msg).indexOf("{"); if (b === -1) return null; try { return JSON.parse(String(msg).slice(b)); } catch (e) { return null; } };
const settle = async (a, before, want) => { for (let i = 0; i < 45; i++) { const b = await balance(a); if (b - before === want) return b; await sleep(4000); } return await balance(a); };

// One step: a signed transaction, its tally, what it returned, and the balances it moved. begin()
// sends it (once), end() waits for it; call() is both. opt.at names the contract (Redact unless
// said), opt.watch names addresses whose balances are read before and after, and opt.expect the
// change each should show: a table, or a function of what the call returned, because what a report
// moves depends on how it was read.
const begin = async (id, who, fn, args = [], opt = {}) => {
  if (!st.steps[id]) { st.steps[id] = { id, who, fn, at: opt.at || "redact", args: args.map(String), value: String(opt.value || 0n), tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (rec.done || rec.pending) return;
  if (!rec.before) { rec.before = {}; for (const [k, a] of Object.entries(opt.watch || {})) rec.before[k] = String(await balance(a)); save(); }
  const address = (opt.at || "redact") === "room" ? st.room : st.redact;
  rec.pending = await sendRaw(who, fn, () => client[who].writeContract({ address, functionName: fn, args, ...(opt.value ? { value: opt.value } : {}) }));
  save();
};
const end = async (id, who, fn, args = [], opt = {}) => {
  const rec = st.steps[id];
  if (!rec.done) {
    for (;;) {
      if (!rec.pending) await begin(id, who, fn, args, opt);
      const r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg });
      rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} ${fn}(${args.map((x) => String(x).slice(0, 22)).join(", ")})${opt.value ? " +" + Number(opt.value) / 1e18 + " GEN" : ""}  ${r.tx}  ${tally(r.votes)}  ${r.exec}`);
      if (r.msg === "TIMEOUT" || rec.tries.length >= 4) break;
      if (!r.applied) { console.log("      the validators did not carry that round (" + tally(r.votes) + "), so nothing was stored; sending it again"); continue; }
      const again = opt.again ? opt.again(r) : 0;
      if (again > 0) { console.log(`      not yet; waiting ${Math.round(again / 1000)} s and sending it again`); await sleep(again); continue; }
      break;
    }
    const last = rec.tries[rec.tries.length - 1];
    const expect = typeof opt.expect === "function" ? opt.expect(jsonOf(last.msg)) : opt.expect;
    rec.after = {}; rec.delta = {};
    for (const [k, a] of Object.entries(opt.watch || {})) {
      const before = BigInt(rec.before[k]);
      const want = expect && expect[k] !== undefined ? BigInt(expect[k]) : null;
      const now = want === null ? await balance(a) : await settle(a, before, want);
      rec.after[k] = String(now); rec.delta[k] = String(now - before);
    }
    rec.done = true; save();
  }
  const last = rec.tries[rec.tries.length - 1];
  return { ...last, j: jsonOf(last.msg), tries: rec.tries, delta: rec.delta || {} };
};
const call = async (id, who, fn, args = [], opt = {}) => { await begin(id, who, fn, args, opt); return end(id, who, fn, args, opt); };
const refused = (r, words) => r.exec === "ERROR" && r.msg.includes(words);
const moved = (r, k, want) => r.delta[k] === String(want);
const votes = (r) => r.tries.map((t) => tally(t.votes)).join(", then ");

const deploy = async (id, who, file, args) => {
  if (!st.steps[id]) { st.steps[id] = { id, who, fn: "deploy " + file.pathname.split("/").pop(), args: args.map(String), value: "0", tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (!rec.done) {
    const code = readFileSync(file);
    for (;;) {
      if (!rec.pending) { rec.pending = await sendRaw(who, "deploy", () => client[who].deployContract({ code, args, leaderOnly: false })); save(); }
      const r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg.slice(0, 300) });
      rec.address = r.address; rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} ${rec.fn}  ${r.tx}  ${tally(r.votes)}  ${r.exec}  ${r.address}`);
      if (r.applied || r.msg === "TIMEOUT" || rec.tries.length >= 3) break;
    }
    rec.done = true; save();
  }
  return rec.address;
};

// ---------- reads: paced, and made again on a 429 instead of failing ----------
let lastRead = 0;
const read = async (fn, args = [], at = "redact") => {
  const address = at === "room" ? st.room : st.redact;
  for (let i = 0; i < 30; i++) {
    const gap = 3500 - (Date.now() - lastRead);
    if (gap > 0) await sleep(gap);
    lastRead = Date.now();
    try { return JSON.parse(String(await rd.readContract({ address, functionName: fn, args }))); } catch (e) {
      if (i === 29) return { error: "VIEW ERROR " + fn + ": " + errText(e).slice(0, 100) };
      await sleep(/rate|429|limit/i.test(errText(e)) ? 25000 : 10000);
    }
  }
};
// a view read once for a check is kept with the run, so a continued run checks what was seen then
const seen = async (id, fn, args = [], at = "redact") => { if (!st.views[id]) { st.views[id] = { fn, at, args, when: stamp(), out: await read(fn, args, at) }; save(); } return st.views[id].out; };
// wait, by the chain's own clock, until a release's window has passed
const untilCertifiable = async (rid) => {
  const row = await read("release", [rid]);
  const left = Number(row.closes_at || 0) - Number(row.now > 0 ? row.now : Math.floor(Date.now() / 1000));
  if (row.settled_at === 0 && left > -15) { console.log(`      [${stamp()}] waiting ${left + 20} s, by the chain clock, for the window of ${rid} to pass`); await sleep((left + 20) * 1000); }
};
const notYet = (r) => { const m = /open for another (\d+) seconds/.exec(r.msg); return r.exec === "ERROR" && m ? (Number(m[1]) + 15) * 1000 : 0; };

// ---------- the demonstration ----------
const BOUNTY = 1n * GEN, RBOND = BOUNTY / 10n, BOND = 2n * GEN, PRICE = 2n * GEN, WINDOW1 = 2400, WINDOW2 = 1200;
const FLOOR_WINDOW = 1200, FLOOR_BOUNTY = BOUNTY;
const TITLE = "Minutes of the Riverside parish council, 14 March";
const R1 = [
  "Councillor Ellis opened the meeting at 7 pm and welcomed eleven members of the public.",
  "The minutes of the February meeting were approved without changes.",
  "A resident of [REDACTED] raised the state of the footpath by the school.",
  "The resident at 22 Willow Crescent, who has used a wheelchair since her stroke last year, asked for a dropped kerb.",
  "The clerk reported that the bus shelter on Mill Lane will be repaired in April.",
  "Councillor Ellis closed the meeting at 8.15 pm; the next meeting is on 11 April.",
];
// R2 is the next meeting's minutes, redacted as R1 should have been; R3 is the same text with half the bounty
const TITLE2 = "Minutes of the Riverside parish council, 11 April";
const R2 = [
  "Councillor Ellis opened the meeting at 7 pm with nine members of the public present.",
  "A resident of [REDACTED] asked when the dropped kerb agreed in March will be built.",
  "The clerk said the work is booked for May and that the resident will be told the date directly.",
  "[REDACTED] raised a private matter, which was referred to a closed session.",
  "Councillor Ellis closed the meeting at 7.50 pm.",
];
const W = (...ks) => Object.fromEntries(ks.map((k) => [k, acct[k].address]));
// what a report moves for its reporter and the publisher, by how it was read: the report bond was
// already deposited, so a clean reading moves it from the contract's credit to the publisher
const reportMoves = (who) => (j) => j?.verdict === "leak" ? { [who]: BigInt(j.bounty_paid), p: 0n } : j?.verdict === "clean" ? { [who]: 0n, p: RBOND } : { [who]: 0n, p: 0n };

await fundOnce("p", 10); await fundOnce("f", 2); await fundOnce("g", 2); await fundOnce("s", 8);
if (!st.start) { st.start = {}; for (const k of Object.keys(ROLES)) st.start[k] = String(await balance(acct[k].address)); st.started = new Date().toISOString(); save(); }
console.log(`[${stamp()}] ${Object.keys(ROLES).map((k) => k.toUpperCase() + "  " + st.accounts[k] + "  " + ROLES[k]).join("\n           ")}\n           state ${STATE}`);

// ================================================================ 1
console.log(`\n[${stamp()}] ---- 1: deploy both contracts, a window too short to report in, and the finders' credit`);
st.redact = st.redact || await deploy("deployRedact", "p", REDACT_FILE, []);
save();
st.room = st.room || await deploy("deployRoom", "p", ROOM_FILE, [st.redact, FLOOR_WINDOW, String(FLOOR_BOUNTY)]);
save();
console.log(`      Redact at ${st.redact}\n      ReadingRoom at ${st.room}`);
{
  const room = await seen("roomBound", "room", [], "room");
  ok("ReadingRoom is bound to the Redact address it was deployed with, with a floor of 1200 s and 1 GEN", low(room.redact) === low(st.redact) && room.sells_only === "clean" && room.min_window_seconds === FLOOR_WINDOW && room.min_bounty_atto === String(FLOOR_BOUNTY), JSON.stringify(room));
  const short = await call("publishShort", "p", "publish", [TITLE, JSON.stringify(R1), String(BOUNTY), 600], { value: BOND, watch: W("p"), expect: { p: 0n } });
  ok("a release with a ten-minute window is refused and its 2 GEN come back", short.j?.ok === false && String(short.j?.reason).includes("the report window is 1200") && short.j?.returned === String(BOND) && moved(short, "p", 0n), `${votes(short)}  ${short.j?.reason || short.msg.slice(0, 90)}`);
  const df = await call("depositF", "f", "deposit", [], { value: RBOND, watch: W("f"), expect: { f: -RBOND } });
  const dg = await call("depositG", "g", "deposit", [], { value: 2n * RBOND, watch: W("g"), expect: { g: -2n * RBOND } });
  ok("F deposits 0.1 GEN and G 0.2 GEN as credit for report bonds; no model runs in a deposit", df.j?.ok === true && df.j?.credit === String(RBOND) && dg.j?.credit === String(2n * RBOND) && moved(df, "f", -RBOND) && moved(dg, "g", -2n * RBOND), `${votes(df)} / ${votes(dg)}`);
}

// ================================================================ 2
console.log(`\n[${stamp()}] ---- 2: the March minutes, with one sentence that still gives a resident away, and the April minutes twice`);
{
  const r1 = await call("publishR1", "p", "publish", [TITLE, JSON.stringify(R1), String(BOUNTY), WINDOW1], { value: BOND, watch: W("p"), expect: { p: -BOND } });
  ok("R1 is published: six sentences, bounty 1 GEN, a 2 GEN bond held, window 2400 s", r1.j?.ok === true && r1.j?.sentences === 6 && r1.j?.bond === String(BOND) && r1.j?.report_bond === String(RBOND) && r1.j?.closes_at - r1.j?.opened_at === WINDOW1 && moved(r1, "p", -BOND), `${votes(r1)}  ${r1.msg.slice(0, 140)}`);
  st.R1 = r1.j?.release; save();
  const r2 = await call("publishR2", "p", "publish", [TITLE2, JSON.stringify(R2), String(BOUNTY), WINDOW2], { value: BOUNTY, watch: W("p"), expect: { p: -BOUNTY } });
  ok("R2, the April minutes, is published fully redacted: bond 1 GEN, window 1200 s", r2.j?.ok === true && r2.j?.sentences === 5 && moved(r2, "p", -BOUNTY), `${votes(r2)}  ${r2.msg.slice(0, 140)}`);
  st.R2 = r2.j?.release; save();
  const cert = await call("certifyR2Early", "s", "certify", [st.R2]);
  ok("certifying R2 before its window ends is refused", refused(cert, "is open for another"), `${votes(cert)}  ${cert.msg.slice(0, 100)}`);
  const r3 = await call("publishR3", "p", "publish", [TITLE2, JSON.stringify(R2), String(BOUNTY / 2n), WINDOW2], { value: BOUNTY / 2n, watch: W("p"), expect: { p: -BOUNTY / 2n } });
  ok("R3, the same April minutes with a bounty of 0.5 GEN, is published", r3.j?.ok === true && r3.j?.bounty === String(BOUNTY / 2n) && moved(r3, "p", -BOUNTY / 2n), `${votes(r3)}  ${r3.msg.slice(0, 140)}`);
  st.R3 = r3.j?.release; save();
  ok("all three ids are read from the receipts", [st.R1, st.R2, st.R3].every((x) => /^R\d+$/.test(x || "")) && new Set([st.R1, st.R2, st.R3]).size === 3, `${st.R1} ${st.R2} ${st.R3}`);
}

// ================================================================ 3
console.log(`\n[${stamp()}] ---- 3: the reading room before anything is certified`);
{
  const o1 = await call("offerR1", "p", "offer", [st.R1, String(PRICE)], { at: "room" });
  const o2 = await call("offerR2", "p", "offer", [st.R2, String(PRICE)], { at: "room" });
  ok("P offers R1 and R2 at 2 GEN each; the room read Redact and found both open and at its floor", o1.j?.ok === true && o2.j?.ok === true && o1.j?.status_on_redact === "open" && o2.j?.status_on_redact === "open", `${votes(o1)} / ${votes(o2)}`);
  const o3 = await call("offerR3", "p", "offer", [st.R3, String(PRICE)], { at: "room" });
  ok("P offering R3 is refused: a 0.5 GEN bounty is under the room's floor of 1 GEN", refused(o3, "this room sells only releases with at least"), `${votes(o3)}  ${o3.msg.slice(0, 140)}`);
  const not = await call("offerByFinder", "f", "offer", [st.R2, String(PRICE)], { at: "room" });
  ok("F offering R2 is refused: only the publisher on Redact offers a release", refused(not, "only the publisher of"), `${votes(not)}  ${not.msg.slice(0, 100)}`);
  const early = await call("buyR2Early", "s", "buy", [st.R2], { at: "room", value: PRICE, watch: W("s", "p"), expect: { s: 0n, p: 0n } });
  ok("S buying R2 before it is certified is refused, and the 2 GEN come back", early.j?.ok === false && String(early.j?.reason).includes("is open on Redact, not clean") && early.j?.returned === String(PRICE) && moved(early, "s", 0n), `${votes(early)}  ${early.j?.reason || early.msg.slice(0, 90)}`);
  const wd = await call("withdrawR3", "p", "withdraw", [st.R3], { watch: W("p"), expect: { p: BOUNTY / 2n } });
  ok("P withdraws R3, which nobody reported, and its 0.5 GEN come back", wd.j?.ok === true && wd.j?.status === "withdrawn" && wd.j?.returned === String(BOUNTY / 2n) && moved(wd, "p", BOUNTY / 2n), `${votes(wd)}  ${wd.msg.slice(0, 120)}`);
}

// ================================================================ 4
console.log(`\n[${stamp()}] ---- 4: the reports on R1, each staking its bond from credit`);
{
  const none = await call("noCreditR1", "s", "report", [st.R1, 3, "home"], { watch: W("s"), expect: { s: 0n } });
  ok("S reports with no credit: refused before any model is asked, and nothing is taken", refused(none, "stakes a report bond of") && moved(none, "s", 0n), `${votes(none)}  ${none.msg.slice(0, 120)}`);
  const ds = await call("depositS", "s", "deposit", [], { value: RBOND, watch: W("s"), expect: { s: -RBOND } });
  ok("S deposits 0.1 GEN of credit", ds.j?.ok === true && ds.j?.credit === String(RBOND) && moved(ds, "s", -RBOND), votes(ds));
  // the wrong category goes first and is waited for: once sentence 4 is proven leaked it takes no report
  const wrong = await call("wrongCategoryR1", "s", "report", [st.R1, 4, "money"], { watch: W("s", "p"), expect: reportMoves("s") });
  ok("S reports sentence 4 as money, which it does not reveal: read clean", wrong.j?.verdict === "clean" && wrong.j?.sentence === 4 && wrong.j?.category === "money", `${votes(wrong)}  ${wrong.j?.verdict || wrong.j?.reason || wrong.msg.slice(0, 80)}`);
  ok("and S's 0.1 GEN report bond goes from S's credit to the publisher", wrong.j?.to_publisher === String(RBOND) && wrong.j?.credit === "0" && moved(wrong, "p", RBOND) && moved(wrong, "s", 0n), JSON.stringify(wrong.delta));
  // the two judged reports go out back to back, so both land inside R1's window
  const fh = ["leakR1", "f", "report", [st.R1, 4, "home"], { watch: W("f"), expect: (j) => ({ f: reportMoves("f")(j).f }) }];
  const gi = ["officialR1", "g", "report", [st.R1, 1, "identity"], { watch: W("g", "p"), expect: reportMoves("g") }];
  await begin(...fh); await begin(...gi);
  const leak = await end(...fh), official = await end(...gi);
  ok("F's report of sentence 4 as a home address is read as a leak by both questions in both orders", leak.j?.verdict === "leak" && leak.j?.sentence === 4 && leak.j?.category === "home", `${votes(leak)}  ${leak.j?.verdict || leak.j?.reason || leak.msg.slice(0, 80)}`);
  ok("and the 1 GEN bounty goes from P's bond to F in the same transaction, F's report bond still in credit", leak.j?.bounty_paid === String(BOUNTY) && leak.j?.credit === String(RBOND) && leak.j?.bond_left === String(BOND - BOUNTY) && moved(leak, "f", BOUNTY), JSON.stringify(leak.delta));
  ok("G's report of Councillor Ellis as identity is read clean: an official in office is not a private person", official.j?.verdict === "clean" && official.j?.sentence === 1, `${votes(official)}  ${official.j?.verdict || official.j?.reason || official.msg.slice(0, 80)}`);
  ok("and G's 0.1 GEN report bond goes from G's credit to the publisher", official.j?.to_publisher === String(RBOND) && official.j?.credit === String(RBOND) && moved(official, "g", 0n) && moved(official, "p", RBOND), JSON.stringify(official.delta));
  const again = await call("againR1", "g", "report", [st.R1, 4, "health"], { watch: W("g"), expect: { g: 0n } });
  ok("G reports sentence 4 again, as health: refused with no model asked, nothing taken", refused(again, "is already proven leaked") && moved(again, "g", 0n), `${votes(again)}  ${again.msg.slice(0, 120)}`);
  const bg = await call("reclaimG", "g", "reclaim", [], { watch: W("g"), expect: { g: RBOND } });
  const bf = await call("reclaimF", "f", "reclaim", [], { watch: W("f"), expect: { f: RBOND } });
  ok("G and F each take back what is left of their credit, 0.1 GEN each", bg.j?.returned === String(RBOND) && bf.j?.returned === String(RBOND) && moved(bg, "g", RBOND) && moved(bf, "f", RBOND), `${votes(bg)} / ${votes(bf)}`);
  const row = await seen("R1open", "release", [st.R1]);
  const s4 = (row.sentences || [])[3] || {};
  ok("release(R1): one leak, three reports judged, 1 GEN of bond left, sentence 4 leaked and closed, still open", row.leaks === 1 && row.judged === 3 && row.cleared === 2 && row.bond_left === String(BOND - BOUNTY) && row.status === "open" && s4.state === "leaked" && s4.reportable === false && JSON.stringify(s4.categories) === JSON.stringify(["money", "home"]) && row.would_be === "leaky", JSON.stringify({ leaks: row.leaks, judged: row.judged, bond_left: row.bond_left, s4: s4.state, cats: s4.categories }));
}

// ================================================================ 5
console.log(`\n[${stamp()}] ---- 5: the windows pass, a late report, and the certificates`);
{
  if (!st.steps.lateR1?.done) await untilCertifiable(st.R1);
  const late = await call("lateR1", "s", "report", [st.R1, 2, "identity"], { watch: W("s"), expect: { s: 0n } });
  ok("S reports R1 after its window: refused, nothing taken", refused(late, "closed at") && late.msg.includes("anybody may certify it now") && moved(late, "s", 0n), `${votes(late)}  ${late.msg.slice(0, 120)}`);
  const c1 = await call("certifyR1", "s", "certify", [st.R1], { watch: W("p", "s"), expect: { p: BOND - BOUNTY, s: 0n }, again: notYet });
  ok("S, who published nothing, certifies R1: leaky", c1.j?.status === "leaky" && c1.j?.leaks === 1 && c1.j?.judged === 3, `${votes(c1)}  ${c1.msg.slice(0, 120)}`);
  ok("and the 1 GEN left of R1's bond goes back to the publisher in the same call", c1.j?.returned === String(BOND - BOUNTY) && moved(c1, "p", BOND - BOUNTY), JSON.stringify(c1.delta));
  if (!st.steps.certifyR2?.done) await untilCertifiable(st.R2);
  const c2 = await call("certifyR2", "s", "certify", [st.R2], { watch: W("p"), expect: { p: BOUNTY }, again: notYet });
  ok("S certifies R2: clean, no leak proven, and its whole 1 GEN bond goes back to the publisher", c2.j?.status === "clean" && c2.j?.leaks === 0 && c2.j?.returned === String(BOUNTY) && moved(c2, "p", BOUNTY), `${votes(c2)}  ${c2.msg.slice(0, 120)}`);
}

// ================================================================ 6
console.log(`\n[${stamp()}] ---- 6: the reading room acts on the certificate`);
{
  const buy = await call("buyR2", "s", "buy", [st.R2], { at: "room", value: PRICE, watch: W("s", "p"), expect: { s: -PRICE, p: PRICE } });
  ok("S buys R2: Redact says clean, at the room's floor, so the sale goes through", buy.j?.ok === true && buy.j?.status_on_redact === "clean" && buy.j?.paid_to === low(acct.p.address), `${votes(buy)}  ${buy.msg.slice(0, 120)}`);
  ok("and the 2 GEN reach the publisher in the same call", moved(buy, "s", -PRICE) && moved(buy, "p", PRICE), JSON.stringify(buy.delta));
  const never = await call("buyR1", "s", "buy", [st.R1], { at: "room", value: PRICE, watch: W("s", "p"), expect: { s: 0n, p: 0n } });
  ok("S tries to buy R1: refused, because R1 is leaky on Redact, and the 2 GEN come back", never.j?.ok === false && String(never.j?.reason).includes("is leaky on Redact, not clean") && never.j?.returned === String(PRICE) && moved(never, "s", 0n) && moved(never, "p", 0n), `${votes(never)}  ${never.j?.reason || never.msg.slice(0, 90)}`);
}

// ================================================================ 7
console.log(`\n[${stamp()}] ---- 7: the views, the code, and the money`);
{
  const r1 = await seen("R1", "release", [st.R1]), r2 = await seen("R2", "release", [st.R2]), r3 = await seen("R3", "release", [st.R3]);
  ok("release(R1) is leaky, release(R2) is clean and release(R3) is withdrawn, all with nothing left held", r1.status === "leaky" && r2.status === "clean" && r3.status === "withdrawn" && [r1, r2, r3].every((r) => r.bond_left === "0"), JSON.stringify({ R1: r1.status, R2: r2.status, R3: r3.status }));
  const of1 = await seen("of1", "reports_of", [st.R1, 0, 20]);
  ok("reports_of(R1, 0, 20): the wrong category, the leak and the official, all judged, total 3", Array.isArray(of1.ids) && of1.ids.length === 3 && of1.total === 3 && of1.limit === 20, JSON.stringify(of1));
  // F's and G's were sent back to back, so a round sent a second time can swap their ids: find each by its reporter
  const rows = [];
  for (const [n, id] of (of1.ids || []).entries()) rows.push(await seen("repR1_" + n, "report_record", [id]));
  const by = (k) => rows.find((x) => x.reporter === low(acct[k].address)) || {};
  const rs = by("s"), rf = by("f"), rg = by("g");
  ok("report_record(S's): clean, sentence 4, money, the report bond to the publisher", rs.verdict === "clean" && rs.sentence === 4 && rs.category === "money" && rs.to_publisher === String(RBOND), JSON.stringify({ verdict: rs.verdict, category: rs.category }));
  ok("report_record(F's): leak, sentence 4, home, the bounty paid", rf.verdict === "leak" && rf.sentence === 4 && rf.category === "home" && rf.bounty_paid === String(BOUNTY), JSON.stringify({ verdict: rf.verdict, bounty_paid: rf.bounty_paid }));
  ok("report_record(G's): clean, sentence 1, identity, the report bond to the publisher", rg.verdict === "clean" && rg.sentence === 1 && rg.to_publisher === String(RBOND), JSON.stringify({ verdict: rg.verdict, to_publisher: rg.to_publisher }));
  const listing = await seen("listingR2", "listing", [st.R2], "room");
  const holds = await seen("holdingR2", "holding", [st.R2, acct.s.address], "room");
  const holds1 = await seen("holdingR1", "holding", [st.R1, acct.s.address], "room");
  const listing3 = await seen("listingR3", "listing", [st.R3], "room");
  ok("the room: R2 sold once for 2 GEN, S holds R2, nobody holds R1, and R3 was never listed", listing.sales === 1 && listing.earned === String(PRICE) && holds.holds === true && holds1.holds === false && String(listing3.error || "").includes("is not offered here"), JSON.stringify({ listing, holds: holds.holds, holds1: holds1.holds, r3: listing3.error }));
  const credits = [];
  for (const k of ["f", "g", "s"]) credits.push(await seen("credit_" + k, "credit", [acct[k].address]));
  ok("credit(F), credit(G) and credit(S) are all zero: nothing is left held for anybody", credits.every((c) => c.credit === "0"), JSON.stringify(credits.map((c) => c.credit)));
  const stats = await seen("stats", "stats", []);
  ok("stats(): three releases, one clean, one leaky, one withdrawn, one leak, two clean readings, nothing held", stats.releases === 3 && stats.certified_clean === 1 && stats.certified_leaky === 1 && stats.withdrawn === 1 && stats.leaks === 1 && stats.clean === 2 && stats.bonds_held === "0" && stats.credits_held === "0" && stats.balance_owed === "0", JSON.stringify(stats));
  const rules = await seen("rules", "rules", []);
  ok("rules(): the four askings, the agreement rule, one report per category, and the bounded settlement", Array.isArray(rules.askings) && rules.askings.length === 4 && String(rules.compared).includes("exact string equality") && rules.limits?.reports_per_sentence === 5 && rules.limits?.page === 20 && String(rules.settlement).includes("pay as you go") && String(rules.settlement).includes("O(1)") && String(rules.money?.report).startsWith("not payable"), Object.keys(rules).join(","));
  ok("both contracts' own balances are zero", (await balance(st.redact)) === 0n && (await balance(st.room)) === 0n, `${await balance(st.redact)} / ${await balance(st.room)}`);

  st.code = {};
  for (const [key, address, file] of [["redact", st.redact, REDACT_FILE], ["room", st.room, ROOM_FILE]]) {
    const bytes = readFileSync(file);
    const chain = Buffer.from(String(await rpc("gen_getContractCode", [address])), "base64");
    st.code[key] = { address, bytes: chain.length, sha256: sha(chain), file_bytes: bytes.length, file_sha256: sha(bytes), identical: Buffer.compare(chain, bytes) === 0 };
    save();
    ok(`the code deployed at ${address} is byte for byte ${file.pathname.split("/").slice(-2).join("/")}`, st.code[key].identical, `${chain.length} bytes, sha256 ${st.code[key].sha256}`);
  }

  st.end = {}; for (const k of Object.keys(ROLES)) st.end[k] = String(await balance(acct[k].address));
  st.ended = new Date().toISOString(); save();
  // what each account should have gained or lost, read off the receipts: a release takes its bond from
  // its publisher; a deposit takes its value and a reclaim returns it; a report pays its bounty to the
  // reporter and its bond, already deposited, to the publisher as the receipt says; a certificate or a
  // withdrawal returns what was left; a sale moves the price from buyer to publisher
  const want = { p: 0n, f: 0n, g: 0n, s: 0n };
  for (const id of st.order) {
    const s = st.steps[id], j = jsonOf(s.tries.at(-1)?.msg || "");
    if (!j?.ok) continue;
    if (s.fn === "publish") want[s.who] -= BigInt(j.bond);
    if (s.fn === "deposit") want[s.who] -= BigInt(j.deposited);
    if (s.fn === "reclaim") want[s.who] += BigInt(j.returned);
    if (s.fn === "report") { want[s.who] += BigInt(j.bounty_paid); want.p += BigInt(j.to_publisher); }
    if (s.fn === "certify" || s.fn === "withdraw") want.p += BigInt(j.returned);
    if (s.fn === "buy") { want[s.who] -= BigInt(j.price); want.p += BigInt(j.price); }
  }
  const net = (k) => BigInt(st.end[k]) - BigInt(st.start[k]);
  ok("over the run every account ends exactly where the receipts say", Object.keys(want).every((k) => net(k) === want[k]), Object.keys(want).map((k) => k.toUpperCase() + " " + Number(net(k)) / 1e18 + " (receipts " + Number(want[k]) / 1e18 + ")").join("  "));
}

st.checks = { pass, fail }; save();
console.log(`\n${pass} passed, ${fail} failed`);
console.log("Redact:", st.redact, " ReadingRoom:", st.room);
console.log("transactions:", st.order.reduce((n, id) => n + st.steps[id].tries.length, 0), "in", st.order.length, "steps; sent a second time:", st.order.filter((id) => st.steps[id].tries.length > 1).join(", ") || "none");
for (const id of st.order) { const s = st.steps[id], j = jsonOf(s.tries.at(-1)?.msg || ""); if (j?.verdict) console.log(`${id.padEnd(16)} ${s.tries.map((t) => t.tx + " " + tally(t.votes)).join(" | ")}  ${j.verdict} ${j.report}`); }
console.log("record:", RECORD);
process.exit(fail ? 1 : 0);
