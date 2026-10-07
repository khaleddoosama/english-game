# حصر استخدامات AI في Word Hunter

تاريخ المراجعة: 7 أكتوبر 2026.

المصدر: مراجعة الكود الفعلي في `khaleddoosama/english-game`، وليست قائمة مستنتجة من تصميم اللعبة.
النسخة الأساسية: فرع `master`، commit `f2a2b0dbdec5d23fb9a57aa3daba6ab3085e9252`.
رُوجع أيضًا فرع `feature/personal-library-friends` لحصر الميزات الخاصة بالمكتبة الشخصية. وجود الميزة في الفرع لا يثبت أنها منشورة على رابط dev حاليًا.

## النتيجة

18 مهمة AI نصية مسجلة في النسخة الأساسية، واستخدام للنطق عبر Gemini، واستخدامان إضافيان في فرع المكتبة الشخصية: 21 نوعًا من الاستخدام إجمالًا. بعض المهام تظهر من أكثر من شاشة، لذلك عدد الأزرار ليس هو عدد المهام.

## استخدامات اللاعب في النسخة الأساسية

| # | الاستخدام وأين يظهر | ما يفعله AI | الدالة والملف | اسم المهمة |
|---|---|---|---|---|
| 1 | البحث عن كلمة، Ask AI داخل السؤال، والضغط على كلمة في نص السؤال أو القصة | شرح المعنى، مثال، gap، النطق المكتوب، كلمات قريبة والفروق والأخطاء الشائعة. يستخدمه أيضًا محرر الكلمات وشاشة Words لدى الإدارة | `askAiForWord` في `src/engine/ai.js`؛ الواجهة في `src/app/WordHunter.jsx` و`src/features/session/SessionView.jsx` | Ask AI about a word |
| 2 | كتابة جملة أو إجابة حرة، ومنها أسئلة التحويل | تقييم الاستخدام الدلالي والنحو والطبيعية، وقبول صيغ صحيحة مختلفة عن النموذج | `evaluateFreeForm` في `src/engine/ai.js`؛ المستدعون في WordHunter وSessionView | Check a written answer |
| 3 | كتابة إجابة مختلفة عن الإجابة النموذجية، ومنها أسئلة gaps | فحص صلاحية الإجابة البديلة في سياق السؤال، بدل رفضها بالمطابقة النصية فقط | `evaluateAlternativeGap` في `src/engine/ai.js`؛ WordHunter وSessionView | Check another word in a gap |
| 4 | Final Case / التقرير النهائي | تقييم استخدام كل كلمة مطلوبة في النص النهائي | `evaluateFinalReport` في `src/engine/ai.js`؛ WordHunter | Check a final case report |
| 5 | Grammar Court / تصحيح جملة | الحكم على صحة التصحيح وقبول التصحيحات البديلة | `evaluateGrammarCorrection` في `src/engine/ai.js`؛ WordHunter | Grammar court |
| 6 | شرح الإجابة الخطأ في مسار اللعب | شرح الفرق بين الكلمة المختارة والكلمة الصحيحة في السياق | `explainWrongLead` في `src/engine/ai.js`؛ WordHunter | Explain a wrong answer |
| 7 | Report question أثناء التدريب؛ ومراجعة البلاغ من الإدارة | تحديد هل السؤال معيب، متكرر، صحيح أو غير محسوم؛ فحص إجابة اللاعب واقتراح إصلاح عند الحاجة | `reviewReportedQuestion` في `src/engine/ai.js`؛ `reviewQuestionReport` في WordHunter؛ SessionView وAdmin Reports | Review a reported question |
| 8 | تنويع أسئلة Combo في الخلفية | إنشاء سؤال جديد لمجموعة الكلمات | `generateComboVariant` في `src/engine/ai.js`؛ WordHunter | New combo question |
| 9 | تنويع أسئلة الجرامر في الخلفية | إنشاء نسخة جديدة لسؤال القاعدة مع تجنب الأسئلة المستخدمة | `generateGrammarVariant` في `src/engine/ai.js`؛ WordHunter | New grammar question |
| 10 | توسيع مخزون التدريب في الخلفية | توليد جمل gaps ومواقف وتلميحات أو تحويلات وفق الطلب ومخزون السؤال | `generateContent` في `src/engine/ai.js`؛ `triggerGeneration` في WordHunter | Write new practice sentences |
| 11 | فحص ما وُلّد في الاستخدام السابق | مراجعة الجودة والغموض وتسريب الإجابة ورفض المتغيرات الضعيفة | `validateGeneratedContent` في `src/engine/ai.js`، يستدعيها مسار generateContent | Check new practice sentences |

## استخدامات الإدارة في النسخة الأساسية

| # | الاستخدام وأين يظهر | ما يفعله AI | الدالة والملف | اسم المهمة |
|---|---|---|---|---|
| 12 | استيراد المحتوى / إصلاح JSON فشل في التحقق | إصلاح أخطاء الصياغة والحقول المبلغ عنها مع وصف التغييرات قبل التطبيق | `aiFixImportJson` في `src/engine/ai.js`؛ WordHunter وواجهة ImportExport عبر dataTools | Fix an import file |
| 13 | Admin → Reports | اقتراح تغيير محدود في المحتوى المصدر لإصلاح بلاغ، مع إبقاء word/id | `suggestReportFix` في `src/engine/ai.js`؛ `src/features/admin/sections/Reports.jsx` | Suggest a fix for a report |
| 14 | Admin → Categories | اقتراح دمج أسماء تصنيفات متطابقة في المعنى ومختلفة في الكتابة | `suggestCategoryMerges` في `src/engine/ai.js`؛ `src/features/admin/sections/Categories.jsx` | Suggest category merges |
| 15 | Content health | معالجة المثال، المعنى الضعيف، التعريفات المتطابقة، الخطأ الشائع المفقود، partsOfSpeech المفقودة، وفحص غموض gaps | `aiFixWordBatch` في `src/engine/ai.js`؛ `src/features/admin/ContentHealthPanel.jsx` | Content health fix |
| 16 | بطاقة تقديم كلمة جديدة → Regenerate meaning & example؛ الزر مشروط بصلاحية التعديل | إعادة كتابة المعنى والمثال؛ يظهر اقتراحًا يختار المستخدم تطبيقه أو تجاهله | `regenerateWordExplanation` في `src/engine/ai.js`؛ SessionView | Rewrite a word |
| 17 | إنشاء قصة | كتابة قصة بالكلمات المختارة وأسئلة عليها وأسئلة جرامر؛ توجد فحوص محلية وإعادة محاولة عند مشاكل معينة | `generateStory` في `src/engine/ai.js`؛ WordHunter | Write a story |
| 18 | محرر قواعد الجرامر → توليد أسئلة | توليد choose / judge / fix مرتبطة بالقاعدة والكلمات المحددة | `generateGrammarQuestions` في `src/features/admin/editors/grammarRules.js`؛ GrammarEditor | Write grammar questions |

صلاحيات هذه المهام يفرضها السيرفر في `api/_lib/tasks.js`؛ قيمة adminOnly القادمة من المتصفح وحدها لا تمنح صلاحية.

## النطق

| # | الاستخدام | التنفيذ |
|---|---|---|
| 19 | Listen / نافذة النطق | `speechUrl` في `src/lib/ai.js` → `/api/tts` → `speak` في `api/_lib/gemini.js`. توليد صوت Gemini عند الحاجة، مع cache. واجهة النطق في `src/features/media/media.jsx` تحتوي أيضًا مسارات تسجيلات القاموس ونطق المتصفح، وهما ليسا استدعاء Gemini |

## إضافات فرع المكتبة الشخصية فقط

| # | الاستخدام | السلوك ومكان التنفيذ |
|---|---|---|
| 20 | إضافة كلمة إلى مكتبتي، بما فيها إدخال عدة كلمات من الواجهة | إذا كانت الكلمة موجودة تُضاف للمكتبة دون AI. إذا لم توجد يولّد AI المحتوى ثم يُتحقق منه ويُحفظ. `api/library-word.js`، و`api/_lib/vocabulary.js`، والواجهة `src/features/library/LibraryPage.jsx`. المهمة: Add a word to my library |
| 21 | إنشاء أو توسيع تدريب جرامر شخصي | توليد قاعدة وأسئلة وفق الموضوع والأنواع والعدد، مع التحقق قبل الإرجاع للواجهة. `api/library-grammar.js`، و`api/_lib/grammar.js`، والواجهة `src/features/library/PersonalWorkspace.jsx`. المهمة: Write my grammar practice |

## مسار AI المشترك

1. معظم استخدامات النص تمر من `src/engine/ai.js` إلى `callAiText` في `src/lib/ai.js` ثم `/api/ai`.
2. السيرفر يتحقق من المهمة والصلاحية وحدود الاستخدام عبر `api/_lib/tasks.js` و`api/_lib/gate.js`.
3. `generateJsonText` و`generateWithFallback` في `api/_lib/gemini.js` يرسلان الطلب إلى Gemini مع بدائل وإعادة محاولة للأخطاء المؤقتة.
4. التسجيل ومدة الطلب والحالة والاستهلاك يُعرضون في Admin → AI usage، عبر `src/features/admin/sections/AiLog.jsx`. هذه شاشة مراقبة وليست طلب AI إضافيًا.
5. فرع المكتبة الشخصية يستدعي Gemini من endpoints مستقلة، ويستخدم نفس بوابة الاستخدام ومكتبة Gemini.

## ما لا يُحسب استخدام AI

- الاختيارات والتقييم المحلي بالمطابقة النصية وحساب الإتقان والتقدم.
- الأصدقاء والدعوات والتحديات الحية في الكود الذي تمت مراجعته.
- رفع الصور وضغطها واستيراد رابط صورة: `/api/image-import` يستخدم بوابة الاستخدام والتسجيل لكن لا يستدعي Gemini.
- تسجيلات dictionaryapi.dev وspeechSynthesis داخل المتصفح.
- ملف `legacy/word_hunter_v6.3.jsx` يحتوي نسخة أرشيفية منفصلة؛ لا يُحسب ضمن التطبيق الحالي الذي يبدأ من `src/main.jsx`.

## مشكلة الشاشة المرفقة: نتائج الفحص قبل الإصلاح

- في `src/features/session/SessionView.jsx`، حالة `reportReview.status === 'reviewing'` تعرض الانتظار دون زر إغلاق.
- الضغط خارج النافذة ممنوع صراحة أثناء reviewing.
- `onReviewReport(report)` يغيّر الحالة فقط بعد انتهاء Promise، فلا توجد مهلة مستقلة لهذه الشاشة.
- `src/lib/ai.js` لا يضع timeout على طلب AI؛ وقد يعلق انتظار المصادقة أو الاتصال أو قراءة الرد.
- السيرفر لديه ميزانية 40 ثانية لإعادة المحاولة، لكنه يفحصها بين المحاولات. طلب fetch واحد أو قراءة جسم الرد قد يتجاوزها لعدم وجود قطع فعلي.
- لا يمكن إثبات سبب تعليق طلبك بالتحديد من الصورة وحدها؛ هذه عيوب مؤكدة في الكود تسمح بالتعليق وتحجب إمكانية الإغلاق.

## متطلبات المعالجة

- زر Close / Continue متاح فورًا أثناء المراجعة، مع الإغلاق من الخلفية وEscape.
- إغلاق النافذة يترك البلاغ محفوظًا والسؤال مستبعدًا من الإتقان؛ لا يلغي البلاغ.
- مهلة فعلية للطلب تشمل المصادقة والاتصال وقراءة الرد، وتحرير حالات loading عند الخطأ.
- قطع فعلي على السيرفر لكل محاولة وميزانية كلية حتى لا تستمر البدائل بلا حد.
- تجاهل نتائج المراجعات القديمة في النافذة بعد إغلاقها أو الانتقال لسؤال آخر.
- الاختبارات تشمل طلبًا لا ينتهي، وتعليق قراءة الرد، وفشل الشبكة، وخروج اللاعب أثناء المراجعة.

هذا الملف يوثق الحصر والحالة قبل الإصلاح. لا يثبت نشر أي تعديل أو تشغيل اختبارات الإصلاح.
