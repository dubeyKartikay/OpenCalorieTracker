# OpenCalorieTracker — product scope

Status: proposed scope for approval, not an implementation commitment.

Research checked: 16 November 2026.

Evidence and limitations: [MARKET_RESEARCH.md](./MARKET_RESEARCH.md).

## 1. Product definition

An open-source, cross-platform nutrition tracker that makes everyday food logging fast without hiding how its numbers were obtained. Users can connect an eligible ChatGPT account to power AI features with their existing plan, where OpenAI permits the integration.

**Product promise:** describe, photograph, scan, or repeat a meal; inspect and correct the result; keep a trustworthy, portable record on every device.

AI is an input and analysis layer, not the nutrition database, calculator, or source of truth. The product must remain a useful tracker when AI is disconnected, unavailable, or out of allowance.

### Initial audience

1. Adults who have abandoned trackers because logging takes too long.
2. Existing trackers switching because of paywalls, clutter, weak data portability, or missing device support.
3. People who cook at home and repeatedly eat similar meals, including regional/mixed dishes.
4. Eligible ChatGPT subscribers who want to use the plan they already pay for.

Primary launch workflow: an individual logs everyday meals and reviews calorie, protein, and weight trends. Household collaboration is the first expansion, not a prerequisite for the first usable alpha.

Not initially a clinical nutrition product, children's dieting product, workout platform, social network, or grocery marketplace.

## 2. Critical dependency: Sign in with ChatGPT

The feature is real, but availability is not equivalent to unrestricted API access. See research sources O1–O5.

### What is verified

- Identity sign-in and permission to consume ChatGPT plan usage are separate capabilities.
- Eligible requests consume the user's allowance and, if separately authorized in ChatGPT, applicable credits. This is not unlimited or necessarily free additional inference.
- Sign-in does not provide access to ChatGPT conversations or memories.
- Public developer documentation supports open-source/local integrations. Paid or remotely hosted products must request access; being open source alone does not establish permission for every hosted deployment.
- The documented plan-usage route supports text and images when supported by the selected model. It does **not** support audio/video input or the transcription API.
- The consumer help page lists Go, Plus, Pro, and Business for participating commercial apps; developer quickstart/cookbook text still refers to Plus and Pro. Eligibility must be checked against the actual integration and account, not hard-coded from one page.

### Scope consequences

1. Offer **Continue with ChatGPT**, explicit plan-usage consent, connection status, reconnect/disconnect controls, and a link to ChatGPT's usage settings.
2. Keep the app's diary/sync account separate from the AI connection. Disconnecting AI must not delete the diary or block manual logging.
3. Secure OAuth credentials in platform-protected storage. Do not request ChatGPT passwords, scrape browser sessions, or reuse unofficial credential flows.
4. Discover supported models/capabilities. Validate image input, structured results/tool calls, limits, token renewal, and revocation in a real prototype.
5. Implement voice entry initially as platform dictation into text, where available. Do not promise ChatGPT-plan-funded speech transcription. Any separate transcription service requires its own consent and cost model.
6. Do not silently switch an exhausted allowance to developer-paid inference, another provider, or paid credits.
7. Validate native mobile callbacks and browser deployment independently. The desktop/local example does not establish mobile or hosted-web readiness.

**Release gate:** demonstrate an authorized end-to-end text and image meal workflow on each intended deployment path before advertising subscription-funded AI there. If hosted access is not approved, keep the hosted tracker usable without that AI path and label the limitation clearly. Do not call this complete delivery of the original AI vision until the gate is resolved.

## 3. Must-have feature scope

Priority meanings:

- **A:** first end-to-end private alpha.
- **V1:** required before the full supported-platform product is called version 1.
- **Next:** deliberately after V1; not secretly part of the MVP.

### 3.1 Onboarding and goals — A

- Optional local-first use; no ChatGPT connection required to try manual tracking.
- Lose, maintain, gain, or simply observe; manually editable calorie and macro targets.
- If estimating a target, explain the equation, inputs, assumptions, and activity setting. Do not infer physiology from gender identity.
- Metric/imperial weight and height, kcal/kJ, locale-aware dates and decimal formats.
- Preferences for dietary style and foods to avoid, without claiming automatic allergen safety.
- Neutral language; reminders opt-in; no punitive messaging for missed days or exceeding a target.

### 3.2 Daily diary and dashboard — A

- Today and historical diary; configurable meal sections, timestamps, and date assignment.
- Calories, protein, carbohydrate, fat, and fiber totals; simple consumed/target/remaining display.
- Add, edit, delete, undo, move between meals/days, and distinguish drafts from confirmed entries.
- Recent foods, favorites, saved meals, copy yesterday, and multi-select logging.
- Quick-add calories and optional macros for cases where full detail is unavailable.
- Mark a day complete or partially logged. An unlogged day must not be interpreted as zero intake.
- Basic water logging is low-cost convenience, not a central differentiator.

### 3.3 Food search, units, and barcode workflow — A

- Search generic foods and branded products; show provenance and serving basis.
- Barcode scan on supported cameras, plus manual barcode entry and photo/file fallback.
- Editable portions in grams, ounces, milliliters, and food-specific household servings.
- Explicit raw/cooked distinction and per-serving versus per-100-g normalization.
- Never convert volume to mass using a universal density.
- Missing barcode → scan/read label or create custom food → review → save for reuse.
- Local corrections must not require submitting data to a public database.
- Cached foods and custom foods remain usable offline; unknown products need network lookup or manual entry.

### 3.4 AI meal capture — A for text; V1 for photos and supported dictation

- Natural-language meal entry, including several foods in one message.
- Photo plus optional description; nutrition-label capture with reviewed OCR/vision output.
- Dictation into the same input where the OS/browser supports it.
- Ingredient-level result cards with matched foods, portion assumptions, and nutrition sources.
- Clarify important unknowns such as cooking fat, raw/cooked state, or shared portion size; avoid interrogating the user about negligible details.
- Allow structured editing and conversational corrections: “half the rice,” “no butter,” or “this was cooked weight.”
- Explicit confirmation before new or destructive diary changes; undo after commit.
- Save a corrected result as a personal meal/recipe when requested.

**Critical distinction:** showing ingredients and editable AI results already exists in MacroFactor. Our opportunity is execution, uncertainty handling, reusable corrections, and cross-platform continuity—not inventing editable AI logging.

### 3.5 Trustworthy calculation and uncertainty — A

- Calculate nutrients deterministically from selected food records and amounts.
- Label each component as database-backed, label-transcribed, user-entered, or AI-estimated.
- Separate certainty about food identity from certainty about portion size.
- Do not fabricate gram measurements from a photograph or display invented confidence percentages.
- When ambiguity matters, show explicit assumptions and an editable portion range. Initially call this an **estimate range**, not a statistically calibrated confidence interval.
- If no credible match exists, offer a clearly marked estimate or manual entry rather than inventing a verified database food.
- Store a nutrition snapshot and source/version with each confirmed entry; future database or recipe edits must not silently rewrite history.
- Missing micronutrients are unknown, not zero. Partial micronutrient coverage must remain visible.
- Preserve source energy values; do not force every label to equal protein × 4 + carbs × 4 + fat × 9, because fiber, alcohol, sugar alcohols, and rounding differ.

### 3.6 Recipes and repeated home cooking — A basic; V1 batch workflow

- Custom foods, recipes, and reusable meal templates.
- Ingredients, quantities, total yield, cooked weight, and portions by grams or fraction.
- Separate a reusable recipe from an individual cooked batch with a different ingredient amount or final weight.
- Example: 2,400 kcal in a 1,600-g cooked batch → a 300-g serving contains 450 kcal, before ingredient-data uncertainty.
- Preserve prior logged portions if the recipe changes.
- Support personal serving equivalents such as “my bowl” only after the user defines their amount or recipe fraction.
- V1: paste recipe text and import a recipe URL with ingredient matching and review. Web extraction failure must have a manual fallback.
- Public recipe sharing is optional; do not expose personal recipe notes by default.

### 3.7 Progress and insights — A basic; V1 richer review

- Manual weight entry and an explained smoothed trend rather than treating every daily fluctuation as fat change.
- Daily and weekly calorie/macro averages, with incomplete-day handling.
- Goal history; manual target changes should be visible rather than retrospectively applied to old days.
- V1: constrained AI questions over explicitly selected diary data, e.g. “Which of my usual breakfasts gives me the most protein?”
- Every numerical answer must be computed from the diary and link back to its records/date range. No unsupported causal claims or autonomous diet changes.
- Show common extra nutrients when source data exists, initially sodium, sugars, saturated fat, calcium, iron, and potassium; comprehensive nutrient analysis is not a V1 promise.

### 3.8 Device health integrations — V1

- Apple Health on supported Apple platforms; Health Connect on supported Android devices.
- Start with body weight and supported nutrition records; optional activity/steps import.
- Permission per data type and clear direction of sync.
- Source identifiers, deduplication, deletion handling, and protection against write/read loops.
- Display exercise calories separately; do not automatically add them back without an explicit setting and explanation.
- Web/desktop should show synced records, not pretend to access native health APIs directly.
- Direct Garmin, Fitbit, Oura, Whoop, Samsung Health, and scale-cloud integrations are Next unless health-platform coverage proves inadequate for the initial audience.

### 3.9 Offline, sync, backup, and ownership — A local; V1 cross-device

- Diary reads/writes, repeat meals, custom recipes, and cached lookups work offline.
- Network-required actions show their state; photo drafts may queue for explicit later AI analysis.
- V1: optional account-based cross-device sync for diary, goals, food library, recipe versions, and preferences.
- Durable local writes, idempotent retries, explicit conflict handling, and no silent loss of simultaneous edits.
- Full-fidelity, versioned JSON export and re-import; usable CSV exports for diary and trends. Own-format export must include recipes, custom foods, weight, water, goals, and relevant attachments—not just totals.
- Export without a subscription; documented deletion, backup retention, and account recovery.
- V1: one real competitor importer, chosen from sample user exports. Preview supported fields, date/unit mappings, duplicates, and unsupported records. Never promise recovery of fields the source export omits.
- Preserve imported original values; any AI-assisted food remapping creates a separate proposed version, never a silent historical “cleanup.”

### 3.10 Privacy, accessibility, and reliability — A foundations; V1 audited coverage

- No advertising SDKs, sale of dietary data, or mandatory analytics.
- Explicit disclosure of what goes to OpenAI, sync services, database providers, dictation providers, and optional diagnostics.
- Minimize inference context; do not upload the entire diary for a single meal photo.
- Camera/microphone/photo permissions only when needed; sensible image retention and deletion controls.
- Platform-protected credentials, encrypted transport, protected local data, and encrypted server storage. End-to-end encrypted sync is a separate design/feasibility decision, not a claim implied by “encrypted.”
- Core flows work with screen readers, keyboard navigation, large text, and non-color status cues; target WCAG 2.2 AA for web.
- Data/schema migrations, restore tests, crash recovery, and privacy-safe diagnostics.
- Applicable store health-data policies, privacy obligations, and account-deletion requirements checked before public distribution.

## 4. Differentiators worth pursuing

These are underserved-workflow hypotheses, not claims that no competitor has any equivalent.

### D1. Honest estimates and remembered corrections — V1

Combine database provenance, explicit assumptions, editable ranges, and user-controlled reusable recipes. “Remember my homemade dal recipe” should create a visible personal rule/template, not an opaque assertion that the model learns everything forever. New corrections should not change old logs automatically.

Evidence: photo skepticism, hidden-oil complaints, and existing ingredient-level competitors. Demand confidence: medium; the specific range-and-memory interface needs testing.

### D2. Household batch cooking — Next, first expansion

One cooking event, per-person portions, leftovers, batch versions, and independent private diaries. Share a proposed meal with another adult, who can accept and adjust it. Recipients do not expose their full diaries or share credentials. No assumption that one ChatGPT subscription covers every household member's inference.

Evidence: explicit shared-meal and cooked-weight requests. Basic recipe sharing already exists in Cronometer and MacroFactor; Cal AI also advertises a family plan. The proposed improvement is the complete batch-to-portions workflow, not a family billing toggle.

### D3. Migration without losing years of history — V1 basic; Next advanced

Import original records faithfully, show what could not be imported, and optionally propose better food matches without overwriting the original. Make export/restore equally good.

Evidence: repeated import requests and an explicit request for food-match cleanup. This is an acquisition feature as much as a data feature.

### D4. First-class large-screen and mixed-device use — V1

Log on the phone, edit the recipe on a laptop, and review on a tablet without a second-class interface. Keyboard-friendly batch editing and usable Linux/Windows experiences are part of the promise.

Evidence: repeated desktop/web requests; Cronometer already supplies web and Foodnoms supplies native iPad/Mac. The gap is the combination with the rest of this product, not “the first desktop calorie tracker.”

### D5. Regional homemade food that becomes personal — V1 foundations; Next expansion

Aliases/transliterations, explicit cooking oil, recipe variants, and user-defined household portions. Choose launch markets before claiming broad database coverage. Indian foods are a useful validation segment, not an assumption about the entire target market; Healthify and other regional apps already compete here.

## 5. Platform contract

All requested platform families remain in product scope. Rollout is staged to validate integrations rather than pretend one successful build proves support everywhere.

| Target | V1 support contract |
| --- | --- |
| Android phones | Touch-first app, camera/barcode, offline diary, supported Health Connect integration |
| Android folding phones | Cover and expanded layouts; preserve unsaved logging state while folding/unfolding; hinge-aware placement where APIs permit |
| Android tablets | Real two-pane layout, rotation, resizing, split-screen, hardware keyboard |
| iPhone | Touch-first app, camera/barcode, offline diary, supported Apple Health integration |
| “iPhone duo” | Provisional name for the intended dual-screen/foldable Apple form factor. Clarify exact hardware/OS; do not invent a separate SDK or promise untested device compatibility |
| iPad | Two-pane layout, multitasking/resizing, keyboard and pointer support |
| Windows | Installable desktop experience, offline diary, keyboard/bulk entry, file import/export; camera optional with file/manual fallback |
| Linux | Installable desktop experience with explicitly tested distributions/package formats; same core diary and import/export |
| macOS | Installable desktop experience, window resizing, keyboard/pointer, protected credential storage |
| Web | Responsive app on a declared browser matrix; desktop and mobile layouts; offline behavior subject to browser storage constraints; hosted AI subject to approval |

“Supported” means tested core journeys, upgrade behavior, accessibility, authentication return flows, and data recovery—not merely compiling. Exact minimum OS/browser versions and Linux distributions are decided after a capability spike. No framework is selected by this scope document.

Core parity: diary, goals, recipes, AI review where authorized, insights, sync, export. Native-only permissions and hardware integrations may differ and must be documented.

## 6. Release boundaries

### Phase 0 — feasibility and evidence

- Prove permitted ChatGPT text/image inference; reconcile applicable plan eligibility and hosted-app access.
- Spike mobile OAuth, browser architecture, secure storage, and requested-device capability support.
- Choose initial countries/languages; measure barcode and generic-food coverage using real shopping/meal samples.
- Review dataset licensing, API quotas, and sustainable hosting costs.
- Obtain representative competitor exports and test what can actually be migrated.
- Test logging prototypes with adult users; revisit assumptions before selecting the final framework.

### Phase 1 — private alpha: complete individual tracking loop

Use Android phone plus Windows/local AI as initial reference environments, with responsive web for manual tracking. This is a suggested validation order, not removal of Apple/Linux platforms.

Ship A features: goals → search/scan/text AI → editable review → diary → repeat meal/basic recipe → weekly review → export/restore. Offline manual use must work. Add photo capture early enough to measure its value, even though complete platform coverage waits for V1.

### Phase 2 — full V1: reliable cross-platform tracker

Ship the complete platform contract, cross-device sync, authorized photo AI, supported dictation, batch-aware recipes, one competitor import path, health integrations, accessibility, and grounded weekly insights. Launch AI claims only on deployment paths that passed Phase 0's gate.

### Phase 3 — differentiated expansion

Household batch/leftovers workflow; improved migration/remapping; regional food packs and more languages; configurable tracking-day boundary for shift workers; widgets/shortcuts/share-sheet capture; advanced nutrition reports; optional explainable adaptive energy targets.

Adaptive targets require sufficient, plausibly complete intake and weight history, an explanation of uncertainty, and user approval. They are not an LLM guessing a new calorie target every day.

### Explicitly out of V1

- Human coaching marketplace, clinician portal, insurance workflows, disease treatment, medication/dose advice.
- Automatic deficit prescriptions for minors, pregnancy, or clinical conditions.
- Public feed, challenges, leaderboards, calorie-burn competitions, and coercive streak mechanics.
- Full workout programming, wearable apps, fasting programs, continuous glucose monitoring, menstrual tracking.
- Grocery delivery, pantry inventory, shopping optimization, full weekly meal-plan generation.
- Universal restaurant coverage, every country's branded catalogue, or guaranteed photo-calorie accuracy.
- Automatic gallery scanning or background diary writes without explicit user action.
- Multiple AI providers, local models, BYO API-key onboarding, and self-hosted sync deployment support unless the primary integration becomes infeasible and scope is explicitly revised.

## 7. Data-source scope and economics

Initial candidates: USDA FoodData Central for generic/reference foods and Open Food Facts for branded/barcode data, augmented with personal foods and recipes.

- USDA publishes CC0 data; its API requires a protected key and has quotas. Consider ingestion/caching rather than shipping a private key in every client.
- Open Food Facts has ODbL attribution/share-alike considerations and separate image licensing; database separation and combined-database use need review before architecture is fixed.
- Open Food Facts explicitly does not guarantee completeness/accuracy. An open database entry is not automatically “verified.”
- Search must respect provider limits; do not call rate-limited public APIs on every keystroke without an appropriate cache/search architecture.
- Regional/reference datasets require their own license and coverage checks. Do not copy a competitor's proprietary catalogue.

An existing ChatGPT plan pays for eligible inference, not sync, food-data licensing, storage, app-store operations, support, or all future AI capabilities. Recommended commercial hypothesis: keep core manual logging, barcode access, and own-data export free; evaluate optional paid sync/convenience later. Pricing remains a decision, not an approved business model.

## 8. Acceptance criteria and success measures

These are proposed engineering/product targets, not externally observed benchmarks.

### Correctness and resilience gates

- Automated cases for serving conversions, raw/cooked states, recipe yields, missing nutrients, label rounding, time zones/DST, day completeness, and duplicate health records.
- Every confirmed nutrition number has a traceable source/type and reproducible calculation.
- No old entry changes when a food/recipe is edited unless the user explicitly approves a scoped update.
- Own-format export/import round-trip preserves all documented fields; unsupported external-import fields are reported.
- Offline write → restart → reconnect → second device produces no lost or duplicated confirmed entries in the tested conflict scenarios.
- AI timeout, refusal, malformed output, token expiry, revocation, and quota exhaustion never corrupt the diary or block manual entry.
- Auth/model tests use the real authorized integration, not a mocked “connected” badge.

### Usability targets to validate

- Typical saved-meal logging: median under 10 seconds after onboarding.
- Typical text/photo meal review: median under 30 seconds, including user corrections; report model latency separately.
- Compare against users' current apps with the same meals; prioritize fewer corrections and completed logs, not just a quick first AI answer.
- Measure first-confirmed-meal activation, week-1/week-4 return, correction effort, missed-log reasons, and restored-data success with consent. Do not collect sensitive raw meals merely for analytics.
- Build a consented test set across cuisines, lighting, mixed dishes, and portion ambiguity. Publish measured error distributions before making any accuracy claim; no target “95% accurate” without a defined measurement.

## 9. Decisions still needed

Recommended starting defaults are shown so research can proceed without blocking on a questionnaire.

1. **Distribution:** open-source local clients first; request hosted/commercial AI access in parallel.
2. **Launch countries and languages:** select one or two markets to validate deeply; English UI initially, with localization-ready design.
3. **Privacy model:** local-first, optional sync; choose whether V1 sync must be end-to-end encrypted before architecture selection.
4. **Business model:** free core, no ads/data sales; no final pricing yet.
5. **Hardware:** clarify “iPhone duo” and set minimum OS/browser/Linux support after prototyping.

## Recommended scope statement

Build the dependable individual tracker first: fast manual and AI-assisted logging, transparent nutrition, repeatable home recipes, offline use, data ownership, and a genuinely adaptive interface across every requested platform. Differentiate through honest estimates and continuity; expand next into household batch cooking and better migration. Treat authorized ChatGPT-plan access as a release dependency to prove, not a marketing assumption.
