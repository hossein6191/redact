# Decisions

The boundary first, then the prompt, the storage, the money, why settlement is
bounded, the doors and the consumer, then what is verified and what is not.

## 1. The boundary: what the network agrees on

**One word per report.** The stored value is `leak`, `clean` or `unclear`, a
word from a closed set the contract wrote. Not a score, not a quote of the
offending words, not a list of what leaked. The thing that has to be decided is
whether one sentence still gives away one kind of private detail, and the
coarsest answer that carries it is three-valued: it does, it does not, or the
readings did not settle. Anything finer, a severity score or the words that
leaked, would put a value in storage that honest nodes could reach differently
while believing the same thing.

**The question is narrowed before it is asked.** The reporter chooses one
sentence and one category from five, so the network is never asked "is there
anything private in this document", which has no stable answer, but "does
sentence 4, read with the rest, reveal the home address or exact home location of
an identifiable private person". Each category's words are a contract constant
that names the private person itself. The scope paragraph, shared by every
asking, says what does not count: a public official named in office, a
`[REDACTED]` mark, and a detail that appears only in another sentence.

**It does not agree on anything about the release as a whole.** Clean and leaky
are arithmetic on the stored words, done by the contract at `certify`, the same
on every node because it is not a judgement.

## 2. Two questions, each in both orders, in one block

Every validator builds the prompt the same way, so a reader that leans on which
block came first leans the same way on every node, and the network would agree
on a biased answer. Asking only one question has the same problem with a reader
that tends to say yes, and a privacy question invites exactly that reader.

So the block asks four times, sequentially, inside the one leader closure: the
question "does sentence N reveal it?" with the release first and with the
sentence first, and the question "is sentence N free of it?" with the release
first and with the sentence first. A question's answer counts only when both of
its orders gave the same word (`_both`); then the two questions are combined:
`leak` needs "reveals: yes" and "free of it: no", `clean` the mirror, and
anything else is `unclear`.

That separates the two things a biased reader could lean on. A reader that says
yes, or no, to everything settles both questions on the same word and lands in
`unclear`. A reader that answers by position gives the two orders of one
question different words, so that question is unsettled and the round lands in
`unclear`, whichever way round the bias runs. A simpler design would ask each
question in one order only, which would tie the order to the question: a reader that
answered "yes" whenever the release came first and "no" whenever the sentence
came first would land in the paying `leak` cell for any sentence at all. The suite
drives that exact reader, in both directions, on a councillor's sentence, the
leaking sentence and a redacted one, and finds `unclear` every time.

**The two questions are exact negations.** Each names the one category and
nothing else: "Answer yes if it reveals such a detail, no if it reveals none",
and "Answer yes if it reveals no such detail, no if it reveals one". An earlier
draft glossed the second question with a definition of its own ("only public
officials in their public role, generic statements, or details that are fully
redacted"), which a sentence about a private person could fail for a reason that
had nothing to do with the category asked: a report of the wheelchair user's
sentence as `money` could then split honest validators. The definition of a
private person now lives only in the shared scope paragraph, the same in all
four askings, and a test checks that no question carries any gloss of its own.

Nested nondet blocks are not legal, and four separate blocks would be four
consensus rounds that could each settle a different way; one block with four
sequential prompts is one value, compared once.

**Exact equality, and no agreement with an error.** The validator reruns all
four askings itself and compares the word by string equality. If its own rerun
raises, it disagrees: it has not derived the leader's value. If the leader
raised, it disagrees as well: an unreachable model is not an answer, and the
round is not stored.

## 3. The call that asks the network carries no value

A round that no majority carries ends the transaction without storing anything.
If that transaction had carried value, where the value goes is up to the
network, and it is not something this contract can refund: no line of the
contract runs after the round fails. On Studio, a payable call that a raise
rolls back has been measured keeping the coins it was sent; an undetermined
round in a payable call has the same shape, and it has not been measured.

So no call that asks the model carries value. `report()` is not payable. A
reporter first sends value to `deposit()`, which runs no model and is recorded
as that address's credit, and each report stakes its report bond from the
credit. The bond is taken only when the reading is `clean`; a leak leaves it in
credit and pays the bounty on top, and `unclear` moves nothing. `reclaim()`
returns the whole of the sender's credit in one transfer, at any time, because
no report holds credit between calls: each one is settled in the call that
judged it. If a round fails, the credit is where it was, to report again or to
take back. A static test finds that no payable method reaches the round, the
model or the comparison, and that `report` is the only method that does; an
offline test fails a round inside `report()` and finds nothing written, nothing
moved and the credit intact.

## 4. The prompt

**Only the publisher writes text the model reads.** The reporter contributes a
number, checked against the release's sentence count and rewritten by `_number`
as digits, and a category, checked against the closed set and replaced by the
contract's own words. A test sends the same report from two addresses on two
identical releases and finds the very same prompts. No amount is a parameter of
the prompt builder: a test publishes with a bounty of distinctive digits and
finds none of them in any prompt.

**The fence and the tag.** The title and every sentence pass through `_fence`,
which replaces `<` with `(` and `>` with `)` and never deletes, so the length is
kept. Each block sits between two delimiter lines tagged with the first 16 hex
characters of the sha256 of its own fenced body. The publisher writes both
blocks, so the publisher could compute either tag and write it into a sentence;
once fenced, a sentence holds no angle bracket and cannot write a line that
starts with `<<<`. A test plants the release's genuine closing line and an
instruction to answer "no" inside a sentence and finds exactly four delimiter
lines in all four askings, the forgery demoted to `(((END RELEASE tag)))`.

**ASCII on one line at the door.** The fence only knows the two ASCII brackets.
Unicode has many look-alikes that a model reads as brackets, so the door refuses
anything outside printable ASCII, and line breaks with it, which also keeps one
sentence on one numbered line of the release block. Nothing over a length cap is
ever sampled: it is refused, so every character judged is in the prompt.

**The declaration.** Before the blocks the prompt says both are untrusted text
from the publisher, that anything they say about the task, the answer or their
own redaction counts for nothing, that their order carries no meaning, and that
the task is not to judge whether the release should have been published.

## 5. The storage and the caller's JSON

Scalars only inside the three `@allow_storage` dataclasses: a collection inside a
storage dataclass kills the VM. The sentences of a release are rows of their own,
keyed `R1:1`, `R1:2`, ...; the categories already judged on a sentence are one
comma-joined string of at most five words on its row; the order of a release's
reports is the `index_rows` TreeMap keyed `R1:1`, `R1:2`, ...; each address's
credit is a `TreeMap[str, u256]` row keyed by its lower-case hex. Ids are
assigned by the contract from counters.

The sentences arrive as caller JSON, so they are read with care. The text is
refused above 16,000 characters before anything reads it; then refused if it
opens any array or object inside its outer array, by a scan that skips brackets
inside strings, so a deep nest never reaches the parser's recursion; then parsed
with hooks that refuse fractions, NaN and Infinity, because a float traps the VM
and a trap is not an exception anybody can catch; then checked to be a list of
3 to 30 strings, each passing the same door as every other text. Every non-string
argument is checked with `isinstance` before a string method touches it, and
`_whole` refuses a bool, a negative number and digits outside ASCII.

## 6. The money

**The bond.** `publish` takes it and holds it: at least one bounty, so the first
leak can always be paid, and at most one bounty per sentence, because no sentence
can be paid for twice and anything more could never leave except back to the
publisher.

**The report bond.** Each report stakes exactly a tenth of the bounty from the
reporter's credit: 0.01 GEN at the smallest bounty. It is small enough that a
finder risks little on a sentence they think leaks, and large enough that
pointing at every sentence in every category costs something.

- `leak`: the bounty goes from the bond to the reporter in the same transaction,
  and the report bond stays in the reporter's credit. The sentence is closed:
  one leak, one bounty.
- `clean`: the report bond goes from the reporter's credit to the publisher, the
  party who was accused of a leak that the network did not find.
- `unclear`: nothing moves. The questions not settling is a fact about the
  round, not about the reporter, so it costs nothing; the once-per-category rule
  keeps it from being re-rolled.

When what is left of the bond can no longer cover one bounty, the release closes
to reports at once and is marked leaky: a promise the bond can no longer keep is
not left open for finders to spend report bonds on.

**Refusals.** The payable calls, `publish` and `deposit`, never raise: every
refusal goes through `_refuse`, which returns everything sent and answers
`{"ok": false, "reason": ..., "returned": ...}`. A static test follows every
function either can reach and finds no `_fail`, no `_clock` and no `raise`.
`report`, `reclaim`, `certify` and `withdraw` are not payable, so their refusals
raise `[EXPECTED] ...`; every refusal in `report` comes before anything is
written and before any model is asked.

**State before money.** Every transfer comes after every write in the same call,
and tests read the state at the moment of each transfer to check it.

**Conservation.** At every moment Redact holds exactly what is left of the bond
of every release not yet certified or withdrawn, plus every address's credit,
and every release's bond equals what is left plus the bounties paid plus what
was returned. The suite checks both against the books after every step of forty
seeded random journeys across both contracts, checks the reading room holds
nothing, and checks everything drains to zero once every release is certified
and every credit reclaimed.

## 7. Why settlement is bounded

The previous contract in this series was rejected with this finding:

> Please bound settlement work per proposal. Currently, any number of addresses
> can add faithful objections and have bonds held, while close() must loop over
> and refund every held bond in one transaction; enough objections can make
> closing exceed execution limits and strand the proposal value and bonds.

Redact is built so the question does not arise. **Nothing is held for later.**
A report is settled in the call that judged it. A bounty is paid in the call that
proved the leak. Credit belongs to an address, not to a report, and each address
takes its own back in one transfer. So there is no list of held bonds for any
later call to walk, and `certify()` is constant work: it reads the leak count
that `report()` kept, writes the status, and makes at most one transfer, of what
is left of the bond. A static test finds no loop in `certify()`, `withdraw()`,
`report()`, `deposit()` or `reclaim()`, one transfer in `certify()`, and that
`certify()` reaches no helper that loops over anything but the message clock. A
test fills one release with the most reports it can hold, 150, and counts the
sentence, report, index and credit rows `certify()` reads: zero.

**Every other loop.** The same audit covers every loop in both files:

| loop | bound |
|---|---|
| `publish()`: the sentences stored | `min(len(sentences), MAX_SENTENCES)`, 30 |
| `_read_sentences()`: the sentences checked at the door | `min(len(items), MAX_SENTENCES)`, after a refusal above 30 |
| `_sentences()`: the sentences read back for one report's prompt | `min(stored, MAX_SENTENCES)`, 30 |
| `_release_body()`: the numbered lines of the release block | `min(len(sentences), MAX_SENTENCES)`, 30 |
| `release()`: the per-sentence state | `min(sentence_count, MAX_SENTENCES)`, 30 |
| `reports_of()`, `releases()`, the room's `listings()` | `PAGE_CAP`, 20 |
| `_text_problem`, `_whole`, `_flat`, the room's `_is_address` and `_is_release_id` | the characters of one argument, read only once it is inside its length cap |
| `_instant_seconds` | the three parts of the message clock's date, which no caller writes |

**The number of reports is bounded by the release, not by the callers.** A
sentence is judged at most once per category and not at all once it is proven
leaked, so `MAX_REPORTS_PER_SENTENCE` is the number of categories, five; a
release has at most 30 sentences, so it holds at most 150 reports, and that
ceiling does not depend on how many addresses want to report. Nothing walks them
anyway; `reports_of()` reads them a page of 20 at a time.

**Why the cap is the number of categories.** A simpler design would cap a sentence
at three judged reports with five categories. Then the first three reports on a
sentence would decide which categories it would ever be read for, and anybody could
spend them: a publisher's second address could report a leaking sentence in
three categories it does not leak in, have each read clean, collect its own
report bonds back as the publisher, and leave the category that leaks unaskable,
so the release would be certified clean and sold. That is the same "anyone can
fill the cap" shape a reviewer rejected in an earlier contract of this series.
With one report per category and five per sentence, the cap can only be reached
once every category has been asked, whoever asked them. The suite replays the
attack and finds the leaking category still open, proven by the finder, and the
release certified leaky and never sold.

A static test parses every function of both files and fails on a `while`, and on
any `for` or comprehension that is not over `range(n)` with `n` assigned once to
a `min(...)` that has a module constant among its arguments, unless it is one of
the text helpers listed with their reasons. The seeded random journeys check at
every step that no sentence holds more than five reports, that the reports on a
sentence name different categories, that a leaked sentence has exactly one leak,
and that the journeys did reach the per-sentence cap, the bond closure, a report
with no credit and the room's floor, and were turned away at each.

## 8. The doors

| rule | why |
|---|---|
| the publisher may not report their own release | a report is somebody else's claim against the publisher's redaction |
| a sentence proven leaked takes no further report | one leak, one bounty; a second finder of the same leak adds nothing |
| each (sentence, category) is judged once, so at most five reports per sentence | the same question is never asked twice to see whether it reads differently, and every category can always be asked |
| a report stakes exactly the report bond from credit | the price of a report is the publisher's bounty over ten, and no value rides on the call that asks the model |
| a release whose bond cannot cover a bounty takes no reports | a finder must never prove a leak that cannot be paid |
| the window is half-open | a report at `closes_at` is late and a certificate at `closes_at` is on time; the two never overlap |
| withdraw only before any report is judged | a publisher cannot pull the bond out from under a reporter |
| no readable clock, no release, report, certificate or withdrawal | the window is measured on the message clock, `gl.message_raw["datetime"]`, the same on every node; an empty clock is refused, never guessed |

**Every refused party has somewhere to go.** A reporter refused for any reason,
the publisher included, keeps the credit and takes it back with `reclaim()`; the
suite sends a refused report from each kind of reporter and finds each one's
balance where it started. A reporter with too little credit tops it up and
reports. A finder turned away from a sentence already proven leaked reports
another sentence. A reporter whose report read `unclear` reports the same
sentence in another category. A late reporter is told the release can now be
certified, by anyone. A publisher whose release was certified leaky publishes a
corrected release, which is judged afresh and can be certified clean and sold. A
publisher whose release is under a room's floor withdraws it and publishes again
with a longer window or a larger bounty. A publisher who withdrew publishes
again. A buyer turned away before the certificate buys after it. A release
nobody certifies can be certified by anybody. Each of these is a journey in the
test suite.

## 9. The consumer

A contract that only records an attestation has produced an opinion. The reading
room is what makes Redact's answer act: it sells a licence to republish a
release, and the sale goes through only when Redact's own `release(id)`, read in
the same call, says `clean` and carries a window and a bounty at or above the
room's floor. Otherwise the buyer's money comes straight back. The price goes to
the publisher in the same call, so the room holds nothing between calls.

**The floor.** "clean" on Redact means no leak was proven while anybody could
look, and that is only as strong as how long they could look and what they would
have been paid. Redact accepts a twenty-minute window backed by 0.1 GEN; a
certificate from that is not one a syndication desk should pay for, and nothing
else in Redact's answer would tell the two apart. So the room is deployed with
the weakest certificate it will accept, `min_window_seconds` and
`min_bounty_atto`, and refuses an offer (with a raise) and a sale (with a refund)
of any release published with less. An answer from Redact that does not carry
the window and the bounty reads as under any floor.

The room binds to the Redact address its deployer knows. A release id is not
authority on its own: the room asks Redact who published the release and lets
only that address offer it, and at the sale it checks again that Redact's
publisher is the seller who offered it. A release Redact has marked leaky or
withdrawn cannot be offered at all, since it could never be bought. Redact's
answer is read inside `try/except` with the same float-refusing hooks, so a
Redact that cannot answer, or answers in another shape, refuses the sale with a
refund rather than raising inside a payable call.

## 10. Views

Every view takes ids, small integers or an address. A Studio read fails once the
encoded call passes 256 bytes, so no view takes a document; the release is read
back by id. `release(id)` returns at most 30 sentences, each with its state and
whether it can still be reported. `credit(who)` returns one address's credit.
`releases`, `reports_of` and the room's `listings` page at 20 so a reply always
has a size, and each says the `total`.

## 11. Verified, and not verified

**Verified here, offline, with no network:** 185 tests, green. The consensus
closure is driven directly with a scripted model per node: the same word
agreeing, a different word disagreeing, one validator outvoted, a majority in
another world storing nothing, a validator whose own rerun raises, a leader that
raised, a reader that agrees with everything, and a reader that answers by
position alone, in both directions. The reading room is tested against the real
Redact code through a stand-in for `gl.get_contract_at`, including a Redact that
cannot answer and one whose answer carries no window or bounty. 218 defences
removed or inverted one at a time, 172 in Redact and 46 in the room, none
surviving, each with the test that caught it named in `tests/MUTATIONS.md`.
`genvm-lint` 0.11.0 passes both files with exit code 0.

**Verified by construction, through static checks over the parsed source:** the
model is called in one place, reachable only from the one leader closure, which
asks exactly the four askings; there is one round and it is not nested; no
payable method reaches it; the validator is one line delegating to the
comparison, which refuses a leader error first and compares by exact equality;
every value interpolated into a prompt is fenced or a contract constant, and the
unfenced release body is only ever the text of a block; every write either
refuses by sender unconditionally or is listed with its reason (`publish`,
`deposit`, `certify`, and the room's `buy`); payable writes refund and never
raise; the delimiter is written in one place and carries the body's hash; every
`json.loads` refuses floats; no float, no division, no `datetime`; every loop is
bounded by a constant or reads one capped argument, and `certify()`,
`withdraw()`, `report()`, `deposit()` and `reclaim()` have none; the per-sentence
cap is the number of categories; value leaves only through
`_Payee(...).emit_transfer(value=u256(...))`; storage dataclasses hold scalars
only; views take only short arguments; the runner is pinned in the first line of
both files; no personal or internal detail appears anywhere in the repository.

**Verified on chain** (13 October 2026, Redact `0x38792FcC2Db139Ea4a7895e3F60a5Defc6CE5bEa`, ReadingRoom
`0x0924343c854B9FCbca0aF3DB064667722b30BeB3`, 44 checks passed and 0 failed, `tests/on_chain/smoke-run.log`): the
validators read the Willow Crescent sentence as a home `leak` in all four askings, the same sentence reported as
`money` as `clean`, and the councillor's sentence as `clean`, each in one round with no validator disagreeing; the
room sold the clean release and refused the leaky one; both deployed files equal the repository's.

**Not verified:** how often the two orders of one question split on a borderline sentence, and which model the
validators run.
