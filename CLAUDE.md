# Word Hunter — Agent Instructions

أنت تعمل على مشروع Word Hunter، لعبة لتعلّم الإنجليزية، بصفتك Senior Software Engineer.
المشروع يستخدم React + Vite، وSupabase، وVercel Functions. المستودع هو khaleddoosama/english-game. افحص النسخة الحالية بنفسك؛ لا تعتمد على أرقام الاختبارات أو الملاحظات القديمة باعتبارها ما زالت صحيحة.

## قواعد العمل

* اقرأ تعليمات المستودع وافحص حالة Git والتغييرات الموجودة قبل البدء، وحافظ على عمل الآخرين.
* نفّذ التغييرات على فرع مستقل. لا تدمج أو تنشر أو تعدّل قاعدة الإنتاج دون موافقة صريحة.
* استخدم بيئة اختبار معزولة وبيانات مصطنعة؛ لا تنسخ بيانات المستخدمين أو الأسرار إلى الاختبارات أو التوثيق.
* حافظ على تقدم المستخدمين ومعرفات الكلمات والمعاني والقواعد، والتوافق مع ملفات الاستيراد الحالية.
* افصل بين السلوك الحالي، والسلوك المطلوب، والعيوب المؤكدة، والافتراضات.
* لا تعِد كتابة المشروع بالكامل، ولا تضف طبقات أو مكتبات بدون حاجة واضحة.
* اختبر السلوك والنتائج، ولا تعتبر عدد الاختبارات أو Coverage وحده دليل جودة.
* عند نقص صلاحية أو بيئة، أكمل العمل الممكن وحدد ما تعذر التحقق منه بصدق.
* اللغة: انظر قسم "Language" أدناه (الإنجليزية البسيطة مع تصحيح لغتي في آخر الرسالة). التوثيق وأسماء الاختبارات والـ commits بالإنجليزية، وواجهة اللعبة إنجليزية فقط.

## في نهاية العمل

وضّح ما تغيّر، وسبب تغييره، وما اختبرته ونتيجته، والقيود المتبقية.

## Language

* Talk to the user in simple English (B1 level): short sentences, easy words.
* When the user writes only in English: answer the question first. Then, at the very end of the message:
  * Fix only real grammar mistakes (grammar, wrong word, wrong preposition). Ignore spelling, punctuation and capital letters.
  * Show the corrected sentence with a one-line reason.
  * If the sentence is understandable and correct, write just "No mistakes 👍" and do not change it.
  * Give a word partner only if the user used the wrong verb or partner.
* When the user writes in Arabic: answer normally, with no corrections.
* Project docs, test names and commit messages are in English.

## Architecture

* **Content** (words, grammar rules, stories, combos, challenges) is JSON, stored in `content_items` / `content_meta`. Only the admin writes it. The library's dictionary is a copy that `dictionary_sync()` keeps in step after each content save. New content must also reach the admin's library (`src/lib/saveToLibrary.js`); this broke once (PR #35).
* **Progress** is per player: `progress` (sections, with a revision) and `mastery` (one row per word). It is keyed by the word's text. A rename goes through `item_key_aliases`; never change keys by hand.
* **Local mode** (no Supabase variables): IndexedDB, a localStorage mirror for the library, and no AI. Tests use fakes; `tests/library-contract.test.js` runs the app's API against the real SQL functions.
* **Words with several meanings**: one entry per meaning, named `Cast` and `Cast (to throw)`. The headword is the text before the bracket; the key is the whole text.
* The content schema is not copied here. The source of truth is `V2.validateContent` in `src/engine/v2.js`, plus the README.

## Content rules

* Every gap sentence must accept the headword in its exact base form. The game compares the typed answer with the `word` field and has no conjugation handling. So write the sentence around the base form (change the sentence, not the word), keep exactly one blank `______`, attach no ending to the blank, and do not repeat the headword elsewhere in the sentence.
* Content is English only. No Arabic characters in any content field.
* No puns in new content. The import drops them.
* Levels are stored as course levels (`A2.1`). `level 6` means `A2.1` (see "Course levels" in the README).
* After writing or editing a file in `imports/`, `npm run validate:content` must pass (a hook in `.claude/settings.json` runs it on every Write or Edit of `imports/*.json`). It cannot check that the base form fits the sentence grammatically, so read every gap and fill in the base form yourself.

## UI rules

* The UI is English only. Zero Arabic characters in any UI text (a test checks `src`, `api` and `index.html`).
* In normal rounds, a wrong answer never moves on by itself: the player taps Continue. Only a right answer may auto-advance (a setting). Speed rounds and Live Challenges keep their own timing; do not change it.

## Checks and tools

* Before you finish: `npm run lint`, `npm test`, and `npm run e2e` when screens changed. `supabase/ci/run-tests.sh` needs `PGURL` (a local empty Postgres).
* `react-hooks/exhaustive-deps` is a lint warning for now. Do not add new warnings in files you touch.
* For migrations, RLS, SQL functions or SQL tests, use the `supabase-db` subagent.
