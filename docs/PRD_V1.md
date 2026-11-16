# OpenCalorieTracker — V1 product scope and requirements

Status: draft for approval, not an implementation commitment. Last updated 16 November 2026.

This is the single product document for V1. It merges the earlier scope draft (`PRODUCT_SCOPE.md`, in git history at commit `144bab7`) with the requirements document that followed it. Section 15 lists what changed from that draft.

Evidence: [MARKET_RESEARCH.md](./MARKET_RESEARCH.md) (first pass) and [MARKET_RESEARCH_ADDENDUM.md](./MARKET_RESEARCH_ADDENDUM.md) (second pass). Source codes such as [A1] refer to the addendum's register.

## 1. Summary

OpenCalorieTracker V1 is an open-source food diary for adults that runs on phone, tablet, desktop and web. A user can log a meal by search, barcode, text or photo, see how each number was obtained, correct it, and keep a portable record that syncs across their devices. Users with an eligible ChatGPT plan can connect it so that their existing subscription pays for the AI features.

**Product promise.** Describe, photograph, scan or repeat a meal; inspect and correct the result; keep a trustworthy, portable record on every device.

**AI's role.** AI is an input and analysis layer. It is not the nutrition database, the calculator or the source of truth, and the product stays a useful tracker when AI is disconnected, unavailable or out of allowance.

**Why now.** MyFitnessPal bought Cal AI in March 2026, paid tiers have moved to roughly $50–100 a year, and barcode scanning is paywalled in the largest app [M1, M4]. An NIH test found four photo-logging apps underestimating meals by about 250–345 kcal on average [A1]. OpenAI now lets open-source apps run AI requests on a user's ChatGPT plan, and another open-source app has shown it working on an iPhone [O1, X1].

**The bet.** A tracker that is fast to log in, honest about estimates, free at its core and available on every device will win users who are leaving paywalled, cluttered incumbents. Research has not shown that no competitor does this; it has shown that no open-source project found does it across phone, desktop and web without self-hosting.

**Scope statement.** Build the dependable individual tracker first: fast manual and AI-assisted logging, transparent nutrition, repeatable home recipes, offline use, data ownership and an interface that adapts to every listed platform. Differentiate through honest estimates, continuity across devices and AI on the user's own ChatGPT plan. Expand next into household batch cooking and better migration.

## 2. Problem and evidence

| Problem | Evidence | Strength |
| --- | --- | --- |
| Logging takes too long, so people stop | Burden and database problems lead reported reasons for quitting; a median of 70% of health-app users stop within 100 days [R1, R4, R6] | Medium; two key papers read only as search summaries |
| Photo estimates look precise and run low | 250–345 kcal average underestimate per meal across four apps; error grows with portion size [A1, A2] | Medium-high; the NIH result is not yet peer reviewed |
| Free tiers shrink and apps change under users | Barcode paywalls; redesign backlash in about 60% of one month's MyFitnessPal reviews [V1] | Medium; competitor-authored analysis |
| Trackers are phone-only or self-hosted | No MacroFactor web or desktop launch appears in its 2026 updates [V3]; open-source options are mobile-only or need a server [G1–G4] | Medium; based on documentation, not hands-on use |
| AI features cost extra | Paid tiers gate AI capture in most incumbents [M4] | Medium; pricing sources conflict |

None of this has been tested with users. Section 12 makes interviews and a weighed-meal test set part of the first milestone.

## 3. Users

V1 serves adults aged 18 and over tracking for themselves. The primary workflow is one person logging everyday meals and reviewing calorie, protein and weight trends.

| Segment | Job to be done | What V1 must get right |
| --- | --- | --- |
| Lapsed logger | "Let me log a normal day without it feeling like data entry" | Repeat meals in a few taps; a second day logged |
| Switcher | "Let me leave my current app without losing my history or paying for a scanner" | Free barcode scanning; import; stable features |
| Home cook | "Count my actual dal, not a generic one" | Recipes with cooked yield; saved corrections; household units |
| Desk and multi-device user | "Log on my phone, fix the recipe on my laptop" | Sync; keyboard-first desktop and web layouts |
| ChatGPT subscriber | "Use the plan I already pay for" | Clear connection status and limits; no surprise charges |

Not served in V1: minors, clinical nutrition, coaching, households sharing one diary. The product is not a children's dieting product, a workout platform, a social network or a grocery marketplace.

## 4. Goals, non-goals and principles

### Goals

1. A new user confirms a first meal in the first session and logs again the next day.
2. Every confirmed number traces to a source and a calculation.
3. The same diary is usable on every listed platform, with no data loss across devices.
4. AI capture works wherever a permitted, verified inference path exists, and its absence never blocks logging.
5. A user can leave with all their data at any time, at no cost.

### Non-goals

- Claiming photo-calorie accuracy before the project has measured its own.
- Matching Cronometer's micronutrient depth or MacroFactor's adaptive coaching.
- Household meal sharing, which is the first expansion after V1.
- Revenue. V1 has no paid tier.

### Principles

1. **Manual first.** Each AI feature has a manual route that reaches the same result.
2. **The database computes; the model proposes.** The model identifies foods and suggests portions. Calories and nutrients come from food records and arithmetic.
3. **Assumptions are visible.** An estimate shows what was assumed and what would change it.
4. **History is immutable by default.** Later edits to foods, recipes or goals do not rewrite past entries.
5. **No dark patterns.** No ads, punitive streaks, surprise paywalls or forced redesigns of core flows.

## 5. Differentiators

These are underserved-workflow hypotheses, not claims that no competitor has an equivalent. Photo logging, voice or text entry, free barcode scanning, editable AI results, recipes, privacy, open source and desktop access all exist elsewhere and should not be marketed as unique.

| Differentiator | What V1 ships | Evidence and caveat | After V1 |
| --- | --- | --- | --- |
| AI on the user's own ChatGPT plan | "Continue with ChatGPT" on phones and desktop, with no API key and no extra subscription (section 7) | Incumbents charge for AI. Other open-source health apps added this from October 2026; no calorie tracker found leads with it. Eligibility and limits are OpenAI's, and the programme is a preview [X1, X2, T1] | Web, if OpenAI approves |
| Honest estimates and remembered corrections | Source labels, visible assumptions, estimate ranges, a cooking-fat question, and saved corrections that are offered again with a prompt | Photo apps run low, mostly on fat [A1]. MacroFactor already shows editable ingredient-level results, so the gain is in execution. The range interface is untested with users | Calibrated uncertainty, once measured |
| First-class large-screen and mixed-device use | Two-pane layouts, keyboard entry, sync, and installable apps on Windows, macOS and Linux | Repeated requests for desk access. Cronometer has web and Foodnoms has native iPad and Mac, so the gap is the combination | — |
| Migration without losing history | One importer with a preview that keeps original values, plus full export and restore | Repeated import requests across forums. Competitor importer quality is untested | Optional re-matching of imported foods |
| Regional homemade food that becomes personal | Aliases and transliterations, explicit cooking fat, user-defined portions, recipe variants, and measured coverage per launch market | Hidden-oil and regional-dish complaints. Healthify and other regional apps already compete | Regional food packs and more languages |
| Household batch cooking | Only the data model: a cooked batch separate from its recipe | Shared-meal and cooked-weight requests, the clearest from 2018–2020. Basic recipe sharing exists in Cronometer and MacroFactor | Per-person portions, leftovers, and sending a portion to another adult's private diary. Each person uses their own plan, since OpenAI's terms bar one person's plan from serving another |

## 6. Requirements

Priority: **P0** blocks the V1 release. **P1** is planned for V1 and is the first to slip to 1.1. **P2** is stretch.

### 6.1 Onboarding and goals

| ID | Requirement | Pri |
| --- | --- | --- |
| ONB-01 | A user can start logging without creating an account or connecting AI | P0 |
| ONB-02 | The user confirms they are 18 or older before any target is generated | P0 |
| ONB-03 | Goal modes: lose, maintain, gain, observe. Observe mode shows intake without targets | P0 |
| ONB-04 | Calorie and macro targets are editable by hand at any time | P0 |
| ONB-05 | A generated target shows its equation, inputs and activity assumption | P0 |
| ONB-06 | A generated target never falls below a documented minimum or implies a rate of change above a documented cap. Going lower requires manual entry and shows a neutral notice. Thresholds and their sources are fixed before alpha | P0 |
| ONB-07 | Units: metric and imperial, kcal and kJ, locale-aware dates and decimals | P0 |
| ONB-08 | Reminders are off until the user turns them on | P1 |
| ONB-09 | A target estimate asks for the inputs its equation needs and does not infer physiology from gender identity | P0 |
| ONB-10 | Preferences for dietary style and foods to avoid, with no claim of allergen safety | P1 |

### 6.2 Diary and dashboard

| ID | Requirement | Pri |
| --- | --- | --- |
| DIA-01 | Today and past days, with configurable meal sections and per-entry time | P0 |
| DIA-02 | Dashboard shows consumed, target and remaining for calories, protein, carbohydrate, fat and fiber | P0 |
| DIA-03 | The user chooses which figures lead the dashboard; protein, fiber and water can be pinned first | P1 |
| DIA-04 | Add, edit, delete, undo, and move an entry between meals and days | P0 |
| DIA-05 | Recents, favorites, saved meals, copy a meal or a whole day, multi-select logging | P0 |
| DIA-06 | Quick-add calories with optional macros | P0 |
| DIA-07 | A day can be marked complete or partial. Unlogged and partial days are excluded from averages, never counted as zero | P0 |
| DIA-08 | Water logging | P1 |
| DIA-09 | Drafts are visibly distinct from confirmed entries and do not count toward totals | P0 |

### 6.3 Food data, search and barcode

| ID | Requirement | Pri |
| --- | --- | --- |
| FOOD-01 | Search generic and branded foods; each result shows its source and serving basis | P0 |
| FOOD-02 | Barcode scanning is free, with manual barcode entry as a fallback | P0 |
| FOOD-03 | Portions in grams, ounces, millilitres and the food's own household servings; volume converts to mass only with a food-specific density | P0 |
| FOOD-04 | Raw and cooked states are distinct records or explicit options | P0 |
| FOOD-05 | Custom foods, and a missing-barcode flow that ends in a reusable custom food | P0 |
| FOOD-06 | User-defined portions such as "my bowl", created only after the user sets the amount | P1 |
| FOOD-07 | Aliases and transliterations on personal foods and recipes, searchable | P1 |
| FOOD-08 | Previously used and custom foods work offline. An unknown product needs a network lookup or manual entry, and the app says which | P0 |
| FOOD-09 | Search does not call a rate-limited public API on every keystroke | P0 |
| FOOD-10 | Attribution and license notices for each data source are shown in the app | P0 |
| FOOD-11 | Coverage is measured on a real shopping and meal sample for each launch market before that market is announced | P0 |
| FOOD-12 | Per-serving and per-100-g values are normalized to one basis, and the basis in use is shown | P0 |
| FOOD-13 | A user's correction to a food is kept locally and never requires submitting data to a public database | P0 |

### 6.4 AI meal capture

| ID | Requirement | Pri |
| --- | --- | --- |
| AI-01 | All AI features use one internal provider contract: text and image in, a structured meal draft out through a function tool. No feature depends on a provider-specific field | P0 |
| AI-02 | ChatGPT plan connection on iOS, Android, Windows, macOS and Linux: "Continue with ChatGPT", separate consent for plan usage, a "Using ChatGPT plan" status, reconnect, sign-out that revokes the token, and a "Manage usage" link to ChatGPT settings | P0 |
| AI-03 | Each platform is advertised as supporting plan-funded AI only after it passes the gate in section 7. The hosted web app offers it only if OpenAI approves | P0 |
| AI-04 | OpenAI API-key path on every platform: the key is held in platform secure storage, requests go from the device straight to OpenAI, and the app states that usage is billed to the key's owner (decision D1) | P1 |
| AI-05 | Text entry of a meal with several foods produces one editable card per ingredient | P0 |
| AI-06 | Photo capture prompts for a one-line description and accepts the photo without one | P0 |
| AI-07 | For cooked, fried or dressed dishes, the review asks what fat was used and roughly how much, with a "not sure" option that applies a stated default | P0 |
| AI-08 | At most two clarifying questions per meal, asked only when the answer would change the meal's energy by a material amount. The threshold is set from test data | P0 |
| AI-09 | Each ingredient card shows the matched food, its source, the assumed portion and whether the portion was stated by the user or estimated | P0 |
| AI-10 | Structured editing of any card: swap food, change amount, remove, add | P0 |
| AI-11 | Conversational corrections such as "half the rice" or "this was cooked weight" | P1 |
| AI-12 | Nothing reaches the diary until the user confirms; confirmation can be undone | P0 |
| AI-13 | A corrected result can be saved as a meal or recipe. On a later similar capture, the app offers the saved version and asks before applying it. A new correction never changes old entries | P0 |
| AI-14 | Only the current meal's input and the candidate foods needed to match it are sent. The diary is never uploaded for a meal capture | P0 |
| AI-15 | On timeout, malformed output, refusal, expired or revoked token, ineligible plan or exhausted allowance, the draft is kept, the cause is stated, and manual entry is offered. The app never switches billing path on its own | P0 |
| AI-16 | Nutrition-label photo produces a custom-food draft for review | P1 |
| AI-17 | Voice entry uses operating-system dictation into the text field. The ChatGPT plan route does not accept audio | P1 |
| AI-18 | Questions over a user-selected date range, answered with computed figures that link to the underlying entries, with no causal claims and no automatic changes to targets | P2 |
| AI-19 | Plan-funded requests go from the device straight to OpenAI. No project-run server relays them or holds tokens | P0 |
| AI-20 | No plan-funded feature is limited to a paid tier | P0 |
| AI-21 | AI runs only on a user action. Background analysis needs its own explicit opt-in | P0 |
| AI-22 | The app shows which plans are eligible, that usage is shared with the user's other ChatGPT activity, and what happens when the allowance runs out, before the user connects | P0 |
| AI-23 | The app never asks for a ChatGPT password or session cookie and uses only OpenAI's supported sign-in flow | P0 |
| AI-24 | The AI connection is separate from the diary and sync account. Disconnecting AI deletes nothing and does not block manual logging | P0 |
| AI-25 | Available models are read from the account's catalogue at run time, and image capture is offered only when the chosen model accepts images | P0 |

### 6.5 Calculation and trust

| ID | Requirement | Pri |
| --- | --- | --- |
| CALC-01 | Nutrients are computed from selected food records and amounts. Model-generated nutrient numbers are never stored as database values | P0 |
| CALC-02 | Each component is labelled database-backed, label-transcribed, user-entered or AI-estimated | P0 |
| CALC-03 | When no credible match exists, the app offers a clearly marked estimate or manual entry | P0 |
| CALC-04 | Ranges come from explicit portion assumptions, are labelled "estimate range", and no confidence percentage is shown | P0 |
| CALC-05 | Each confirmed entry stores a nutrition snapshot with source and version | P0 |
| CALC-06 | Missing nutrients are shown as unknown, and totals show when coverage is partial | P0 |
| CALC-07 | Label energy values are kept as published and not recomputed from macros | P0 |
| CALC-08 | Certainty about what a food is and certainty about how much of it there is are shown separately. A weight estimated from a photo is never presented as measured | P0 |

### 6.6 Recipes

| ID | Requirement | Pri |
| --- | --- | --- |
| REC-01 | Recipes with ingredients, amounts, total yield and servings by weight or fraction | P0 |
| REC-02 | A cooked batch is separate from its recipe and can have its own ingredient amounts and cooked weight | P0 |
| REC-03 | Editing a recipe does not change entries already logged from it | P0 |
| REC-04 | Paste recipe text to get an ingredient list for review | P1 |
| REC-05 | Import a recipe from a URL, with manual entry when extraction fails | P1 |
| REC-06 | The recipe and batch data model can carry per-person portions and leftovers later without migration of logged history | P0 |
| REC-07 | Recipes and their notes are private. Sharing one is always an explicit action | P0 |

Worked example for REC-02: a batch totalling 2,400 kcal with a cooked weight of 1,600 g gives 450 kcal for a 300 g serving, before any uncertainty in the ingredient data.

### 6.7 Progress

| ID | Requirement | Pri |
| --- | --- | --- |
| PROG-01 | Manual weight entry and a smoothed trend, with the smoothing method explained | P0 |
| PROG-02 | Daily and weekly averages for calories and macros that respect DIA-07 | P0 |
| PROG-03 | Goal history; target changes apply from their date forward | P0 |
| PROG-04 | Sodium, sugars, saturated fat, calcium, iron and potassium where the source has them | P1 |

### 6.8 Health platforms

| ID | Requirement | Pri |
| --- | --- | --- |
| HLTH-01 | Write confirmed nutrition entries to Apple Health and Health Connect, with a permission per data type | P0 |
| HLTH-02 | Read body weight from both platforms | P0 |
| HLTH-03 | Edits and deletions propagate, and records the app wrote are never read back as new data | P0 |
| HLTH-04 | Optional import of activity or steps. Exercise energy is shown separately and is not added to the target unless the user turns that on | P1 |
| HLTH-05 | Desktop and web show synced records and do not present native health controls | P0 |

### 6.9 Sync, backup and ownership

| ID | Requirement | Pri |
| --- | --- | --- |
| SYNC-01 | Diary, repeat meals, recipes and cached foods read and write offline | P0 |
| SYNC-02 | Optional cross-device sync of diary, goals, food library, recipe versions and preferences, with no server administration by the user | P0 |
| SYNC-03 | Writes survive a restart, retries are idempotent, and conflicting edits are surfaced, not silently dropped | P0 |
| SYNC-04 | AI tokens and API keys stay on the device that holds them and are excluded from sync, backup and export. Each device connects separately | P0 |
| SYNC-05 | Versioned JSON export and re-import covering entries, recipes, custom foods, weight, water, goals and attachments | P0 |
| SYNC-06 | CSV export of diary and trends | P0 |
| SYNC-07 | Export and account deletion are free and available without contacting support | P0 |
| SYNC-08 | Photos are kept only as long as the user chooses, with a default set before beta | P1 |
| SYNC-09 | A photo taken offline can be kept as a draft and analysed later when the user asks | P1 |
| SYNC-10 | Deletion, backup retention and account recovery are documented for users | P0 |

### 6.10 Import

| ID | Requirement | Pri |
| --- | --- | --- |
| IMP-01 | One competitor export format, chosen in M0 from consented sample exports | P1 |
| IMP-02 | A preview shows supported fields, date and unit mappings, duplicates and what cannot be imported | P1 |
| IMP-03 | Imported values are stored as given. Any proposed re-matching is a separate, optional version | P1 |

### 6.11 Platforms

| ID | Requirement | Pri |
| --- | --- | --- |
| PLAT-01 | Core parity on every target in section 8: diary, goals, search, recipes, AI review where permitted, progress, sync, export | P0 |
| PLAT-02 | Tablet, desktop and unfolded layouts use two panes. A single stretched phone column does not count | P0 |
| PLAT-03 | Desktop and web core journeys can be completed by keyboard alone | P0 |
| PLAT-04 | Folding, unfolding, rotating and resizing never lose an unsaved draft | P0 |
| PLAT-05 | Where there is no camera, barcode and photo capture accept a file or manual entry | P0 |
| PLAT-06 | Minimum OS and browser versions and tested Linux distributions are published, along with any feature that differs by platform | P0 |

### 6.12 Privacy, safety, accessibility and reliability

| ID | Requirement | Pri |
| --- | --- | --- |
| PRIV-01 | No advertising SDKs, no sale of data, and no analytics without opt-in | P0 |
| PRIV-02 | A plain-language screen lists what goes to OpenAI, the sync service, each food-data provider and any dictation service | P0 |
| PRIV-03 | Camera, microphone and photo permissions are requested at first use of the feature | P0 |
| PRIV-04 | Credentials sit in platform secure storage, transport is encrypted, and local data is protected at rest. "Encrypted" is not presented as end-to-end encryption unless decision D4 makes it so | P0 |
| PRIV-05 | Copy is neutral: no praise or blame for intake, no streak loss, no red "over" states | P0 |
| PRIV-06 | The app states that it is not medical advice and that estimates can be wrong, on first AI use and in settings | P0 |
| PRIV-07 | Core flows work with screen readers, large text and non-color cues. Web targets WCAG 2.2 AA | P0 |
| PRIV-08 | Store health-data policies and account-deletion rules are checked for each store before submission | P0 |
| PRIV-09 | Data migrations, restore from backup and crash recovery are tested on every release. Diagnostics are opt-in and carry no meal content | P0 |

## 7. AI provider strategy

Using the subscription a user already pays for is the product's headline AI promise, so it has its own section and gate. The evidence is in the addendum, section 8.

### What is known

| Fact | Source |
| --- | --- |
| The self-serve route is open to open-source and locally run apps. Paid or remotely hosted apps need OpenAI's approval | [O1, O3] |
| The callback must be a loopback address. Phone apps satisfy this with a listener inside the app | [O5, X1, X2] |
| It has been verified end to end on an iPhone with a real account by another open-source app. On Android, sign-in has been shown to reach OpenAI's eligibility check | [X1, X2] |
| A hosted web page cannot receive the callback and should not store tokens | [O3, O8, X4] |
| OpenAI's terms require tokens to stay on the user's device, requests to come from it, and plan-funded features to be free of charge | [T1] |
| Developer docs name Plus and Pro. OpenAI's consumer page adds Go and Business. Free is refused | [O2, L1, X2] |
| Images are accepted when the model supports them. Audio is not. Function tools work inside a namespace | [O4] |
| Usage is shared with the user's other ChatGPT activity, with a per-app weekly cap the user sets | [O8, L1] |
| Signing in does not give the app access to the user's ChatGPT conversations or memories | [L1] |

### Paths in V1

| Path | Platforms | Who pays | Status |
| --- | --- | --- | --- |
| ChatGPT plan | iPhone, iPad, iPhone Duo, Android phone, tablet and foldable, Windows, macOS, Linux | The user's existing plan | P0, confirmed per platform by the gate below |
| ChatGPT plan | Hosted web app | The user's existing plan | Not available without OpenAI's approval; apply in M0 |
| OpenAI API key | All, including web | The key's owner, per request | P1 (decision D1) |
| No AI | All | Nobody | Always available |

### Rules the design must follow

These come from OpenAI's terms and bind the architecture, not only the AI feature.

1. Tokens are stored only in the device's secure storage and are never synced, backed up to a project server, or exported.
2. Every plan-funded request goes from the device straight to OpenAI. No project-run server relays or proxies it.
3. No plan-funded feature is ever limited to a paid tier.
4. AI runs only on a user action. Any background analysis needs its own explicit opt-in.
5. One person's activity never triggers a request on another person's plan. This constrains the later household feature.
6. The app registers under its own name and shows the plan-usage notice, status label and "Manage usage" link that OpenAI's guidance asks for.

### Gate for each platform

A platform is advertised as supporting plan-funded AI when all of these hold on a physical device with a store-style build:

1. Sign-in, a text meal and a photo meal complete on a paid plan.
2. Token refresh, sign-out with revocation, an exhausted allowance and an ineligible plan each behave as AI-15 requires.
3. The flow survives the platform's quirks: in-app browser on iOS, the return-to-app step on Android 15 and later.
4. The store's review has accepted a build containing the flow.

Tests use the real integration. A mocked "connected" state does not pass the gate.

In parallel, M0 sends OpenAI's interest form to confirm that an open-source app with optional sync and store distribution fits the self-serve route, and to ask for web access.

### Fallbacks

- If a platform fails the gate, it ships with manual logging and, if decision D1 is accepted, the API-key path, and is not described as supporting plan-funded AI.
- If OpenAI changes or withdraws the programme, the provider contract in AI-01 lets the API-key path take over without touching capture features.

## 8. Platform contract

All ten targets are V1. The milestone column is when the target is first validated end to end. The order is a validation sequence, not a ranking; no platform is dropped.

| Target | V1 contract | First validated |
| --- | --- | --- |
| Android phone | Touch app, camera and barcode, offline diary, Health Connect | M1 |
| Windows | Installable, offline diary, keyboard entry, file import and export | M1 |
| Web | Responsive on a declared browser matrix; offline subject to browser storage; AI through an API key unless OpenAI approves plan usage for the hosted app | M1 |
| iPhone | Touch app, camera and barcode, offline diary, Apple Health | M2 |
| macOS | Installable, resizable, keyboard and pointer, protected credential storage | M2 |
| Linux | Installable on declared distributions and package formats | M2 |
| Android tablet | Two panes, rotation, split-screen, hardware keyboard | M2 |
| iPad | Two panes, multitasking, keyboard and pointer | M2 |
| Android foldable | Cover and expanded layouts with state kept across folds; hinge-aware placement where the platform allows | M3 |
| iPhone Duo | 5.4-inch outer and 7.6-inch inner layouts on iOS 27.1, state kept across folds, usable in Split View | M3 |

"Supported" means the core journeys, upgrade path, sign-in return flows, accessibility and data recovery have been tested on that target. Compiling is not support.

Core features are the same everywhere: diary, goals, recipes, AI review where permitted, progress, sync and export. Camera, health-platform and other hardware features may differ by platform, and each difference is documented (PLAT-06).

No framework is chosen here. M0 picks one against this table.

## 9. Core flows

**First session.** Open the app → confirm age → choose a goal mode → accept or edit a target → log one food by search or barcode → see the dashboard. Account creation and AI connection are offered afterwards, not before.

**Photo meal.** Take or pick a photo → add a one-line description (prompted, skippable) → review ingredient cards → answer the cooking-fat question if it applies → adjust portions → confirm → optionally save as a meal.

**Repeat meal.** Open the meal section → pick from recents or saved meals → adjust the amount if needed → confirm.

**AI unavailable.** Start a capture → the request fails → the draft and photo are kept and the cause is shown → continue by search or quick-add, or retry later.

**Connect ChatGPT.** Tap Continue with ChatGPT → OpenAI's sign-in opens in an in-app browser → approve the app and plan usage → return to the app, which shows "Using ChatGPT plan". No further prompt on that device while it is used at least once every 30 days.

**New device.** Install → sign in to sync → the diary appears → connect ChatGPT on this device separately, since tokens do not sync.

## 10. Data sources and economics

### Food data

| Source | Use | License | Caveat |
| --- | --- | --- | --- |
| USDA FoodData Central | Generic and reference foods | CC0 | API key and quotas; its record types are not equally verified |
| Open Food Facts | Branded products and barcodes | ODbL for the database, with separate terms for contents and images | Volunteer data that may be incomplete or wrong; an entry is not "verified" |
| Indian Nutrient Databank | Candidate for Indian recipes and raw foods | Described as open access; its license and the terms of the tables it builds on are unconfirmed [I2] | No packaged foods |
| The user's own foods and recipes | Personal library | The user's | — |

Rules:

- Ingest and cache reference data instead of shipping a private API key in every client.
- Keep sources separable so that one license does not bind the others. Review how the Open Food Facts license applies to a combined database before the architecture is fixed.
- Check license and coverage for any regional dataset before using it. Never copy a competitor's catalogue.
- Measure coverage on real launch-market foods (FOOD-11). Entry counts are not coverage.

### Economics

A user's ChatGPT plan pays for eligible AI requests and nothing else. Sync, storage, food-data hosting, store fees and support are the project's costs.

| Always free | Why |
| --- | --- |
| Manual logging, barcode scanning, recipes, export | The product's core promise |
| Plan-funded AI | OpenAI's terms forbid charging for it [T1] |

A paid sync or convenience tier is a hypothesis for later, not a V1 feature and not an approved business model (decision D6). People who already pay for ChatGPT may resist a second subscription, so willingness to pay for sync needs its own test.

## 11. Success measures and acceptance gates

Targets are hypotheses to test, measured only from users who opt in to diagnostics. That sample will skew toward engaged users, so treat it as an upper bound. Raw meal content is not collected for analytics.

### Speed

Tap counts use the published method of the Food Logging Speed Index [V2], so they can be compared with other apps.

| Task | V1 target | Best published score |
| --- | --- | --- |
| Search and log one food | 13 actions or fewer | 10 |
| Log two foods together | 7 or fewer | 6 |
| Barcode scan to logged | 7 or fewer | 5 |
| Quick-add calories | 5 or fewer | 3 |
| Log a saved meal | Median under 10 seconds | — |
| Review and confirm an AI meal | Median under 30 seconds, model latency reported separately | — |

Where possible, testers log the same meals in their current app, and the comparison counts corrections and completed logs, not only the speed of the first AI answer.

### Activation and retention

| Measure | Target | Benchmark |
| --- | --- | --- |
| First meal confirmed in the first session | 70% of opted-in new users | None found |
| Logged again on the next calendar day | 50% of those | Second-session logging is the strongest reported predictor of retention [R2] |
| Still logging in week 4 | 35% of activated users | None found |
| Still logging at day 100 | Above 30% | A median of 70% of health-app users have stopped by then [R1] |

### Accuracy

Measured on a project-owned, consented set of at least 100 weighed meals across cuisines, lighting conditions and mixed dishes, including home-cooked dishes from each launch market.

| Measure | Requirement |
| --- | --- |
| Reported for each of: photo only, photo plus description, after clarifying questions, after user review | Energy and macro MAPE, plus signed mean error |
| Photo plus description plus questions versus photo only | Lower energy MAPE, with a smaller fat underestimate |
| Energy MAPE after user review | 20% or lower |
| Public accuracy statements | Only figures from this set, with the method published |

### Correctness and reliability gates

- Automated tests cover serving conversions, raw and cooked states, recipe yields, missing nutrients, label rounding, time zones and daylight saving, day completeness and duplicate health records.
- Every confirmed number has a traceable source type and a reproducible calculation.
- No past entry changes when a food, recipe or goal is edited, unless the user approves a scoped update.
- Offline write, restart, reconnect and a second device produce no lost or duplicated confirmed entries across the tested conflict cases.
- Own-format export and re-import preserve every documented field. Unsupported fields in an external import are reported.
- No AI failure mode in AI-15 corrupts the diary or blocks manual entry.

## 12. Milestones

No dates are set because team size and availability are not known. Each milestone ends on its exit criteria.

### M0 — Feasibility

| Work | Exit criterion |
| --- | --- |
| ChatGPT plan prototype on Android, iPhone and one desktop OS | Sign-in, a text meal and a photo meal complete on a paid plan on each. A Go account is tested. The interest form is sent to OpenAI covering store distribution, optional sync and web |
| Open decisions in section 16 | Each answered by its "needed by" point |
| License | Chosen and committed |
| Framework spike against section 8 | One framework chosen, with known gaps listed |
| Food data | Coverage measured on a sample for each candidate launch market. Licenses for every source in section 10 reviewed |
| Sync approach | Hosting model and encryption model chosen, with a cost estimate |
| User research | 12 to 20 interviews across the five segments in section 3 |
| Test assets | First 30 weighed meals photographed. Consented export samples collected for IMP-01 |

### M1 — Private alpha

Targets: Android phone, Windows, web. Scope: every P0 requirement in sections 6.1 to 6.7 and 6.12, with local storage and export. AI text capture on at least one permitted path, with photo capture added during the alpha so its value can be measured early.

The loop to complete: goals → search, scan or text → editable review → diary → repeat meal or basic recipe → weekly review → export and restore.

Exit: ten or more testers have logged for 14 consecutive days. Speed targets are met on the reference devices. The calculation test suite passes.

### M2 — Beta

Adds iPhone, macOS, Linux, Android tablet and iPad. Adds sync, health-platform integrations, photo AI on every platform that passed its gate, batch-aware recipes, and P1 items as capacity allows.

Exit: sync reliability gates pass. The accuracy set reaches 100 meals and results are written up. An accessibility audit is complete on web and on one phone platform.

### M3 — V1 release

Adds foldable layouts and the import path if it is ready.

Exit: every P0 requirement passes on every target in section 8. Store submissions are approved. The privacy screen, source attributions and accuracy method are published. AI is advertised only on platforms that passed the gate in section 7.

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Plan-funded AI fails this project's own device tests on a phone | Low | High | Proven by another open-source app on iPhone; M0 prototype on both phone platforms; API-key path |
| Go-plan users, common in India, turn out to be ineligible | Medium | High | Test in M0; state eligible plans before connecting (AI-22); API-key path |
| OpenAI treats the app as paid or remotely hosted because of sync or store distribution | Low to medium | High | Tokens and requests stay on-device and AI is never paywalled (AI-19, AI-20, SYNC-04); interest form in M0 |
| The hosted web app has no plan-funded AI | High | Medium | Apply for approval; API-key path; desktop apps for desk users |
| Users hit shared plan limits and blame the app | Medium | Medium | AI-22; clear limit message with a Manage usage link; manual logging always works |
| Ten platform targets exceed capacity | High | High | P0/P1/P2 ordering; staged validation; one shared codebase chosen in M0 |
| OpenAI changes eligibility, limits or the preview contract | Medium | High | Provider contract in AI-01; manual-first design |
| Food data is thin or wrong in a launch market | Medium | High | FOOD-11 measurement before announcing a market; custom foods and recipes |
| Photo estimates mislead users | Medium | Medium | AI-06 to AI-09; CALC-04 and CALC-08; no accuracy claims before measurement |
| Tracking harms vulnerable users | Low to medium | High | Adults only; ONB-06; PRIV-05; observe mode |
| Platform owners make third-party trackers redundant | Medium | Medium | HLTH-01 makes the app a data source for them; device neutrality |
| Sync hosting has a cost with no revenue | High | Medium | Decide the hosting model in M0; keep sync optional |
| Open Food Facts license terms constrain how data is combined | Medium | Medium | License review in M0; keep sources separable |

## 14. Out of V1

### Next, in rough order

1. Household batch cooking: per-person portions, leftovers, and sending a portion to another adult's private diary.
2. Better migration: optional re-matching of imported foods, and more import formats.
3. Regional food packs and more languages.
4. Adaptive energy targets. These need enough plausibly complete intake and weight history, an explanation of uncertainty and the user's approval. They are never a model guessing a new target each day.
5. Widgets, shortcuts and share-sheet capture.
6. A configurable tracking-day boundary for shift workers.
7. Advanced nutrition reports.
8. Direct integrations with Garmin, Fitbit, Oura, Whoop, Samsung Health and scale clouds, if Apple Health and Health Connect prove insufficient.
9. A ChatGPT plugin for logging from inside ChatGPT. It needs a hosted server and OpenAI's review [P1].

### Not planned

- Coaching marketplace, clinician portal, insurance workflows, disease treatment, medication or dose advice.
- Automatic deficit prescriptions for minors, pregnancy or clinical conditions.
- Public feed, challenges, leaderboards, calorie-burn competitions and coercive streak mechanics.
- Workout programming, wearable apps, fasting programmes, continuous glucose monitoring, menstrual tracking.
- Grocery delivery, pantry inventory, shopping optimization, weekly meal-plan generation.
- Universal restaurant coverage, every country's branded catalogue, or guaranteed photo-calorie accuracy.
- Automatic gallery scanning or any diary write without an explicit user action.
- AI vendors other than OpenAI, local models, and support for self-hosting the sync service, unless the primary integration becomes infeasible and scope is revised.

## 15. Changes from the first scope draft

The first draft is `PRODUCT_SCOPE.md` at commit `144bab7`. Everything in it carries into this document except the rows below, which follow from the second research pass. Each row stands unless rejected.

| Topic | First draft | This document | Why |
| --- | --- | --- | --- |
| ChatGPT plan on phones | To be validated per platform, outcome unknown | P0 on iOS, Android and desktop, behind a per-platform gate | Another open-source app verified it on an iPhone; OpenAI's terms set clear conditions the design can meet [X1, T1] |
| Second AI path | User-supplied API key excluded | API key added as a P1 secondary path | It is the only AI route for the hosted web app and for ineligible plans [O6, X2, X4] |
| Priority inside V1 | Alpha versus V1 only | P0, P1 and P2, with milestones M0 to M3 | Ten platform targets plus sync, health integrations and import is a large first release |
| AI diary questions | V1 | P2 | Not a retention driver in the research, and it spends the user's shared plan allowance |
| Recipe URL import and the competitor importer | V1 | P1 | Valuable, but neither blocks the core logging loop |
| Photo capture | Photo plus optional description | The flow prompts for a description and asks about cooking fat | Photo-only error is about 30–36%; descriptors and ingredients cut it to 24% and 14%. Fat is the largest miss [A1, A2, A3] |
| Health platform write | V1, listed late | P0 for nutrition write and weight read | AI coaches such as ChatGPT Health read from Apple Health [E4] |
| "iPhone duo" | Provisional name | Named target: iPhone Duo on iOS 27.1 | The device launched on 23 October 2026 [H1] |
| Generated targets | Explain the equation | Add a floor and a rate-of-change cap | Reviews of a competitor report generated targets of 200–1,100 kcal a day [V1] |
| Paid tier | Evaluate paid sync or convenience later | Same, with plan-funded AI fixed as free | OpenAI's terms forbid charging for it [T1] |
| License | Not addressed | Chosen before the first public commit of code | The repository has none, and the self-serve ChatGPT route is for open-source apps |

## 16. Open decisions

Recommended defaults are shown so work can proceed without waiting on every answer.

| # | Decision | Recommendation | Needed by |
| --- | --- | --- | --- |
| D1 | Add the API-key path as a secondary AI route | Yes. It is the only AI route for the hosted web app and for ineligible plans | Start of M0 |
| D2 | License | A permissive or weak-copyleft license unless GPL code will be reused. GPL-3.0 with outside contributors complicates App Store distribution. Take legal advice if this matters | M0 exit |
| D3 | Launch markets and languages | India and the US, English UI, built ready for localization. The US has the strongest reference data and the most eligible plans; India has an open regional dataset to evaluate and a strong home-cooking case, but Go-plan users may be ineligible for plan-funded AI | M0 exit |
| D4 | Privacy model: who hosts sync, and whether it is end-to-end encrypted | Local-first with optional sync. Decide hosting and encryption after the M0 cost estimate and OpenAI's answer | M0 exit |
| D5 | Which competitor export to import first | MyFitnessPal, given the switching signal, subject to what its export actually contains | M1 exit |
| D6 | Business model and who pays for hosting | Free core, no ads, no data sales, no pricing yet. Core logging, barcode, export and plan-funded AI stay free under any answer | M2 exit |
| D7 | Distribution | Open-source clients on each store and as direct downloads first; request OpenAI's approval for the hosted web app in parallel | Start of M0 |
