# OpenCalorieTracker: V1 phone design

Status: phone designs are complete for the M1 alpha. Desktop and web layouts (PLAT-02/03) are not designed yet. Last updated 22 November 2026.

The screens live in Doop, canvas [`rVpXoBmrqv`](https://doop.design/c/rVpXoBmrqv), and are not checked into this repository. This document records:

- what each screen is;
- where to find each frame;
- which requirements in [PRD_V1.md](./PRD_V1.md) each screen covers;
- the rules every screen follows.

Each frame is an interactive HTML prototype. A frame link opens it on the canvas. A PNG of any frame is at `https://doop.design/i/<frame id>.png?scale=2`.

## 1. Canvas layout

| Page | Contents |
| --- | --- |
| App | The 66 final frames, one row per screen. Each row starts with the interactive frame, followed by its states. |
| Components | 93 shared components, all used by App frames. |
| Reference | The Tokyo Night palette source. |

Frame names are `<Screen>` for the interactive frame and `<Screen> · <state>` for its states. A state frame is a copy of its screen's HTML that opens in one state, for review.

## 2. Design rules

These rules come from review feedback and apply to every screen.

1. **Fewest taps.**
   - A usual item takes 1 tap.
   - Another portion or meal takes at most 2.
   - A 3-item meal takes at most 4.
   - Search is typing plus 1 tap.
   - Defaults (meal by time of day, last-used portion) and Undo replace confirmation dialogs.
2. **Controls appear where you tap.** That means inline expansion, where the rows below move down, or an anchored popover with a caret.
   - No bottom sheets and no modals.
   - The one exception is the docked number pad, which stands in for the OS keyboard.
3. **Flat style.**
   - No card backgrounds: content sits on the screen background at a 20 px gutter.
   - Space and small dim labels separate sections.
   - Hairlines appear only between list rows.
   - Surfaces remain only on:
     - controls (buttons, chips, segmented controls, toggles, keys, fields);
     - overlays (popovers, cards floating over the camera);
     - the dashed outline that marks AI drafts.
4. **Minimal copy.**
   - No helper paragraphs.
   - At most one short dim line where the PRD requires a disclosure.
5. **Dense layouts**, with tap targets of at least 40 pt.
6. **Neutral tone** (PRIV-05).
   - No red over-states and no praise or blame.
   - Every state also has a glyph or text cue, never colour alone (PRIV-07).
7. **Tokyo Night palette.**
   - A dark navy background.
   - Accents `#7aa2f7` (blue), `#bb9af7` (lavender, protein), `#73daca` (teal, carbs) and `#ff9e64` (orange, fat).
8. **Stateful log controls.**
   - A meal chip is a toggle: tap to add, tap again to remove.
   - Tapping a logged item opens an anchored editor for its amount, meal and removal.
9. **Every amount converts through grams.**
   - Portions can be learned, kitchen units ("1 bowl = 250 g", defined once) or typed on the in-panel keypad.

## 3. Screens

### Today
The daily dashboard and the main place to log food. Covers DIA-02, DIA-04, DIA-06, DIA-09, AI-05–AI-12, AI-15, CALC-02/04/06/08 and PRIV-06.

Tapping a meal's `+` turns that row into a field. The field shows usuals, accepts typing, and has camera and mic buttons when AI is connected. AI results arrive as dashed drafts and count toward nothing until confirmed. Each draft card shows its source tag (IFCT, Open Food Facts, Label, You, AI estimate) separately from how sure the amount is ("you said", or an estimate range for photo guesses). There are no confidence percentages.

Holding the Add button opens a fan of Search, Camera and Voice. Fiber shows as "partial" when an item's fiber is unknown.

| Frame | ID |
| --- | --- |
| [Today](https://doop.design/c/rVpXoBmrqv?frame=wV64oMIRSY) | `wV64oMIRSY` |
| [Today · usuals](https://doop.design/c/rVpXoBmrqv?frame=ZI8hm-dO7j) | `ZI8hm-dO7j` |
| [Today · typing](https://doop.design/c/rVpXoBmrqv?frame=DsRtlGmqxa) | `DsRtlGmqxa` |
| [Today · voice](https://doop.design/c/rVpXoBmrqv?frame=QJ1llDHztv) | `QJ1llDHztv` |
| [Today · camera](https://doop.design/c/rVpXoBmrqv?frame=1XJ7eTPNfR) | `1XJ7eTPNfR` |
| [Today · photo](https://doop.design/c/rVpXoBmrqv?frame=ZUfKyo-hz3) | `ZUfKyo-hz3` |
| [Today · drafts](https://doop.design/c/rVpXoBmrqv?frame=BNY926908B) | `BNY926908B` |
| [Today · confirmed](https://doop.design/c/rVpXoBmrqv?frame=9pqvBZlVa6) | `9pqvBZlVa6` |
| [Today · hold](https://doop.design/c/rVpXoBmrqv?frame=OdHefurjJU) | `OdHefurjJU` |
| [Today · quick add](https://doop.design/c/rVpXoBmrqv?frame=HaivqkhFqx) | `HaivqkhFqx` |
| [Today · AI failed](https://doop.design/c/rVpXoBmrqv?frame=7xdYG8NA5E) | `7xdYG8NA5E` |

### Library
Saved foods, meals, recipes and custom foods, ranked for the current time of day, with pinned rows at the top. Covers DIA-05, FOOD-03, FOOD-06 and FOOD-12.

Each row has a one-tap `+` that logs its default portion. Tapping a row opens a panel with:

- learned portion chips;
- a `…` chip that opens a keypad with a unit rail;
- meal chips;
- a kitchen-unit menu.

The camera and mic sit inside the search field.

| Frame | ID |
| --- | --- |
| [Library](https://doop.design/c/rVpXoBmrqv?frame=SU5ONNHkrJ) | `SU5ONNHkrJ` |
| [Library · item open](https://doop.design/c/rVpXoBmrqv?frame=XM8tTvznRM) | `XM8tTvznRM` |
| [Library · hold](https://doop.design/c/rVpXoBmrqv?frame=3FLb1rdac4) | `3FLb1rdac4` |
| [Library · search](https://doop.design/c/rVpXoBmrqv?frame=pJf2nm6i1A) | `pJf2nm6i1A` |
| [Library · edit logged item](https://doop.design/c/rVpXoBmrqv?frame=_YBYnWZNKU) | `_YBYnWZNKU` |
| [Library · custom amount](https://doop.design/c/rVpXoBmrqv?frame=AIyxOwqzPS) | `AIyxOwqzPS` |
| [Library · units](https://doop.design/c/rVpXoBmrqv?frame=BebH9Kb-iP) | `BebH9Kb-iP` |
| [Library · roti logged](https://doop.design/c/rVpXoBmrqv?frame=qHIi05m494) | `qHIi05m494` |
| [Library · drafts](https://doop.design/c/rVpXoBmrqv?frame=9Jmr_gMPW6) | `9Jmr_gMPW6` |

### History
Past days: a week strip, the day's totals and the meal list. Covers DIA-01, DIA-04, DIA-05 and DIA-07.

Days are marked complete or partial, and only complete days count toward averages. Copy, move and the complete/partial switch open as anchored popovers.

| Frame | ID |
| --- | --- |
| [History](https://doop.design/c/rVpXoBmrqv?frame=mNfBFsh-hZ) | `mNfBFsh-hZ` |
| [History · Mon 16](https://doop.design/c/rVpXoBmrqv?frame=e_feI9SBie) | `e_feI9SBie` |
| [History · edit entry](https://doop.design/c/rVpXoBmrqv?frame=J4zNfovCiz) | `J4zNfovCiz` |
| [History · meal actions](https://doop.design/c/rVpXoBmrqv?frame=HIL5J1UoB-) | `HIL5J1UoB-` |
| [History · day actions](https://doop.design/c/rVpXoBmrqv?frame=0XrJU3i-kv) | `0XrJU3i-kv` |
| [History · add](https://doop.design/c/rVpXoBmrqv?frame=6UyQOEiWua) | `6UyQOEiWua` |
| [History · select](https://doop.design/c/rVpXoBmrqv?frame=JgZ45N98YZ) | `JgZ45N98YZ` |

### Progress
Calorie and macro averages, and weight with a smoothed trend. Covers PROG-01–03 and DIA-07.

- **Range:** W, M, 3M or Y, and the macros follow the selected range.
- **Averages:** computed over complete days only, with partial days hatched.
- **Target line:** it steps where the target changed, and tapping the step explains why.
- **Weight:** an exponential moving average at 25% per weigh-in, seeded with the mean of the first 3 weigh-ins. The ⓘ button explains the smoothing.
- **Weigh-in:** typed on the in-card keypad.

| Frame | ID |
| --- | --- |
| [Progress](https://doop.design/c/rVpXoBmrqv?frame=oYBTLSLm4C) | `oYBTLSLm4C` |
| [Progress · week](https://doop.design/c/rVpXoBmrqv?frame=HoqKRqSo_e) | `HoqKRqSo_e` |
| [Progress · day](https://doop.design/c/rVpXoBmrqv?frame=Vb1P8YRMt-) | `Vb1P8YRMt-` |
| [Progress · target change](https://doop.design/c/rVpXoBmrqv?frame=lL_Tomo9kO) | `lL_Tomo9kO` |
| [Progress · weigh-in](https://doop.design/c/rVpXoBmrqv?frame=mUf17m6tWw) | `mUf17m6tWw` |
| [Progress · trend info](https://doop.design/c/rVpXoBmrqv?frame=CCLiodhTKY) | `CCLiodhTKY` |

### Settings
Goal and targets, units, meal sections and reminders, on one screen with controls in place. Covers ONB-03–09, DIA-01 and PRIV-06.

- **Goal:** Lose, Maintain, Gain or Observe. Observe turns targets off.
- **Targets:** edited on the keypad in place.
- **Estimate card:** shows the equation, its inputs and the activity factor. Sex is asked for as an input to the equation and never inferred.
- **Floor:** a neutral notice appears below the 1,500 kcal floor.
- **Units:** kcal↔kJ converts in place.
- **Meals:** sections can be renamed and reordered.
- **Reminders:** off by default.

ChatGPT and Data & privacy open as their own pages.

| Frame | ID |
| --- | --- |
| [Settings](https://doop.design/c/rVpXoBmrqv?frame=eG_HYPtbXd) | `eG_HYPtbXd` |
| [Settings · target keypad](https://doop.design/c/rVpXoBmrqv?frame=3rW-_f-xG7) | `3rW-_f-xG7` |
| [Settings · estimate](https://doop.design/c/rVpXoBmrqv?frame=DMIVdS4MmV) | `DMIVdS4MmV` |
| [Settings · floor](https://doop.design/c/rVpXoBmrqv?frame=YiFOPUqoNF) | `YiFOPUqoNF` |
| [Settings · observe](https://doop.design/c/rVpXoBmrqv?frame=j8s-uIudps) | `j8s-uIudps` |
| [Settings · meals edit](https://doop.design/c/rVpXoBmrqv?frame=sL6bONGgsl) | `sL6bONGgsl` |

### ChatGPT
The AI connection page. Covers AI-02, AI-04, AI-21–25 and SYNC-04.

- **Before connecting:** it shows which plans are eligible, that the plan allowance is shared with the user's other ChatGPT use, and what happens when the allowance runs out.
- **Consent:** using the plan has its own checkbox, separate from sign-in.
- **Once connected:** a model picker whose camera icon marks models that accept images, plus Manage usage, Reconnect, and Sign out (which revokes the token).
- **API key:** an alternative path. The key stays on the device and usage is billed to its owner.
- **Disconnecting** deletes nothing.

| Frame | ID |
| --- | --- |
| [ChatGPT](https://doop.design/c/rVpXoBmrqv?frame=wtlbRuHTFC) | `wtlbRuHTFC` |
| [ChatGPT · connected](https://doop.design/c/rVpXoBmrqv?frame=trfz5x_KIa) | `trfz5x_KIa` |
| [ChatGPT · models](https://doop.design/c/rVpXoBmrqv?frame=bpOjBvHq3g) | `bpOjBvHq3g` |
| [ChatGPT · key](https://doop.design/c/rVpXoBmrqv?frame=gJKMOcJjPB) | `gJKMOcJjPB` |
| [ChatGPT · sign out](https://doop.design/c/rVpXoBmrqv?frame=ZEc6cb9ib1) | `ZEc6cb9ib1` |

### Data & privacy
Covers HLTH-01/02/04, SYNC-02/04–08/10, IMP-02/03 and PRIV-01/02/04.

- **Apple Health:** per-type write and read chips. Exercise is only added to the target if the user opts in.
- **Sync:** sync status and photo retention.
- **Export:** JSON or CSV, never including keys.
- **Import:** a preview of what will come in, how fields map and what is skipped.
- **What's sent where:** a plain-language list that is always visible.
- **Analytics:** opt-in only.
- **Delete account:** confirms in place.

| Frame | ID |
| --- | --- |
| [Data & privacy](https://doop.design/c/rVpXoBmrqv?frame=2FstoZmz2h) | `2FstoZmz2h` |
| [Data & privacy · import preview](https://doop.design/c/rVpXoBmrqv?frame=X7j5HtSjfZ) | `X7j5HtSjfZ` |
| [Data & privacy · sent where](https://doop.design/c/rVpXoBmrqv?frame=MuRvrOokdd) | `MuRvrOokdd` |
| [Data & privacy · delete confirm](https://doop.design/c/rVpXoBmrqv?frame=KNzFeugnTJ) | `KNzFeugnTJ` |
| [Data & privacy · steps on](https://doop.design/c/rVpXoBmrqv?frame=PiCphWBc4I) | `PiCphWBc4I` |

### Onboarding
The first session from PRD section 9. Covers ONB-01, ONB-02, ONB-05 and ONB-09.

The flow is: confirm 18+, choose a goal, accept the estimate, log a first food, land on Today. It is 3 taps to a target. There is no account or AI before the first log; sync and ChatGPT are offered afterwards. The last two screens are the real Today, with an empty day and no learned suggestions. A barcode button replaces camera and mic because AI isn't connected yet.

| Frame | ID |
| --- | --- |
| [Onboarding · age](https://doop.design/c/rVpXoBmrqv?frame=lLPQn8Fy0F) | `lLPQn8Fy0F` |
| [Onboarding · goal](https://doop.design/c/rVpXoBmrqv?frame=8CceFrd0TG) | `8CceFrd0TG` |
| [Onboarding · target](https://doop.design/c/rVpXoBmrqv?frame=R25Q9ArLew) | `R25Q9ArLew` |
| [Onboarding · first food](https://doop.design/c/rVpXoBmrqv?frame=09RHq1Tq19) | `09RHq1Tq19` |
| [Onboarding · first day](https://doop.design/c/rVpXoBmrqv?frame=KgVE_T0QjL) | `KgVE_T0QjL` |

### Barcode and custom food
Covers FOOD-01, FOOD-02, FOOD-05, FOOD-12, CALC-02, CALC-06 and CALC-07.

- **Scan or type:** you can scan, or type the barcode on a digits-only keypad.
- **Found:** the product card appears where the barcode was, showing its source and basis. Label energy is kept as published.
- **Not found:** the card leads to a custom food tied to that barcode.
  - Saving and logging takes one meal tap.
  - Missing nutrients show as "unknown", never 0.
  - Scanning the same barcode again finds "Your food".

| Frame | ID |
| --- | --- |
| [Barcode · scan](https://doop.design/c/rVpXoBmrqv?frame=GhAe9s6RJ9) | `GhAe9s6RJ9` |
| [Barcode · found](https://doop.design/c/rVpXoBmrqv?frame=4wTrYOCQJG) | `4wTrYOCQJG` |
| [Barcode · type](https://doop.design/c/rVpXoBmrqv?frame=uGFTIWO9ff) | `uGFTIWO9ff` |
| [Barcode · not found](https://doop.design/c/rVpXoBmrqv?frame=uytku0drJb) | `uytku0drJb` |
| [Custom food · new](https://doop.design/c/rVpXoBmrqv?frame=TOGYv0ouDl) | `TOGYv0ouDl` |
| [Custom food · rescan](https://doop.design/c/rVpXoBmrqv?frame=Ku6pri2ZgF) | `Ku6pri2ZgF` |

### Recipe
Covers REC-01, REC-02, REC-03, REC-07 and FOOD-04.

- **The recipe:** ingredients with their source tags, amounts edited in place, cooked weight and servings.
- **Batches:** a cooked batch is separate from its recipe and marks its differences ("30 g ≠ 20 g").
- **Logging:** from a batch, by portion, in 2 taps.
- **Edits** apply to new logs only.
- **Sharing:** only behind the ⋯ menu.

| Frame | ID |
| --- | --- |
| [Recipe · Dal tadka](https://doop.design/c/rVpXoBmrqv?frame=Xv4PKCFbVc) | `Xv4PKCFbVc` |
| [Recipe · amount edit](https://doop.design/c/rVpXoBmrqv?frame=GYPHhv55af) | `GYPHhv55af` |
| [Recipe · batch](https://doop.design/c/rVpXoBmrqv?frame=fsZf3PPh6c) | `fsZf3PPh6c` |
| [Recipe · log](https://doop.design/c/rVpXoBmrqv?frame=djGhrc7J0p) | `djGhrc7J0p` |
| [Recipe · add ingredient](https://doop.design/c/rVpXoBmrqv?frame=0R4t_LgUqd) | `0R4t_LgUqd` |
| [Recipe · new batch](https://doop.design/c/rVpXoBmrqv?frame=Q1pZxecPvc) | `Q1pZxecPvc` |

## 4. Navigation

- The bottom nav is shared: Today, History, Progress and Library.
- Settings opens from the gear in History and in Library. ChatGPT and Data & privacy open from rows in Settings.
- The camera in Today switches between Photo and Barcode.
- A Library recipe row has "Open recipe ›".
- Settings' back arrow uses the prototype's history-back action. ChatGPT and Data & privacy link back to Settings.

## 5. Mock data

The prototypes share one consistent data set, so numbers agree across screens.

**Days.** History is the source of truth.

| Day | Status | kcal | Protein | Carbs | Fat |
| --- | --- | --- | --- | --- | --- |
| Mon 16 Nov | Complete | 2,050 | 76 g | 298 g | 56 g |
| Tue 17 Nov (today) | Partial | 1,240 | 82 g | 142 g | 38 g |

AI drafts on Tue 17 add 437 kcal: Whole wheat roti, 2 rotis, 240 kcal (you said), and Dal tadka, ≈197 kcal (estimate range 120–180 g). After confirming, the day is at 1,677 of 2,200, with 523 kcal left.

**Averages over the 30 days from 19 Oct to 17 Nov.** These use the 27 complete days.

| Range | kcal per day | Protein | Carbs | Fat |
| --- | --- | --- | --- | --- |
| Month | 2,140 | 103 g | 274 g | 70 g |
| Week of 16–22 Nov (1 complete day) | 2,050 | 76 g | 298 g | 56 g |

**Targets (Settings).** 2,200 kcal; protein 140 g, carbs 250 g, fat 75 g, fiber 30 g. The macros add up to 2,235 kcal.

**Weight.** The trend is an exponential moving average at α = 0.25 per weigh-in. It is 73.1 kg today and falling 0.4 kg a week (14-day rate). With these weigh-ins, 7 dots sit above the trend line and 13 below.

**Estimate.** Uses Mifflin–St Jeor:

| Step | Value |
| --- | --- |
| BMR = 10 × 73.1 + 6.25 × 172 − 5 × 31 + 5 | 1,656 |
| × 1.55 (moderate activity) | 2,567 |
| − 440 for a 0.4 kg/week loss | 2,127, rounded to 2,130 kcal |

There is a 1,500 kcal floor and a cap of 1% of body weight per week. In kJ, the target shows as 9,205 and the estimate as 8,912. For a new user, the onboarding macro split is protein 140 g, carbs 235 g and fat 70 g.

**Recipe: Dal tadka (IFCT values).** The recipe makes 943 kcal; the batch is a separate cook with more ghee.

| | Recipe | Batch, Sun 15 Nov |
| --- | --- | --- |
| Ghee | 20 g | 30 g |
| Total energy | 943 kcal | 1,033 kcal |
| Protein / carbs / fat | 48 / 142 / 24 g | 48 / 142 / 34 g |
| Cooked weight | 1,050 g | 1,180 g |
| Portion | Per serving (¼): 236 kcal | 1 katori (150 g): 131 kcal |

**Barcode.** The found product is Amul Taaza Toned Milk, 58 kcal per 100 ml (Open Food Facts), so 1 glass of 200 ml is 116 kcal. The custom food is Millet cookies:

| Field | Value |
| --- | --- |
| Barcode | 8906012345678 |
| Energy | 480 kcal per 100 g |
| 1 cookie | 12 g |
| 2 cookies | 115 kcal |
| Sugar | unknown |

## 6. Open items

- **Desktop and web two-pane layouts (PLAT-02, PLAT-03).** Required for the M1 targets Windows and web. The proposal:
  - a left nav rail, a middle list and a right detail pane, at 1280×800;
  - the right pane takes over what opens inline on the phone;
  - full keyboard use.
- **"Manage usage ↗"** in ChatGPT has no URL yet.
- **"Sync across devices"** on Onboarding · first day isn't linked to a flow; sign-in and sync setup aren't designed.
- **Water logging, food preferences and the competitor import format** (DIA-08, ONB-10, IMP-01) can be designed alongside the build.
