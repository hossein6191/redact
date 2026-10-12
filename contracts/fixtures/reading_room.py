# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""ReadingRoom: sells a redacted release only once Redact has certified it clean.

One reading room is bound, at deployment, to one Redact contract and to the
weakest certificate it will accept: a least report window and a least bounty.
"clean" on Redact is only as strong as the window anybody had to find a leak and
the bounty they would have been paid for it, so the room's deployer sets the
floor, and a release published with less is never offered or sold here. The
publisher of a release on that contract may offer it here at a price. The text itself is
public on Redact; what a buyer pays for is the publisher's licence to republish
it (an archive, a local paper, a data service), recorded here against the
buyer's address, where anybody, or any other contract, can check it. Anybody may
buy, and the sale is decided by Redact's own view of the release, read here and
now in the same call:

    status "clean", window and bounty  -> the price goes to the publisher, and the buyer holds the licence
    at or above the room's floor
    "open", "leaky", "withdrawn", a    -> refused, and everything the buyer sent comes back
    window or bounty under the floor,
    or anything Redact cannot answer

So a release with a proven leak can never be sold here, and neither can one
that has not yet survived its report window: "clean" is written by Redact's
certify() alone, after the window, and only when no leak was proven.

The room binds the Redact address its deployer knows independently. The seller
and the price are fixed by the offer, and the offer is the publisher's: the room
asks Redact who published the release and refuses anybody else. Nothing is held
here between calls: every price is paid out in the call that took it.

No model runs here. It is a fixture: small on purpose, and here to be read.
"""

import json
import typing
from dataclasses import dataclass

from genlayer import *


ERROR_EXPECTED = "[EXPECTED]"
GEN = 10 ** 18
MIN_PRICE, MAX_PRICE = GEN // 100, 1000 * GEN
MAX_FLOOR_WINDOW = 30 * 86400              # Redact's longest window: a floor above it could never be met
MAX_FLOOR_BOUNTY = 50 * GEN                # Redact's largest bounty, likewise
PAGE_CAP = 20
ZERO = "0x0000000000000000000000000000000000000000"
HEX = "0123456789abcdef"
DIGITS = "0123456789"

SELLABLE = "clean"                         # the only status Redact writes after a window with no leak
NEVER_SELLABLE = ("leaky", "withdrawn")    # final on Redact: an offer of one of these is refused outright

NOT_YET = {
    "open": "its report window has not been certified yet; it can be bought once anybody has called certify on "
            "Redact after the window and no leak was proven",
    "leaky": "a leak of a private person's details was proven in it on Redact; it is never sold here",
    "withdrawn": "its publisher withdrew it on Redact; it is never sold here",
}


@gl.evm.contract_interface
class _Payee:
    class View:
        pass

    class Write:
        pass


def _fail(message: str) -> typing.NoReturn:
    raise gl.vm.UserError(ERROR_EXPECTED + " " + message)


def _low(address: typing.Any) -> str:
    return (address.as_hex if hasattr(address, "as_hex") else str(address)).lower()


def _is_address(text: typing.Any) -> bool:
    if not isinstance(text, str):
        return False
    s = text.strip().lower()
    return len(s) == 42 and s.startswith("0x") and all(ch in HEX for ch in s[2:]) and s != ZERO


def _is_release_id(text: str) -> bool:
    """Exactly the ids Redact assigns: R, then 1 to 9 ASCII digits with no leading zero.

    `str.isdigit` would also accept a superscript two or Arabic-Indic digits,
    and "R01" is not "R1": Redact never assigns such an id, so an offer of one
    could never be bought.
    """
    digits = text[1:]
    return (2 <= len(text) <= 10 and text[0] == "R" and digits[0] != "0"
            and all(ch in DIGITS for ch in digits))


def _whole(raw: typing.Any) -> int:
    """A non-negative whole number from an int or a string of ASCII digits, or -1. Never raises."""
    if isinstance(raw, bool):
        return -1
    if isinstance(raw, int):
        return raw if raw >= 0 else -1
    if isinstance(raw, str):
        s = raw.strip()
        if s and len(s) <= 40 and all(ch in DIGITS for ch in s):
            return int(s)
    return -1


def _no_float(raw: str) -> typing.NoReturn:
    """The json.loads hook: a fraction, NaN or Infinity in Redact's answer is refused, never built."""
    raise ValueError("no fractions: " + str(raw)[:20])


@allow_storage
@dataclass
class Offer:
    release: str
    seller: Address
    price: u256
    sales: u32
    earned: u256
    number: u32


@allow_storage
@dataclass
class Sale:
    release: str
    buyer: Address
    seller: Address
    price: u256


class ReadingRoom(gl.Contract):
    redact: Address
    min_window: u32                     # the least report window, in seconds, of a release sold here
    min_bounty: u256                    # the least bounty per proven leak, in atto, of a release sold here
    offer_rows: TreeMap[str, Offer]     # "R2"           -> the publisher's offer of R2
    order_rows: TreeMap[str, str]       # "3"            -> "R2", the third release offered here
    sale_rows: TreeMap[str, Sale]       # "R2:<address>" -> that address bought R2
    offer_count: u32
    sale_count: u32
    refusal_count: u32
    paid_total: u256

    def __init__(self, redact: str, min_window_seconds: int, min_bounty_atto: str) -> None:
        if not _is_address(redact):
            _fail("the Redact contract is a 0x address of 40 hex digits")
        window = _whole(min_window_seconds)
        bounty = _whole(min_bounty_atto)
        if not (0 <= window <= MAX_FLOOR_WINDOW):
            _fail("the least report window is 0 to " + str(MAX_FLOOR_WINDOW) + " seconds, written as a whole number")
        if not (0 <= bounty <= MAX_FLOOR_BOUNTY):
            _fail("the least bounty is 0 to " + str(MAX_FLOOR_BOUNTY) + " atto, written in digits")
        self.redact = Address(redact.strip())
        self.min_window = u32(window)
        self.min_bounty = u256(bounty)
        self.offer_count = u32(0)
        self.sale_count = u32(0)
        self.refusal_count = u32(0)
        self.paid_total = u256(0)

    @gl.public.write
    def offer(self, release: str, price_atto: str) -> str:
        """The publisher of a release on Redact offers it here, or changes its price. Only that publisher.

        Not payable, so a refusal raises. A release Redact has already marked
        leaky or withdrawn is refused, and so is one published with a window or
        a bounty under this room's floor: none of them could ever be bought.
        """
        rid = release.strip() if isinstance(release, str) else ""
        if not _is_release_id(rid):
            _fail("a release id is R followed by digits, as Redact assigns it")
        price = _whole(price_atto)
        if not (MIN_PRICE <= price <= MAX_PRICE):
            _fail("the price is " + str(MIN_PRICE) + " to " + str(MAX_PRICE) + " atto (0.01 to 1000 GEN), in digits")
        seen = self._seen(rid)
        if not seen or "error" in seen:
            _fail("Redact has no release " + rid)
        if _low(gl.message.sender_address) != str(seen.get("publisher", "")).lower():
            _fail("only the publisher of " + rid + " on Redact may offer it")
        status = str(seen.get("status", ""))
        if status in NEVER_SELLABLE:
            _fail(rid + " is " + status + " on Redact: " + NOT_YET[status])
        under = self._under_floor(rid, seen)
        if under:
            _fail(under)
        if rid in self.offer_rows:
            o = self.offer_rows[rid]
            o.price = u256(price)
        else:
            self.offer_count = u32(int(self.offer_count) + 1)
            self.offer_rows[rid] = Offer(release=rid, seller=gl.message.sender_address, price=u256(price),
                                         sales=u32(0), earned=u256(0), number=u32(int(self.offer_count)))
            self.order_rows[str(int(self.offer_count))] = rid
        return json.dumps({"ok": True, "release": rid, "price": str(price), "status_on_redact": status})

    @gl.public.write.payable
    def buy(self, release: str) -> str:
        """Pay exactly the price and hold the licence. Anyone; refused, with a refund, unless Redact says clean.

        Never raises after taking value. Redact is asked here, in this call,
        what the release's status, window and bounty are; only "clean" at or
        above the room's floor sells, and the price goes to the publisher in the
        same call, so the room never holds money.
        """
        value = int(gl.message.value)
        sender = gl.message.sender_address
        rid = release.strip() if isinstance(release, str) else ""
        o = self.offer_rows[rid] if rid in self.offer_rows else None
        problem = ""
        if not _is_release_id(rid):
            problem = "a release id is R followed by digits, as Redact assigns it"
        elif o is None:
            problem = rid + " is not offered here"
        elif (rid + ":" + _low(sender)) in self.sale_rows:
            problem = "this address already holds " + rid
        elif value != int(o.price):
            problem = ("send exactly the price of " + rid + ", " + str(int(o.price)) + " atto; this call sent "
                       + str(value))
        else:
            seen = self._seen(rid)
            status = str(seen.get("status", ""))
            if not seen or "error" in seen:
                problem = "Redact could not answer for " + rid + "; nothing was sold"
            elif str(seen.get("publisher", "")).lower() != _low(o.seller):
                problem = "Redact names another publisher for " + rid + " than the one who offered it here"
            elif self._under_floor(rid, seen):
                problem = self._under_floor(rid, seen)
            elif status != SELLABLE:
                problem = (rid + " is " + (status or "unknown")[:16] + " on Redact, not clean: "
                           + NOT_YET.get(status, "only a release certified clean is sold here"))
        if problem:
            return self._refuse(sender, value, problem)
        self.sale_rows[rid + ":" + _low(sender)] = Sale(release=rid, buyer=sender, seller=o.seller,
                                                        price=u256(value))
        o.sales = u32(int(o.sales) + 1)
        o.earned = u256(int(o.earned) + value)
        self.sale_count = u32(int(self.sale_count) + 1)
        self.paid_total = u256(int(self.paid_total) + value)
        # The money moves after everything above is written.
        _Payee(o.seller).emit_transfer(value=u256(value))
        return json.dumps({"ok": True, "release": rid, "price": str(value), "paid_to": _low(o.seller),
                           "status_on_redact": SELLABLE})

    # ----------------------------------------------------------------- views

    @gl.public.view
    def listing(self, release_id: str) -> str:
        rid = release_id.strip() if isinstance(release_id, str) else ""
        if rid not in self.offer_rows:
            return json.dumps({"error": rid[:12] + " is not offered here"})
        o = self.offer_rows[rid]
        return json.dumps({"release": rid, "seller": _low(o.seller), "price": str(int(o.price)),
                           "sales": int(o.sales), "earned": str(int(o.earned))})

    @gl.public.view
    def holding(self, release_id: str, who: str) -> str:
        """Whether one address holds the licence to one release: what a consumer of this room checks."""
        rid = release_id.strip() if isinstance(release_id, str) else ""
        addr = who.strip().lower() if isinstance(who, str) else ""
        key = rid + ":" + addr
        if key not in self.sale_rows:
            return json.dumps({"release": rid[:12], "who": addr[:42], "holds": False})
        s = self.sale_rows[key]
        return json.dumps({"release": rid, "who": addr, "holds": True, "price": str(int(s.price)),
                           "seller": _low(s.seller)})

    @gl.public.view
    def listings(self, offset: int, limit: int) -> str:
        """One page of offers, oldest first. `limit` is at most 20, so a reply always has a size."""
        n = int(self.offer_count)
        start = max(_whole(offset), 0)
        size = min(max(_whole(limit), 1), PAGE_CAP)
        count = min(max(n - start, 0), size, PAGE_CAP)
        rows = []
        for i in range(count):
            o = self.offer_rows[str(self.order_rows[str(start + 1 + i)])]
            rows.append({"release": str(o.release), "price": str(int(o.price)), "sales": int(o.sales)})
        return json.dumps({"total": n, "offset": start, "limit": size, "rows": rows})

    @gl.public.view
    def room(self) -> str:
        return json.dumps({"redact": _low(self.redact), "offers": int(self.offer_count),
                           "sales": int(self.sale_count), "refused": int(self.refusal_count),
                           "paid_total": str(int(self.paid_total)), "sells_only": SELLABLE,
                           "min_window_seconds": int(self.min_window), "min_bounty_atto": str(int(self.min_bounty)),
                           "price_atto": [str(MIN_PRICE), str(MAX_PRICE)]})

    # --------------------------------------------------------------- helpers

    def _seen(self, rid: str) -> typing.Dict[str, typing.Any]:
        """Redact's own view of one release, read now, or {} when it cannot be read. Never raises."""
        try:
            seen = json.loads(str(gl.get_contract_at(self.redact).view().release(rid)),
                              parse_float=_no_float, parse_constant=_no_float)
        except Exception:
            return {}
        return seen if isinstance(seen, dict) else {}

    def _under_floor(self, rid: str, seen: typing.Dict[str, typing.Any]) -> str:
        """Why a release's certificate is weaker than this room accepts, or "". Never raises.

        Redact's release view carries the window and the bounty the release was
        published with; an answer that does not carry them reads as -1, under
        any floor.
        """
        window = _whole(seen.get("window", ""))
        bounty = _whole(seen.get("bounty", ""))
        if window < int(self.min_window) or bounty < int(self.min_bounty):
            return (rid + " was published with a report window of " + str(window) + " s and a bounty of "
                    + str(bounty) + " atto; this room sells only releases with at least "
                    + str(int(self.min_window)) + " s and " + str(int(self.min_bounty)) + " atto")
        return ""

    def _refuse(self, sender: typing.Any, value: int, reason: str) -> str:
        """Return everything that was sent and say why. Never raises."""
        self.refusal_count = u32(int(self.refusal_count) + 1)
        if value > 0:
            _Payee(sender).emit_transfer(value=u256(value))
        return json.dumps({"ok": False, "reason": reason, "returned": str(value)})
