# Contracts

Two files. `contracts/redact.py`, class `Redact`, is the contract.
`contracts/fixtures/reading_room.py`, class `ReadingRoom`, is the consumer that
acts on its answer.

## Purpose

A redacted release with a bond behind it, which anybody may test for leaks. A
report names one sentence and one kind of private detail; the network decides,
under consensus, whether that sentence still reveals that kind of detail about an
identifiable private person. A proven leak pays the reporter a bounty from the
publisher's bond in the same transaction and closes that sentence. After the
window anybody may certify the release: clean when no leak was proven, leaky
otherwise, with what is left of the bond back to the publisher. The reading room
sells a licence to republish a release only when Redact says clean and the
release's window and bounty meet the floor the room was deployed with.

## Consensus

One round, `_report_round(title, sentences, number, category)`, one
`gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` block, run inside `report()`
after every door has passed and before anything is written. The only
`gl.nondet.exec_prompt` call in the file is in `_ask`, and the only four `_ask`
calls are inside that `leader_fn`. Nothing is nested. `report()` is not payable,
and no payable method reaches the round.

**The four askings.** `_task(title, sentences, number, category, framing,
order)` builds each one. The framing fixes the question and the order fixes
which block comes first; nothing else differs:

- `FRAMING_LEAK`: "Does sentence N, read with the rest of this release, reveal
  *(category)*? Answer yes if it reveals such a detail, no if it reveals none,
  unclear if you cannot tell."
- `FRAMING_FREE`: "Is sentence N, read with the rest of this release, free of
  *(category)*? Answer yes if it reveals no such detail, no if it reveals one,
  unclear if you cannot tell."
- `ORDER_RELEASE_FIRST`: the RELEASE block (the title, then every sentence on its
  own numbered line), then the SENTENCE block ("Sentence N: ...").
- `ORDER_SENTENCE_FIRST`: the SENTENCE block, then the RELEASE block.

The leader asks L1 (leak, release first), L2 (leak, sentence first), F1 (free,
release first) and F2 (free, sentence first). The category text comes from
`CATEGORY_TEXT`, a contract constant keyed by the closed set `identity`, `home`,
`health`, `money`, `contact`; each entry names the private person itself. The
questions carry no definition of their own: who is a private person, and that a
`[REDACTED]` mark reveals nothing, is said in the scope paragraph that all four
askings share. The sentence number is written by `_number`, which returns ASCII
digits no larger than 30.

Each answer is read by `_read_answer` into `yes`, `no`, `unclear` or `""` (an
answer the contract cannot read). JSON from the model is parsed with hooks that
refuse fractions, NaN and Infinity, so no float is ever built.

**The combine rule.** `_both(first, second)` is a question's answer across its
two orders: the word when both orders gave it, else `""`. Then
`_combine(_both(L1, L2), _both(F1, F2))`: `yes` then `no` is `leak`; `no` then
`yes` is `clean`; anything else is `unclear`. The stored value is that one word,
on the report's row. A disagreement between the questions, or between the two
orders of one question, is a value, never a tolerance, and it pays nobody.

**The comparison.** `validator_fn` is one line, `return _agrees(leaders_res,
leader_fn)`. `_agrees` returns `False` for a leader that raised, `False` for a
leader result that is not a dictionary, reruns the whole leader closure (all four
askings) inside `try/except` (its own failure is a disagreement), and compares
`v` by exact string equality.

**The prompt boundary.** `_block(label, text)` fences the text (`<` to `(`, `>`
to `)`, never deleted) and writes it between `<<<LABEL tag>>>` and `<<<END LABEL
tag>>>`, where `tag` is the first 16 hex characters of the sha256 of the fenced
body. It is the only place a delimiter is written. The labels are the two
contract constants `RELEASE` and `SENTENCE`. `_release_body` builds the release
text and is only ever called as the text of a block. Before the blocks the prompt
says both are untrusted, that their order carries no meaning, that a public
official in office is not a private person, that `[REDACTED]` reveals nothing,
that a detail found only in other sentences does not count against this one, and
that the task is not to judge whether the release should have been published.
Nothing the reporter wrote is a parameter of `_task` or of the round, and neither
is any amount.

## State

Three storage dataclasses of scalars only (a collection inside a storage
dataclass kills the VM):

| `Release` field | type | what it is |
|---|---|---|
| `publisher` | `Address` | who released it and posted the bond |
| `title`, `sentence_count` | `str`, `u32` | the release's title and how many sentences it has |
| `bounty`, `report_bond` | `u256` | paid per proven leak, and staked per report (a tenth of the bounty) |
| `bond`, `bond_left` | `u256` | the bond posted, and what of it is still held |
| `window`, `opened_at`, `closes_at` | `u32`, `u64`, `u64` | the report window on the message clock |
| `status` | `str` | `open`, `leaky`, `clean` or `withdrawn` |
| `leaks`, `judged`, `cleared`, `unclear` | `u32` | counts of judged reports, kept as they land |
| `paid_out`, `fined` | `u256` | bounties paid from the bond, and report bonds paid to the publisher |
| `settled_at`, `settled_by`, `returned` | `u64`, `Address`, `u256` | the certificate or withdrawal, and what went back to the publisher |

| `Sentence` field | type | what it is |
|---|---|---|
| `release`, `number`, `text` | `str`, `u32`, `str` | which release, which sentence, and its text as judged |
| `state` | `str` | `open` or `leaked` |
| `judged`, `categories` | `u32`, `str` | judged reports on it (at most 5, one per category), and the categories they named |
| `leak_report` | `str` | the report that proved it leaked |

| `Report` field | type | what it is |
|---|---|---|
| `release`, `sentence`, `category`, `reporter` | `str`, `u32`, `str`, `Address` | what was reported, and by whom |
| `verdict` | `str` | `leak`, `clean` or `unclear`: the stored consensus value |
| `bond`, `bounty_paid`, `to_publisher` | `u256` | the report bond staked, and where the money went |
| `at` | `u64` | when it was judged |

The contract holds `TreeMap[str, Release]` keyed by contract-assigned ids (`R1`,
`R2`, ...), `TreeMap[str, Sentence]` keyed `R1:4`, `TreeMap[str, Report]` keyed by
contract-assigned ids (`F1`, `F2`, ..., F for finding), one `TreeMap[str, str]`
index (`R1:3` to the id of the third judged report on R1), `TreeMap[str, u256]`
of credit keyed by lower-case address, and scalar counters. `bonds_held` plus
`credits_held` is what the contract owes, and it equals the contract's balance
after every call.

The reading room holds the bound Redact `Address`, its floor (`min_window`,
`u32`, and `min_bounty`, `u256`), `TreeMap[str, Offer]` keyed by release id,
`TreeMap[str, str]` (`3` to the third release offered), `TreeMap[str, Sale]`
keyed `R2:<buyer>`, and counters. It holds no money between calls.

## Key methods

| method | kind | what it does |
|---|---|---|
| `publish(title, sentences_json, bounty_atto, window_seconds)` | payable write | holds the bond behind a new release of 3 to 30 sentences; runs no model; every refusal returns the value |
| `deposit()` | payable write | holds the value as the sender's credit for report bonds; runs no model; a deposit of nothing is refused |
| `report(release, sentence_index, category)` | write | checks the door with no model, refusing with `[EXPECTED]`; then runs the round and settles the report in the same call, staking the report bond from the reporter's credit |
| `reclaim()` | write | the sender's whole credit back, in one transfer |
| `certify(release)` | write | after the window: clean or leaky by the stored leak count, what is left of the bond to the publisher, one transfer at most; refusals raise `[EXPECTED]` |
| `withdraw(release)` | write | the publisher, before any report is judged: the bond back, the release never certified |
| `release(release_id)` | view | the whole release with every sentence's state, `status`, `window`, `bounty`, `would_be`, `certifiable`, `taking_reports` and `taking_reports_why` |
| `report_record(report_id)` | view | one report: what was reported, the stored word, and where the money went |
| `reports_of(release_id, offset, limit)` | view | a page of at most 20 ids of the judged reports on one release, in the order judged, with `total` |
| `releases(offset, limit)` | view | a page of at most 20 release summaries, oldest first |
| `credit(who)` | view | what one address holds as credit |
| `stats()` | view | counts, `bonds_held`, `credits_held`, `bounties_paid`, `fined_total` and `balance_owed` |
| `rules()` | view | the askings, the combine table, the categories, what is compared, the money, the settlement, who may do what, and every limit |

The single report view is `report_record`, not `report`, because `report` is the
write.

| `ReadingRoom` method | kind | what it does |
|---|---|---|
| `__init__(redact, min_window_seconds, min_bounty_atto)` | constructor | binds the room to one Redact address and to the weakest certificate it will sell |
| `offer(release, price_atto)` | write | the publisher of the release on Redact, read now, offers it or changes its price; a leaky or withdrawn release, or one under the floor, is refused |
| `buy(release)` | payable write | pays exactly the price; refused with a refund unless Redact's `release(id)`, read in the same call, says `clean` with a window and a bounty at or above the floor; otherwise the price goes to the publisher at once |
| `listing(release_id)`, `holding(release_id, who)`, `listings(offset, limit)`, `room()` | views | one offer, whether an address holds a licence, a page of offers, and the room's binding, floor and totals |

Every view takes ids, small integers or an address, never free text: a Studio
read fails once the encoded call passes 256 bytes.

## Bounds

Every loop has a constant ceiling, and settlement walks nothing.

| constant | value | what it bounds |
|---|---|---|
| `MAX_SENTENCES` | 30 | sentences stored by `publish()`, read back for a prompt by `report()`, and listed by `release()` |
| `MAX_REPORTS_PER_SENTENCE` | `len(CATEGORIES)`, 5 | judged reports per sentence, one per category, so at most 150 per release |
| `PAGE_CAP` | 20 | rows per page of `releases()`, `reports_of()` and the room's `listings()` |
| `MAX_JSON_CHARS` | 16,000 | the sentences JSON, read only once it is inside this cap and flat |

`report()` settles its own report in at most one transfer. `certify()` reads the
release's leak count, kept as reports landed, and makes at most one transfer; it
touches no sentence, report or credit row. `withdraw()` and `reclaim()` make one
transfer each. A static test fails on any loop that is not `range(n)` with `n`
assigned once to a `min()` with a module constant among its arguments, other than
helpers that read the characters of one argument already inside its length cap
or the parts of the message clock, and on any loop at all in `certify()`,
`withdraw()`, `report()`, `deposit()` or `reclaim()`.

## Reuse

`release(id).status` is the reusable answer: `clean` means the release survived
a window in which anybody who found a private person in it would have been paid
for saying so, and `release(id)` carries the window and the bounty, so a consumer
can decide how strong a `clean` it needs. The reading room reads all three and
acts only on `clean` at its floor; an archive, a syndication desk or a data
service could gate on them the same way. The round is reusable on its own as
well: `_report_round` answers "does this sentence, in this document, still
reveal this kind of detail about a private person" for any text, with the
disagreement of the questions or of their orders stored as `unclear` rather than
smoothed away.

## Limits

- Clean means no leak was proven during the window, not that none exists; its
  strength is the window and the bounty, which a consumer sets a floor on.
- Each (sentence, category) is judged once, by whoever asks first; the question
  is the same whoever asks, and an `unclear` reading is final for it.
- The model reads only the released text; a detail recoverable only with outside
  knowledge is out of its reach.
- A report in the wrong category reads clean, and its bond goes to the publisher.
- A publisher may withdraw only before any report is judged, and a withdrawn
  release is never certified.
- A Studio transaction's clock is the message `datetime`; a transaction with no
  readable clock is refused, never guessed.
