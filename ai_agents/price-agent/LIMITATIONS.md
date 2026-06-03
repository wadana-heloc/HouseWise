# Price Agent — Known Limitations

This document is for the product owner and backend team to read before deciding how to integrate or rely on this agent.

---

## 1. Results are non-deterministic

Running the same query twice will often produce different results. The agent uses web search, and search results change between calls — different aggregator pages surface, Google ranks results differently, and the model chooses different search queries each run.

**What this means in practice:**
- Carrefour may return a price one run and null the next
- The cheapest store may flip between runs even if no real price change happened
- You cannot diff two raw outputs and treat the difference as a real price change

**Implication:** Do not call this agent live on every user request. Cache results in a database with a TTL and re-run on a schedule.

---

## 2. JavaScript-rendered store pages are unreliable

Most UAE supermarket sites (Spinneys, Carrefour, Union Coop) render prices via JavaScript. Web search snippets do not execute JavaScript, so prices do not appear in snippets. The model can only get a confirmed price when:

- An aggregator site (promotions.ae, kanbkam.com, wowdeals.me) has that item cached, **or**
- The model fetches the product page directly and the page is not bot-blocked

If neither condition holds, the store returns null — even if the item is definitely sold there.

**This is the primary cause of null prices.** A null does not mean the store does not carry the item.

---

## 3. Aggregator sites are the main data source

The agent's search strategy prioritises aggregator sites because they cache store prices and are rarely bot-blocked. This has two downsides:

- **Aggregator data can be stale** — prices on promotions.ae or kanbkam.com may be hours or days old. A price returned by the agent is not guaranteed to be the current shelf price.
- **Aggregator coverage is incomplete** — not every item at every store is indexed by aggregators. Niche or fresh items will have poor coverage.

---

## 4. Promotions and sales are found but not flagged

The agent routes searches through promotion aggregators and will pick up promotional prices when they appear. However, there is no field in the output to indicate whether a price is a regular price or a temporary promotion. The backend and UI cannot distinguish "normal price" from "on sale this week."

If this distinction matters to the product, the output schema needs a `is_promotional: bool` field and the prompt needs to instruct the model to flag it.

---

## 5. The `stores` parameter is partially cosmetic

The system prompt hardcodes the four supported store URLs and their search strategy. Passing different URLs in the `stores` parameter changes what appears in the user prompt, but the model's search behaviour is still governed by the hardcoded system prompt. In practice this means:

- You cannot add a fifth store by just passing its URL — the model will not know how to search it
- The canonical URLs to pass are defined in `price_config.STORE_URLS` — do not invent variants

---

## 6. Unit price calculation is model-computed

The model calculates `unit_price` based on the product name and size it finds. If the product name is ambiguous (e.g. "Rice 5kg" vs "Rice Value Pack") the model may get the size wrong and produce an incorrect unit price.

The raw `price` field is always trustworthy (it was read directly from a source). `unit_price` is derived and should be treated as approximate.

---

## 7. Size selection is non-deterministic

The system prompt instructs the model to pick the largest pack with a confirmed price. In practice, if a store sells the same item in three sizes and only one has a confirmed aggregator price, the model picks that one — which may not be the largest. Sizes are not normalised across stores, so comparing unit prices for different pack sizes is still meaningful, but pack selection is not guaranteed to be optimal.

---

## 8. Cost and latency

Each call to `search_grocery_prices` makes one or more Anthropic API calls with the web search tool enabled. Web search calls are billed per search and are slower than standard completions.

- **Latency:** expect 15–45 seconds per batch of 15 items depending on how many searches the model performs
- **Cost:** each batch call runs roughly 5–15 web searches. At current pricing this costs meaningful money at scale
- **Batch size:** 15 items per API call — a 30-item shopping list makes 2 API calls

This agent is not suitable for real-time, per-request use. It should run as a scheduled background job.

---

## 9. No error is raised to the caller on failure

If the model returns unparseable output, the agent silently returns null-filled results instead of raising an exception. The backend has no way to distinguish "agent ran fine and found no prices" from "agent failed silently."

**How to detect a silent failure:** check `store_name` — in a null-fallback result it equals the raw `store_url`. In a successful result it is always a short human name like `"Spinneys"`. If all `store_name` values equal their `store_url`, the response is a fallback, not a real search result.

---

## Summary table

| Limitation | Severity | Workaround |
|---|---|---|
| Non-deterministic results | High | Cache results in DB, re-run on schedule |
| JS-rendered pages return null | High | Accept nulls as "not found this run", not "not sold" |
| Stale aggregator data | Medium | Store a `fetched_at` timestamp alongside results |
| Promotions not flagged | Medium | Extend schema if distinction is needed |
| `stores` parameter is partially cosmetic | Medium | Always use `STORE_URLS` from `price_config` |
| Unit price is model-derived | Low | Use raw `price` for billing, `unit_price` for comparison only |
| Size selection not guaranteed optimal | Low | Accept as best-effort |
| High latency and cost | High | Background job only — never call live |
| Silent null fallback on parse failure | Medium | Check `store_name == store_url` to detect fallback |
