# Redact

A redacted release is bonded against leaks. The first person to point at a
sentence that still reveals a private person's details is paid from the
publisher's bond, and only a release that stays clean is certified.

A publisher, a parish council clerk, a court office, an inspection body,
releases a redacted text, split into numbered sentences, and posts a bond behind
it. For a fixed window anybody else may point at one sentence and name the kind
of private detail it still gives away: a person's identity, their home, their
health, their money or their contact details. The network reads that sentence
against the whole release and decides one thing: does it still reveal that kind
of detail about an identifiable private person? If it does, the finder is paid a
bounty from the bond in the same transaction. After the window anybody may
certify the release: **clean** if no leak was proven, **leaky** if one was. A
consumer contract, `contracts/fixtures/reading_room.py`, sells a licence to
republish a release only when Redact says clean, and only when the release's
window and bounty meet the floor the room was deployed with.

## How consensus is used

One report is one consensus block, `gl.vm.run_nondet_unsafe(leader_fn,
validator_fn)`. Inside it the network asks two opposite questions, and asks each
of them in both presentation orders: four prompts, one after the other, in the
one leader closure.

| asking | first block | second block | question |
|---|---|---|---|
| L1 | the whole release, every sentence numbered | the target sentence | Does sentence N, read with the rest of this release, reveal *(the category)*? |
| L2 | the target sentence | the whole release | the same question |
| F1 | the whole release, every sentence numbered | the target sentence | Is sentence N, read with the rest of this release, free of *(the category)*? |
| F2 | the target sentence | the whole release | the same question |

The two questions are exact negations about the one category named, and nothing
else: "yes" to L means it reveals such a detail, "yes" to F means it reveals
none. Who counts as a private person, and that a `[REDACTED]` mark reveals
nothing, is said once in the shared preamble, the same for all four askings. The
category is one of five, each asked in words the contract owns:

| category | asked as |
|---|---|
| `identity` | the name of a private individual, or details that plainly identify one |
| `home` | the home address or exact home location of an identifiable private person |
| `health` | the health or medical condition of an identifiable private person |
| `money` | the account numbers, debts or income of an identifiable private person |
| `contact` | the personal phone number or email address of an identifiable private person |

Each answer is `yes`, `no` or `unclear`. A question's answer counts only when
both of its orders gave the same word; otherwise that question is unsettled. The
contract then combines the two questions into one word, and that word is the
whole stored value:

| L (both orders) | F (both orders) | stored | what happens in the same transaction |
|---|---|---|---|
| yes | no | `leak` | the bounty goes from the bond to the reporter; the sentence takes no further report |
| no | yes | `clean` | the report bond goes from the reporter's credit to the publisher |
| anything else | | `unclear` | nothing moves; nothing is proven |

A paying cell needs four answers that agree with each other in meaning and
differ in wording and position. A reader that agrees with whatever it is asked
says yes to both questions; a reader that answers by which block came first
gives different words to the two orders of one question. Both land in
`unclear`. The test suite drives both readers, in both directions, through the
round.

Every validator reruns all four askings itself and compares the word by exact
string equality. A validator whose own rerun raises disagrees, and a leader that
raised is never agreed with, so no error is ever stored as if it were an answer.
No sentence from a model reaches storage: every `why` on every row is written by
the contract from the word it stored.

The reporter writes nothing the model reads. A report is a sentence number,
which the contract checks, and one word from the closed set of categories. The
only untrusted text in the prompt is the publisher's own: the title and the
sentences reach the model fenced (`<` and `>` replaced, never deleted) and
between delimiter lines tagged with the sha256 of the block's own fenced text,
after a paragraph that declares both blocks untrusted. The door only admits
printable ASCII on one line, so no look-alike bracket from elsewhere in Unicode
can draw a delimiter the fence does not know. No amount of money is ever in the
prompt.

## The call that asks the network carries no value

`report()` is not payable. A reporter first `deposit()`s value as credit, in a
call that runs no model, and each report stakes its report bond from that
credit. If a round is never carried, because the model provider failed or no
majority formed, the transaction stores nothing and no value was sent with it:
the credit is where it was, to report with again or to take back with
`reclaim()`, in one transfer, at any time. The only payable calls, `publish()`
and `deposit()` on Redact and `buy()` on the reading room, run no model, and
every refusal in them returns what was sent.

## Who may do what

| call | who | when | refused how |
|---|---|---|---|
| `publish(title, sentences_json, bounty_atto, window_seconds)` | anyone; the sender is the publisher | any time | returns the value sent, `ok: false` and the reason |
| `deposit()` | anyone, for their own address | any time | a deposit of nothing returns `ok: false` |
| `report(release, sentence_index, category)` | anyone but the publisher, with credit for the report bond | during the window, while the bond covers a bounty; once per (sentence, category), so at most five times per sentence, and not at all once it is proven leaked | raises `[EXPECTED] ...` before any model is asked; nothing was sent |
| `reclaim()` | anyone, for their own credit | any time | raises `[EXPECTED] ...` when there is none |
| `certify(release)` | anyone | once the window has passed, once | raises `[EXPECTED] ...` |
| `withdraw(release)` | the publisher | before any report has been judged | raises `[EXPECTED] ...` |

`certify` is open to anyone on purpose: the outcome is fixed by the stored leak
count, not by who calls, and no release can be left holding a bond because its
publisher went away. `deposit` is open on purpose too: it credits only the
sender, and only the sender can spend or reclaim that credit. The test suite
lists both, with those reasons, beside `publish`.

The limits: title 3 to 80 characters; 3 to 30 sentences of 10 to 250 characters
each, sent as a JSON array of at most 16,000 characters; window 1,200 seconds to
30 days; bounty 0.1 to 50 GEN; bond at least one bounty and at most one bounty
per sentence; report bond a tenth of the bounty. `rules()` publishes all of them,
and `release(id)` says whether the release is still taking reports
(`taking_reports`), why, and which sentences can still be reported.

## The money

| moment | from | to | amount |
|---|---|---|---|
| `publish` | publisher | contract | the bond |
| `deposit` | anyone | contract, as their credit | what they send |
| any refused payable call | contract | the caller | everything it sent |
| `report`, read `leak` | the bond | reporter | the bounty; the report bond stays in credit |
| `report`, read `clean` | reporter's credit | publisher | the report bond |
| `report`, read `unclear` | | | nothing |
| `reclaim` | contract | the sender | all of their credit |
| `certify`, clean or leaky | contract | publisher | what is left of the bond |
| `withdraw`, before any report | contract | publisher | the whole bond |
| `buy` on the reading room, release clean and at its floor | buyer | publisher | the price, in the same call |

At every moment Redact holds exactly what is left of the bond of every release
not yet certified or withdrawn, plus every address's credit. `stats()` publishes
that sum as `balance_owed`, and the offline suite checks it against the
contract's books after every step of forty seeded random journeys. The reading
room holds nothing between calls.

### Settlement is pay as you go

Nothing waits for the end of the window. Each report is settled in the call that
judged it: the bounty, the report bond, the sentence's state and the release's
leak count are all written and paid there. So `certify()` has nothing to walk.
It reads the leak count that was kept as the reports landed, writes the status,
and makes at most one transfer, however many reports there were. A static test
reads `certify()` and finds no loop and one transfer, and a test fills a release
with the most reports it can hold, 150, and counts the rows `certify()` reads:
none.

Every other loop in the contract has a constant ceiling. A release has at most
`MAX_SENTENCES` (30) sentences, so storing them, reading them back for a prompt
and listing them in `release(id)` each run at most 30 times. A sentence is judged
at most once per category, so `MAX_REPORTS_PER_SENTENCE` is the number of
categories, 5, and a release holds at most 150 reports.
`reports_of(release_id, offset, limit)` and `releases(offset, limit)` return at
most `PAGE_CAP` (20) rows and the `total`. A static test parses both files and
fails on any loop that is not `range(n)` with `n` assigned once to a `min()` of a
module constant, other than a few helpers that read the characters of one
argument already inside its length cap, or the three parts of the message clock.

## Why this has to be on GenLayer

Whether a sentence still gives away a private person is a judgement about
meaning in context: "the resident at 22 Willow Crescent, who has used a
wheelchair since her stroke" names nobody and still identifies a woman, her home
and her health, while "Councillor Ellis opened the meeting" names somebody and
gives nothing away. No pattern match reaches it, and a single model call is one
reading its caller controls. Here the reading is repeated by every validator,
asked four ways, and only a word they agree on moves money.

## Who uses it

- **A publisher that redacts by hand**: a parish council, a planning office, a
  court list, a school board. The bond is a promise to the people named in the
  minutes, and the bounty pays whoever catches the clerk's mistake first.
- **People who read releases closely**: a finder is paid for a leak at once, and
  a report that turns out clean costs only a tenth of the bounty.
- **A consumer contract**. `release(id).status` is `open`, `clean`, `leaky` or
  `withdrawn`, reached under consensus and arithmetic, and `release(id)` also
  carries the window and the bounty the release was published with. The reading
  room in `contracts/fixtures/` is deployed with the weakest certificate it will
  accept, a least window and a least bounty, and sells a licence to republish a
  release only when Redact says `clean` and the release meets that floor,
  reading Redact's own view in the same call and paying the publisher there and
  then. A leaky release, one not yet certified, or one published with less
  behind it than the floor cannot be sold: the buyer's money comes straight
  back. An archive, a newspaper's syndication desk or a data service could gate
  on the same fields.

## The limits, stated plainly

- **Clean means survived, not proven safe.** A release is certified clean when
  nobody proved a leak during its window. A leak nobody reported is still a
  leak. How much "clean" is worth depends on how long anybody had to look and
  how much they would have been paid, which is why a consumer sets its own floor
  on both: a release with a twenty-minute window and the smallest bounty is
  certified by Redact, and a room deployed with a higher floor never sells it.
- **Every category of every sentence can be asked.** A sentence takes one judged
  report per category and no more, so the cap is reached only once all five have
  been asked; nobody, the publisher's other addresses included, can use up a
  sentence before the category it leaks in has been asked. Whoever asks a
  (sentence, category) first, the question put to the network is the same,
  because the reporter writes nothing the model reads. A publisher whose second
  address asks the category a sentence really leaks in gets the reading a finder
  would have got, and a leak proven that way is proven against their own
  release. An `unclear` reading is final for that question: asking the same
  question again until it reads differently is what the once-per-category rule
  prevents, for either side.
- **The network reads only the released text.** A detail that can be recovered
  only with outside knowledge (a street everyone in the village knows) is not
  something the model is asked to weigh. A detail spread over two sentences is:
  each question reads the target sentence with the rest of the release.
- **A category is the reporter's choice.** A sentence that leaks a home address
  but is reported as `money` reads clean, and the report bond goes to the
  publisher. Each question names only its category, so a sentence about a
  private person is not marked against a category it does not reveal; the
  on-chain run sends exactly that report.
- **A publisher can withdraw before the first report lands.** Withdrawing is
  allowed only while no report has been judged, so a publisher who sees a report
  coming could still pull the bond first. A withdrawn release is never certified,
  so it can never be sold as clean.
- **The reading room sells a licence, not secrecy.** The text is public on
  Redact. What the room records is that a buyer paid the publisher for the right
  to republish a release that survived its window.

## What is in this repository

```
contracts/redact.py                    the contract
contracts/fixtures/reading_room.py     the consumer: sells a licence only for a release certified clean, at its floor
tests/test_pure.py                     the offline suite, the consensus round with scripted models, and the room
tests/MUTATIONS.md                     every defence in both files removed in turn, and the test that caught it
tests/on_chain/smoke.mjs               a throwaway-account run of both contracts against Studio
tools/mutate.py                        the generator that writes MUTATIONS.md and refuses to if anything survives
CONTRACTS.md                           purpose, consensus, state, methods, bounds, reuse and limits
DECISIONS.md                           why each rule is the way it is, and what is verified and what is not
```

## Running it

```
pip install -r requirements-dev.txt
pytest tests/ -q                                         # 185 tests, no network, no Studio
genvm-lint check contracts/redact.py                     # the package is genvm-linter, the command genvm-lint
genvm-lint check contracts/fixtures/reading_room.py
python tools/mutate.py                                   # rewrites tests/MUTATIONS.md; exits 1 if a mutant survives
```

- `pytest tests/ -q` gives **185 passed** in a few seconds, with nothing
  installed but pytest.
- `genvm-lint check` version 0.11.0 prints `Lint passed (3 checks)` and
  `Validation passed` for both files and exits 0. It reads Redact as 13 methods,
  7 view and 6 write, and ReadingRoom as 6 methods, 4 view and 2 write.
- `python tools/mutate.py` removes or inverts **218 defences** one at a time, 172
  in Redact and 46 in the reading room, and **none survives**;
  `tests/MUTATIONS.md` names the test that failed for each.

The on-chain run generates its own keys and funds them over the network's own
RPC; it never touches a wallet of anybody's own:

```
npm ci
node tests/on_chain/smoke.mjs                  # the whole run, about 50 to 65 minutes
RESUME=1 node tests/on_chain/smoke.mjs         # continue a run that was cut off
STATE=run.json RESUME=1 node tests/on_chain/smoke.mjs
```

It deploys both contracts, the room with a floor of 1,200 seconds and 1 GEN, and
plays four generated accounts: P the publisher, F the finder, G a second finder,
and S a stranger. R1, "Minutes of the Riverside parish council, 14 March", has
one sentence that still gives a resident away. S, with no credit, is refused
before any model is asked; S then deposits and reports that sentence as `money`,
the wrong category, which reads clean. F reports it as `home` and is paid the
bounty in the same transaction; G reports the councillor's sentence as
`identity` and the report bond goes to P; a second report on the leaked sentence
is refused; F and G take back what is left of their credit; and a report after
the window is refused. R2, the April minutes, fully redacted, is certified clean
by S after its window and sold through the reading room, with the price paid to
P in the same call; buying it before the certificate, and buying the leaky R1 at
all, are refused with the money returned. R3, the April minutes with half the
bounty, is refused by the room for its floor and withdrawn by P. It prints one
PASS or FAIL line for each of its 44 checks and `N passed, M failed`, and it
compares the code deployed at both addresses with these two files byte for byte.
Every step is saved to the state file as it is made, with the keys, both
contract addresses and the steps already finished, so a run that outlives its
process continues where it stopped without sending anything twice. Every id is
read from the receipt that created it, and every wait for a window reads the
chain's own clock.

## Network

Studio, chain 61999. RPC `https://studio.genlayer.com/api`, explorer
`https://explorer-studio.genlayer.com`. Both contracts pin the runner
`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` in their first
line.

## Evidence

Run on 13 October 2026 on GenLayer Studio (chain 61999) by `tests/on_chain/smoke.mjs`, from four generated
accounts: **P** the publisher, **F** and **G** two finders, **S** a stranger. **44 checks passed, 0 failed**; the
whole log is `tests/on_chain/smoke-run.log`.

Redact [`0x38792FcC2Db139Ea4a7895e3F60a5Defc6CE5bEa`](https://explorer-studio.genlayer.com/address/0x38792FcC2Db139Ea4a7895e3F60a5Defc6CE5bEa)
and ReadingRoom [`0x0924343c854B9FCbca0aF3DB064667722b30BeB3`](https://explorer-studio.genlayer.com/address/0x0924343c854B9FCbca0aF3DB064667722b30BeB3).
`gen_getContractCode` on each returns its repository file byte for byte (`contracts/redact.py`, 51,636 bytes, sha256
`4920a1cc7257800ca59cfbb81eb412951fa1c20501ae73ceb55afaf90fade649`; `contracts/fixtures/reading_room.py`, 15,097 bytes,
sha256 `fc387c91cb0be1a371efb9abe349a7c4db460f079cdddfb7362e0ec0c17219cc`).

| call | by | transaction | result |
|---|---|---|---|
| deploy `contracts/redact.py` | P | [0xa4723839…](https://explorer-studio.genlayer.com/tx/0xa47238390002ecba902a733cc55228b308456835c63a0e0a65ef8c97040389f1) | Redact `0x38792FcC…5bEa`, byte for byte the repository file (sha256 `4920a1cc…`) |
| deploy `contracts/fixtures/reading_room.py`, floor 1200 s and 1 GEN | P | [0xb1bd9ef2…](https://explorer-studio.genlayer.com/tx/0xb1bd9ef2b2fa01b079f5ac261c4a2dc419a468f804becf99416efbc4d9ccbf15) | ReadingRoom `0x0924343c…BeB3`, byte for byte (sha256 `fc387c91…`) |
| publish with a ten-minute window | P | [0x14eb1098…](https://explorer-studio.genlayer.com/tx/0x14eb10986f8bffa64d2a50957631d418c61d040444ad316e8e2e67bb6c94787a) | refused; the 2 GEN came back in the same transaction |
| publish R1, the March parish minutes: six sentences, bounty 1 GEN, bond 2 GEN | P | [0xa8cf95ec…](https://explorer-studio.genlayer.com/tx/0xa8cf95ec869f5e6a3e3e1e778fa280832dce3c3d7d8c555458c2564a323b3f58) | R1 open for reports |
| offer R3 (bounty 0.5 GEN) in the room | P | [0x6d98927d…](https://explorer-studio.genlayer.com/tx/0x6d98927dafbf5006c9daa23825137d01f18cc14e95d117cd3c575de74d465e86) | refused: under the room's 1 GEN floor |
| buy R2 before it is certified | S | [0x3a52b689…](https://explorer-studio.genlayer.com/tx/0x3a52b6896af39ed84234eebf233224c222e6811ad8029223feef7ce430eea5ff) | refused; the 2 GEN came back |
| report with no credit | S | [0xe42cd62f…](https://explorer-studio.genlayer.com/tx/0xe42cd62f94b8cdb22e5407093e2a3ac1e43d7fa936d3c32129ac4e86df1d03a3) | refused before any model is asked; nothing taken |
| report sentence 4 as `money`, which it does not reveal | S | [0x05641489…](https://explorer-studio.genlayer.com/tx/0x05641489492b1cb2e5044abef50fb51c4f7669be93a7a634ede6f38677c9646b) | **clean**; S's report bond to the publisher |
| report sentence 4 ("The resident at 22 Willow Crescent…") as `home` | F | [0x2759d477…](https://explorer-studio.genlayer.com/tx/0x2759d477858cbc091753f46dc64c9f2e4587a5dba25f2b708672316e4574261b) | **leak**, read so by both questions in both orders (3 agree, 2 idle); the 1 GEN bounty from the bond to F in the same transaction |
| report sentence 1 (Councillor Ellis) as `identity` | G | [0x4d7de44f…](https://explorer-studio.genlayer.com/tx/0x4d7de44fd8a2c360f1f583567cd9f1f336e085ba77e72e8e425c3cd57764a067) | **clean**: an official in office is not a private person; G's bond to the publisher |
| report the leaked sentence again, as `health` | G | [0xa2249f49…](https://explorer-studio.genlayer.com/tx/0xa2249f49d8bf640751d7f7568dd7972bcf2387e5a1adf49e879bddcf39f399ac) | refused with no model asked: already proven leaked |
| report after R1's window | S | [0xed34f929…](https://explorer-studio.genlayer.com/tx/0xed34f92957d99e7d0336e0059c01f4346558a315444ed713428bea34f116eddc) | refused |
| certify R1 | S | [0x9355cc1d…](https://explorer-studio.genlayer.com/tx/0x9355cc1d893e8639a8cb83857d9a8f631bdd9b68a720e167758e0e37fbf691b3) | **leaky**; the 1 GEN left of the bond back to the publisher |
| certify R2, the fully redacted April minutes | S | [0x73f13286…](https://explorer-studio.genlayer.com/tx/0x73f1328651ad6edd844ee66f21cf0fae4d63a6b2bc59fece19b2b32aca6c51bc) | **clean**; the whole 1 GEN bond back |
| buy R2 in the room | S | [0xfbf90664…](https://explorer-studio.genlayer.com/tx/0xfbf906646e733442f2c654d8e989ed173dfc252de38aafd96df69ae053f1a8c2) | sold: the room read `clean` from Redact and paid the publisher 2 GEN in the same call |
| buy R1 in the room | S | [0xacd83149…](https://explorer-studio.genlayer.com/tx/0xacd831499bd5545535a519c594879dc34a851b4434bd4fbdecb2b98274045c93) | refused: R1 is leaky on Redact; the 2 GEN came back |

At the end both contracts held nothing, every credit was zero, `stats()` read one clean, one leaky and one withdrawn
release, and every account ended exactly where its receipts said (P +1.2 GEN, F +1, G −0.1, S −2.1).

## Licence

MIT. See `LICENSE`.
