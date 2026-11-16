# OpenCalorieTracker — independent market research (second pass)

Research checked: 16 November 2026.

This is a separate second pass, not an edit of [MARKET_RESEARCH.md](./MARKET_RESEARCH.md). The first pass mapped competitor features and user requests. This pass targets what its section 9 left open: market structure and pricing, measured AI accuracy, retention evidence, new entrants, the open-source field, and a re-verification of the ChatGPT sign-in dependency against OpenAI's developer documentation.

It feeds [PRD_V1.md](./PRD_V1.md), the single product scope and requirements document.

## 1. Method and evidence grades

Every source in the register (section 10) carries one of three grades.

| Grade | Meaning |
| --- | --- |
| **P** | Primary page fetched and read in this pass |
| **S** | Search-result summary only; the page itself was not fetched or the fetch failed |
| **V** | Published by a company that sells a competing tracker; treated as a claim, not a measurement |

Limits of this pass:

- No hands-on testing of any competitor app, and no user interviews.
- No paid market-intelligence data. Download and revenue figures are third-party estimates relayed by trade press.
- Two academic retention papers could not be fetched (the server returned an empty body), so their figures are grade S.
- OpenAI's help-centre articles and live terms page returned HTTP 403. Plan eligibility comes from the developer docs and OpenAI's `learn.chatgpt.com` page; the terms come from an archived copy.
- Web search was US-only, which biases pricing and availability toward the US.

## 2. Headline findings

1. **Plan-funded ChatGPT inference works on phones, and this app can use the self-serve route if it is built to OpenAI's terms.** The callback must be a loopback address, which reads as desktop-only, but open-source mobile apps run the listener inside the app, and one has verified the flow on an iPhone with a real account. A hosted web app is the one target that cannot use it. Plan eligibility for Go users is still unsettled. Section 8 has the detail.
2. **Photo-only calorie estimates are biased low, mostly on fat.** An NIH test of four apps on 102 weighed meals found average underestimates of about 250–345 kcal per meal. Two peer-reviewed LLM studies put photo-only energy error near 30–36%, falling to about 14% when ingredients and amounts are supplied.
3. **The category is consolidating and prices are rising.** MyFitnessPal bought Cal AI in March 2026. Paid tiers cluster around $50–100 per year, and barcode scanning sits behind a paywall in MyFitnessPal and is moving there in Lose It!.
4. **Platform owners are entering food logging.** Garmin and Google now ship photo or barcode food logging inside their own health apps, and ChatGPT Health reads nutrition data from Apple Health and MyFitnessPal.
5. **No open-source tracker found covers phone, desktop and web with sync and no self-hosting.** The closest broad project needs a self-hosted server and is not open-source licensed.
6. **Early drop-off is the retention problem.** The research points to logging burden and database quality as the main reasons people stop, and to a second logging session as the best predictor that they stay.

## 3. Market structure and pricing

### Consolidation

MyFitnessPal announced its acquisition of Cal AI on 2 March 2026. Cal AI keeps running as a standalone app, and its team of about seven joined MyFitnessPal. Terms were not disclosed. [M1, M2, M3]

| Product | Scale signal | Grade |
| --- | --- | --- |
| MyFitnessPal | About 900K downloads and $13M revenue per month, per Sensor Tower as relayed by trade press | S |
| Cal AI | Over 15M downloads; annual revenue reported between $30M and $40M+ | S |
| Healthify | "Over 40 million users" on its App Store listing | S, V |

I found no defensible total market-size figure. The numbers in circulation come from competitor blogs or conflict with each other, so the PRD does not use one.

### Pricing

Prices below are US list prices from secondary sources unless marked. They conflict across sources and vary by country and promotion.

| Product | Annual price | Free tier | Grade |
| --- | --- | --- | --- |
| MyFitnessPal Premium / Premium+ | About $80 / $100 | Ad-supported; barcode scanner paid | S, V |
| Cronometer Gold | About $50–60 | Yes; free barcode scanning | S, V |
| MacroFactor | $71.99 ($11.99 monthly) | None; 7-day trial | P, V |
| Lose It! Premium | $40–80, sources disagree | Yes; barcode moving to Premium | S, V |
| Cal AI | About $30–70, sources disagree | Limited | S, V |

**Implication:** a free core with barcode scanning and no ads is a real wedge today, but Cronometer and FatSecret already occupy it. The price pressure is on AI features, which is where plan-funded inference would matter.

### What reviewers complain about

A monthly review analysis of ten diet apps (2,995 US App Store reviews from April 2026) gives these average ratings from written reviews: Cal AI 1.92 (208 reviews), MyFitnessPal 2.31 (1,438), Lose It! 3.46 (143), Cronometer 4.06 (83). It reports that a redesign backlash appears in roughly 60% of MyFitnessPal's reviews. Complaint themes across apps are billing and cancellation, paywalls on features that used to be free, estimate accuracy, crashes and ads. [V1]

Caveats: the author is the CEO of MyNetDiary, a competitor, and discloses the conflict. Review authenticity was judged by an AI classifier. Samples are small for some apps.

**Implication:** stable feature access and an honest billing posture are differentiators that cost nothing to build. A forced redesign is a known way to lose long-time users, which argues for conservative UI change after launch.

## 4. AI accuracy evidence

### Commercial apps

Researchers at the NIH's NIDDK intramural program photographed 102 meals prepared in a metabolic kitchen, with ingredients weighed to 0.1 g, and ran them through MyFitnessPal, Lose It!, Cal AI and Appediet. All four underestimated energy by about 250 to 345 kcal per meal on average, and fat by about 30 g. Carbohydrate estimates were the most consistent. A follow-up on more than 200 further meals suggests larger errors on ketogenic meals. [A1]

This was a conference presentation at NUTRITION 2026 (25 July 2026) and is not yet peer reviewed. The release gives no per-app figures.

### General-purpose models

| Study | Setup | Energy error | Grade |
| --- | --- | --- | --- |
| Fridolfsson et al., *Curr Dev Nutr* 2025 | 52 standardized photos; ChatGPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro | MAPE 35.8% for ChatGPT and Claude; 64.2% for Gemini | P |
| Rodríguez-Jiménez et al., *Nutrients* 2025 | 195 dishes; ChatGPT-5 at four context levels | MAPE 30.5% photo only → 24.4% with non-visual descriptors → 13.9% with ingredients and amounts | P* |

*The per-scenario values for the second study came through a model-extracted summary of the page, so confirm them against the paper before quoting them publicly.

Two details matter for product design:

- Fridolfsson et al. found underestimation grew with portion size, even with plates and cutlery in frame for scale. [A2]
- Rodríguez-Jiménez et al. found that ingredients without the photo (18.1%) did worse than ingredients with it (13.9%), so the photo adds information beyond the arithmetic. [A3]

Both used older models than those available today, so absolute numbers will have moved. The direction of the bias and the value of added context are the durable findings.

**Implications for the product:**

1. Photo-only is the weakest input. The capture flow should invite a one-line description every time and make ingredient-level correction cheap.
2. The largest and most consistent error is fat. A question about cooking fat on cooked dishes is worth its friction.
3. Errors skew low and grow with portion size, so a symmetric "± range" would misrepresent them. Ranges should come from explicit portion assumptions.
4. Any accuracy claim needs the project's own weighed test set, reporting signed bias as well as absolute error.

## 5. Retention and reasons for quitting

- A 2024 JMIR review of health-app abandonment reports that a median of 70% of users stopped within the first 100 days, with higher drop-off in real-world use than in trials. [R1, grade S]
- A 2026 JMIR mHealth paper on a dietary app reports that most attrition happens soon after first use and that logging again afterwards was the strongest predictor of continued use. [R2, grade S]
- A CHI study of 141 current and lapsed food journalers plus 5,526 forum posts found that social features did not create the engagement loop developers hoped for. [R3, grade S]
- A Wageningen mixed-methods study attributes high user burden to the time cost of logging every eating occasion and to problems with food databases. [R4, grade S]
- A competitor's churn report ranks reasons for leaving as logging time (34%), inaccurate or missing database items (28%) and lost motivation (24%). [R6, grade S, V]

The often-repeated claim that only 3% of users keep logging after a week traces to a secondhand magazine citation I could not verify. It should not be quoted.

On harm: one experimental study found no causal effect of MyFitnessPal use on eating-disorder symptoms, while cross-sectional and qualitative work links tracking to disordered eating in vulnerable people. The evidence is mixed, which supports neutral language and guardrails on generated targets without supporting stronger claims either way.

**Implications:** the product's first-week job is to get a second day logged. Logging speed and database trust rank ahead of social features and coaching. Speed has a public yardstick: MacroFactor's Food Logging Speed Index counts taps per task across 21 apps, with best scores of 10 for search, 5 for barcode, 6 for multi-add and 3 for quick-add. [V2] The index is run by MacroFactor, which scores itself first, but the method is published and reusable.

## 6. New entrants and substitutes

| Entrant | What shipped | Grade |
| --- | --- | --- |
| Garmin Connect+ | Food logging by photo, barcode and search, announced at CES in January 2026, behind the Connect+ subscription | S |
| Google Health (formerly the Fitbit app) | Gemini coach accepts meal logs by text or photo; calorie targets and meal logging in the app; Premium feature with some expansion to free users | S |
| Apple Health in iOS 27 | Nutrition-label scanning reported by one secondary source; the planned Health+ AI coach was reported scaled back | S |
| ChatGPT Health | Open to all US adults since 23 July 2026; reads Apple Health and MyFitnessPal data; no food logging of its own | S |
| GLP-1 companion apps | MyNetDiary launched a GLP-1 companion in May 2026; dedicated apps lead with protein, fiber and water | S, V |

**Implications:**

- AI coaches are becoming readers of nutrition data. An app that writes clean nutrition records to Apple Health and Health Connect becomes a data source for them without building any integration with them. This raises the value of health-platform write support.
- Device makers bundle logging with a hardware subscription. Competing on hardware tie-in is not available to this project; competing on being device-neutral is.
- Protein, fiber and water as first-class dashboard figures serve the GLP-1 segment cheaply. Medication and symptom tracking would not be cheap and would move the product toward clinical territory.

## 7. Open-source field

| Project | License | Platforms | Sync | AI | Stars |
| --- | --- | --- | --- | --- | --- |
| OpenNutriTracker | GPL-3.0 | Android, iOS | Not documented; local storage | Optional; user supplies an Anthropic, OpenAI or OpenRouter key, or a self-hosted server | 2.9k |
| SparkyFitness | Source-available, non-commercial | Self-hosted web, iOS, Android, watch companions | Via the user's own server | Chat and image logging in beta; bring your own LLM | 6.8k |
| Waistline | GPL-3.0 | Android | Not documented | Not documented | 758 |
| FoodYou | GPL-3.0 | Android | Not documented; local storage | Not documented | 626 |

All four read from the READMEs on 16 November 2026 (grade P). "Not documented" means the README is silent, not that the feature is absent.

**Implications:**

- The gap is specific: installable apps on phone and desktop plus web, with sync that needs no server administration. SparkyFitness has the breadth but needs Docker and PostgreSQL; the mobile-first projects have no documented desktop or web clients.
- The four trackers above that offer AI do so through a user-supplied key, and OpenAI's own error-handling guidance names "the user's own API key" as an alternative billing path. Since October 2026, other open-source health apps have added ChatGPT plan sign-in beside the key option (section 8.2). No calorie tracker found leads with it.
- This repository has no license file yet. The ChatGPT open-source route and community trust both depend on choosing one.
- Reusing code from the GPL-3.0 projects would bind this project to GPL-3.0.

## 8. ChatGPT sign-in: deep dive

A third pass on 16 November 2026, prompted by the first version of this section, which concluded only that mobile was undocumented. This pass read OpenAI's terms, every Sign in with ChatGPT developer page, and the source code and pull requests of open-source apps that have shipped the flow.

**Conclusion: plan-funded AI works on phones through the self-serve route, and this app can qualify for that route if it is built to OpenAI's terms. A hosted web app is the one target that cannot use it.**

### 8.1 What OpenAI's terms require

Read from the archived copy of the Sign in with ChatGPT Terms dated 29 September 2026. [T1] The live page blocks automated fetches, so check it in a browser before relying on this.

| Clause | Text | What it means here |
| --- | --- | --- |
| Token storage | "Any persistent storage of Authentication Tokens must be local and under the user's control, not in a remote or managed environment." | Tokens live in the device keychain. A sync service must never hold them |
| Request origin | "Requests must originate from the user's local runtime or a remote runtime only that user controls." | The app calls OpenAI directly from the device. No project-run proxy |
| No charge | "Users must be able to use their ChatGPT plan through SIWC without paying you or upgrading to a paid version of your application." | Plan-funded AI can never sit behind a paid tier |
| Authorization | "Obtain express consent before background use." | No background photo analysis without an explicit opt-in |
| Connected app only | "Do not provide general-purpose API access for other tools or unrelated requests." | The connection serves this app's features only |
| No sharing | No "pooling, transferring, reselling, gifting, or sharing ChatGPT plan usage or Authentication Tokens." | Each device signs in itself. Tokens do not sync. No household sharing of one plan |
| Identity | "Use your app's own name during sign-in and activation." | Register as OpenCalorieTracker |
| Enforcement | OpenAI "may suspend or disable your application's access" for violations or risk | Access can be withdrawn; manual logging must stand alone |

The terms do not mention mobile apps, app stores, health or nutrition. They do not define "open source." The split between self-serve and approval comes from the developer docs: plan usage is open to "open-source projects, personal projects that run locally, and selected private apps," while "a paid or remotely hosted app" completes an interest form. [O1, O3]

### 8.2 Evidence that it works on phones

The docs require the callback to be `http://127.0.0.1:<port>/auth/callback`, with only the port free to vary, and custom URL schemes are not accepted. [O5] Mobile apps meet this by running a short-lived listener on the phone's own loopback address while an in-app browser shows the sign-in page.

| Project | What it shows | Verified how |
| --- | --- | --- |
| OpenStrap Edge, a Flutter health app with nutrition tracking (AGPL-3.0) | Loopback listener in Dart, in-app browser, tokens in the keychain. Merged 1 November 2026 | Tested by its author on an iPhone 16 Pro Max running iOS 27.0.1 with a real ChatGPT account: sign-in completed and replies came back on the plan [X1] |
| AnythingLLM Mobile, a React Native app | Native loopback modules in Kotlin and Objective-C. Merged 2 October 2026 | On Android, a Free account went through the whole browser and loopback flow and was stopped at OpenAI's eligibility check. The paid path and iOS were untested at merge [X2] |
| openGym, a workout tracker on the App Store (AGPL-3.0, 21.7k stars) | Server-side variant for self-hosters, off by default, with a paste-the-callback fallback | Its code comments state that a paid or remotely hosted app needs OpenAI's approval, which is why it is limited to self-hosted instances [X3] |
| GitHub code search | At least 15 repositories each in Swift, Kotlin and Dart contain the plan-usage scope | Presence of code only; not evidence that each works |

Two practical details from these implementations:

- On iOS the sign-in page must open in an in-app browser. The full Safari app would suspend the calling app and kill the listener. [X1]
- On Android 15 and later the app cannot bring itself back to the foreground, so the callback page needs a "Return to app" link. [X2]

Not yet evidenced in anything I read: a paid-plan request completing on Android, a meal photo sent over the plan route from a phone, and an app-store review that examined this flow.

### 8.3 Verdict by platform

| Platform | Plan-funded AI | Basis |
| --- | --- | --- |
| iPhone, iPad, iPhone Duo | Works | Third-party device test on iOS 27 [X1] |
| Android phone, tablet, foldable | Very likely | Sign-in reaches OpenAI's eligibility check; paid inference not yet evidenced [X2] |
| Windows, macOS, Linux | Works | The documented path, with an Electron reference app [O1] |
| Web app run on the user's own machine | Possible | A local server can receive the loopback callback [X5] |
| Hosted web app | Not available self-serve | A hosted page cannot receive a `127.0.0.1` callback, the docs say to keep tokens out of browser storage, and "remotely hosted" apps are routed to the interest form [O3, O8, X4] |

### 8.4 What the user experiences

1. Tap **Continue with ChatGPT**. An in-app browser opens OpenAI's sign-in.
2. Name and approve the app, then approve "use my ChatGPT plan" as a separate consent.
3. The browser hands back to the app, which shows "Using ChatGPT plan."

After that there is no further prompt on that device. The access token lasts one hour and refreshes silently; the refresh token lasts 30 days and renews on each use, so a user who opens the app at least once a month stays connected. [O7] Each device signs in once on its own.

Limits to be upfront about with users:

- **Plan eligibility is unsettled.** Developer docs name Plus and Pro. OpenAI's consumer page says "eligible ChatGPT Go, Plus, Pro, and Business subscribers." [O2, L1] A Free account is refused. [X2] Whether Go works on the open-source route is unverified, and it matters most in India.
- **Usage is shared.** Requests count against the user's existing allowance. Plus has one five-hour limit across all connected apps. The user sets a per-app weekly cap in ChatGPT settings, and credits are off by default. [O8, L1]
- **When the allowance runs out, AI stops** until it resets. OpenAI does not switch to another billing path. [O6]
- **No audio.** Voice entry has to use on-device dictation. [O4]

### 8.5 Engineering notes from shipped implementations

- Register with `client_id=dynamic_agent_client`, then save and reuse the issued `oaiapp_…` id and a per-install host id. [O5, X1]
- Send `store: false` and `stream: true`. Use `developer` in place of `system` messages. Omit `temperature` and `max_output_tokens`. [O4]
- Function tools must be grouped in a namespace. [O4, X1]
- The final `response.completed` event can arrive with an empty `output`; build the result from the earlier `response.output_item.done` events. Mock tests missed this and a device test caught it. [X1]
- Refresh tokens rotate. Serialize refreshes and persist the new token before using it. [O8]
- Sign-out should revoke the refresh token. Signing out of the app alone does not disconnect it in ChatGPT. [X1]
- OpenAI's interface guidance asks for a one-time "You're using your ChatGPT plan" notice, a "Using ChatGPT plan" label near the input, and a "Manage usage" link to ChatGPT's usage settings. [X6; the guidelines page now returns 404, so this is secondhand]

### 8.6 Other routes considered

| Route | Fit |
| --- | --- |
| Commercial partner trial | Needed for a hosted web app or any design where a server touches tokens. Interest form with no published criteria. The named plan-usage partners are developer and productivity tools such as Devin, Notion, Warp and Vercel v0; none is a consumer mobile app [L1] |
| ChatGPT plugin, where the tracker runs inside ChatGPT | A complement, not a substitute. Tools can receive files the user attaches, and plugins must work in ChatGPT on mobile. It needs a public hosted server, OAuth and review, and plugins may not sell subscriptions [P1] |
| Reusing the Codex CLI's client id or ChatGPT's internal endpoints | Ruled out. OpenAI's docs say not to point this flow at ChatGPT's backend endpoints, and the terms allow tokens only through the supported sign-in flow [O9, T1] |
| OpenAI API key supplied by the user | Works on every platform and plan, billed per request. The terms say plan restrictions "do not affect separately authorized API use" [T1] |

### 8.7 Open questions

1. Does a Go plan work on the open-source route? A five-minute test with a Go account in any app that already ships the flow would answer it.
2. Will OpenAI treat an open-source app that also offers an optional sync service as "remotely hosted"? The terms suggest no, provided tokens and requests stay on the device, but only OpenAI can confirm. AnythingLLM's maintainers listed the same question as a follow-up. [X2]
3. Does image input work on the plan route from a phone for the listed models? The docs say images are supported "when the selected model accepts them." [O4]
4. Does an app-store reviewer accept the flow? OpenStrap distributes through TestFlight and openGym is on the App Store, but neither is evidence of a review that looked at this feature.
5. The programme is described as a preview. Its terms, limits and eligibility can change.

## 9. Corrections and additions to the first-pass documents

| First-pass statement | Finding in this pass |
| --- | --- |
| "iPhone duo" is a provisional name needing clarification | iPhone Duo is Apple's foldable. It launched on 23 October 2026 with a 5.4-inch outer display and a 7.6-inch inner display, both about 4:3, on iOS 27.1 with Split View. [H1] |
| Cal AI treated as an independent competitor | Owned by MyFitnessPal since March 2026, still operating as a separate app |
| MacroFactor web status not verified | No web or desktop launch appears in its January, April or July 2026 updates; a third-party roundup says desktop is a future roadmap theme (grade S) |
| ChatGPT flow "must be validated on mobile" | Other open-source apps have already done it with an in-app loopback listener, verified on an iPhone. What remains is this project's own device tests and the Go-plan question (section 8) |
| Hosted web AI "subject to approval" | Confirmed, and for a structural reason: a hosted page cannot receive the loopback callback |
| BYO API key excluded from V1 | Every open-source competitor with AI offers it, and OpenAI's docs name it as an alternative billing path. It is the only AI route for a hosted web app and for ineligible plans. The PRD recommends it as a secondary path |
| Indian food data needs country-specific testing | The Indian Nutrient Databank is an open-access candidate built largely on IFCT 2017. Its license and the IFCT redistribution terms were not confirmed [I2, grade S] |

## 10. Source register

### Market and pricing

- **M1** (S): [MyFitnessPal acquires Cal AI, press release, 2 March 2026](https://www.globenewswire.com/news-release/2026/03/02/3247439/0/en/MyFitnessPal-Acquires-Cal-AI-Expanding-on-its-Position-as-the-Leading-Player-in-Digital-Nutrition-Tracking.html)
- **M2** (S): [Fitt Insider on the acquisition, with Sensor Tower figures](https://insider.fitt.co/myfitnesspal-acquires-rival-food-tracker-cal-ai/)
- **M3** (S): [The Next Web on the acquisition](https://thenextweb.com/news/myfitnesspal-acquires-cal-ai-the-viral-calorie-tracking-app-built-by-teens)
- **M4** (S, V): [Calorie app price index](https://nutriscan.app/research/calorie-app-prices) and [2026 pricing guide](https://nutrola.app/en/blog/calorie-tracker-pricing-guide-free-vs-premium-comparison-2026)
- **V1** (P, V): [MyNetDiary diet app scorecard, April 2026](https://www.mynetdiary.com/diet-app-scorecard-april-2026.html)
- **V2** (P, V): [MacroFactor Food Logging Speed Index](https://macrofactor.com/fastest-food-logger-2025)
- **V3** (P, V): [MacroFactor vs Cal AI, updated 6 April 2026](https://macrofactor.com/macrofactor-vs-cal-ai/); [July 2026 update](https://macrofactor.com/mm-july-2026/)

### Accuracy

- **A1** (P): [NIH/NIDDK release for NUTRITION 2026, 25 July 2026](https://www.newswise.com/articles/photo-based-calorie-tracking-apps-may-underestimate-energy-in-meals)
- **A2** (P): [Fridolfsson et al., *Current Developments in Nutrition* 2025;9(10):107556](https://pmc.ncbi.nlm.nih.gov/articles/PMC12513282/)
- **A3** (P, values via extraction): [Rodríguez-Jiménez et al., *Nutrients* 2025;17(22):3613](https://pmc.ncbi.nlm.nih.gov/articles/PMC12655113/)

### Retention

- **R1** (S): [JMIR 2024;26:e56897, health app abandonment review](https://www.jmir.org/2024/1/e56897)
- **R2** (S): [JMIR mHealth 2026, e82276, dietary app retention](https://mhealth.jmir.org/2026/1/e82276)
- **R3** (S): [Cordeiro et al., food journaling barriers](https://pmc.ncbi.nlm.nih.gov/articles/PMC4755274)
- **R4** (S): [Wageningen mixed-methods study on nutrition app burden](https://edepot.wur.nl/636781)
- **R5** (S): [JMIR mHealth 2021 systematic review of nutrition app barriers](https://mhealth.jmir.org/2021/6/e20037/PDF)
- **R6** (S, V): [Nutrola 90-day churn report](https://nutrola.app/en/blog/120k-first-app-churn-90-day-data-report-2026)

### Entrants

- **E1** (S): [Garmin food tracking in Connect+, CES 2026](https://www.engadget.com/wearables/garmin-food-tracking-feature-connect-plus-ces-2026-043231948.html)
- **E2** (S): [Google Health coach help page](https://support.google.com/googlehealth/answer/16961408) and [Google Health updates](https://blog.google/products-and-platforms/products/google-health/fitbit-google-health-updates/)
- **E3** (S): [Apple scaling back Health+](https://www.mactrast.com/2026/02/apple-reportedly-scaling-back-plans-for-apple-health-in-ios-27/); [iOS 27 calorie tracking guide](https://www.bentobunny.app/guides/ios-27-calorie-tracking-features) (V)
- **E4** (S): [ChatGPT Health overview](https://www.forbes.com/sites/jonmarkman/2026/01/08/everything-about-chatgpt-health-you-need-to-know/); [ChatGPT Health availability](https://askvora.com/blog/chatgpt-health-wearable-data-2026)
- **E5** (S, V): [MyNetDiary GLP-1 companion launch](https://xpr.media/?p=778438)

### Open source

- **G1** (P): [OpenNutriTracker](https://github.com/simonoppowa/OpenNutriTracker)
- **G2** (P): [SparkyFitness](https://github.com/CodeWithCJ/SparkyFitness)
- **G3** (P): [Waistline](https://github.com/davidhealey/waistline)
- **G4** (P): [FoodYou](https://github.com/maksimowiczm/FoodYou)

### OpenAI

- **O1** (P): [Sign in with ChatGPT cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- **O2** (P): [Quickstart](https://developers.openai.com/siwc/quickstart)
- **O3** (P): [ChatGPT plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source)
- **O4** (P): [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- **O5** (P): [Sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- **O6** (P): [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- **O7** (P): [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- **O8** (P): [Profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- **O9** (P): [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- **O10** (P): [Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)
- **O11** (P): [Sign in on your website](https://developers.openai.com/siwc/website) (identity only, selected partners)
- **T1** (P, archived): [Sign in with ChatGPT Terms, dated 29 September 2026](https://openai.com/policies/sign-in-with-chatgpt-terms/), read from the [7 October 2026 archive copy](https://web.archive.org/web/20261007132710/https://openai.com/policies/sign-in-with-chatgpt-terms/)
- **L1** (P): [OpenAI's consumer page on Sign in with ChatGPT](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)
- **P1** (P): [ChatGPT plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines.md) and [reference](https://developers.openai.com/plugins/reference.md)
- Not read: the help-centre articles and the interest form (HTTP 403), and the interface guidelines page (HTTP 404).

### Implementations of ChatGPT plan sign-in

- **X1** (P): [OpenStrap Edge pull request 602](https://github.com/OpenStrap/edge/pull/602), with its source file `lib/coach/coach_chatgpt.dart`
- **X2** (P): [AnythingLLM Mobile pull request 121](https://github.com/Mintplex-Labs/anythingllm-mobile/pull/121)
- **X3** (P): [openGym](https://github.com/DuarteSantos8/openGym), file `api/coach/chatgpt-plan.js`
- **X4** (P): [big-AGI](https://github.com/enricoros/big-AGI), file `kb/modules/LLM-openai-responses.md`, a web app's note on why it did not adopt the flow
- **X5** (P): [SurfSense](https://github.com/MODSetter/SurfSense), file `docs/architecture/chatgpt-subscription.md`
- **X6** (P): [Third-party analysis quoting OpenAI's terms and interface guidelines](https://github.com/maccavelli/go-llmprovider-sdk/issues/2)

### India and devices

- **I1** (S): [ChatGPT Go free for a year in India](https://techcrunch.com/2025/10/27/openai-offers-free-chatgpt-go-for-one-year-to-all-users-in-india)
- **I2** (S): [Development of an Indian food composition database (INDB)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11277795/)
- **I3** (S, V): [Healthify App Store listing](https://apps.apple.com/in/app/id943712366)
- **H1** (P): [MacRumors iPhone Duo roundup](https://www.macrumors.com/roundup/iphone-duo/)
