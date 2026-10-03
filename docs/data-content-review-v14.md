# مراجعة الداتا فقط — Supabase version 14

فُحصت نسخة حية من public.content_items وcontent_meta بتاريخ 3 أكتوبر 2026، وفق الملفين game details.txt و05-My-Details.txt. لا توجد تغييرات في قاعدة البيانات أو الواجهة أو تقدم المستخدم. أحدث تحديث للنسخة: 2026-10-03T18:41:15Z.

## النتيجة

المحتوى قابل للتحميل، لكنه يحتاج إصلاحًا قبل اعتباره محتوى تعليميًا معتمدًا. نجاح مخطط JSON لا يثبت صحة اللغة أو عدالة السؤال. تمت مراجعة المعاني والفراغات الأساسية لجميع الكلمات، والقواعد التسع والقصة، مع فحص آلي للحقول والعلاقات. لم يُراجع كل حقل فرعي لغويًا كلمةً بكلمة؛ مثل جميع hints وcommonMistakes وgaps البديلة.

257 كلمة، 9 قواعد، قصة واحدة. كل الكلمات تحتوي meaning وgap وsituation وunits. لا تكرار في مفاتيح word بعد تجاهل حالة الأحرف. مخطط v2 المتوافق مع التشغيل نجح بلا أخطاء. جميع الفراغات الأساسية والبديلة المفحوصة تحتوي ______ مرة واحدة. لا مراجع مفقودة في excludeFromSameOptionsWith، ولا ترميز تالف أو حروف عربية في السجلات المفحوصة. لا تسريب حرفي للإجابة في meaning/gap حسب فحص التطبيع السابق؛ وليس فحصًا دلاليًا لكل سؤال.

## النواقص المؤكدة

- 19 كلمة بلا level، مقابل 20 في version 13. ligament أصبح A2.2/Common-Health-Problems.
- 19 عبارة بلا partsOfSpeech. توجد كذلك أنواع شائعة ناقصة في سجلات أخرى؛ أمثلة مؤكدة أدناه.
- 128 situation لا تحتوي النص المتصل للكلمة. هذا ليس عدد الأخطاء اللغوية. ثمانية منها على الأقل تصريف/تغيير ترتيب سليم: Ache، Blow up، butter someone up، have a sweet tooth، Benign tumor، Malignant tumor، Stay up، Zone out. بقية الحالات تحتاج مثال استعمال واضح وفق شرط الملف، مثل Acrophobia وAfraid وMeticulous؛ مواقفها الاستنتاجية مفيدة ولكن لا تؤدي وحدها وظيفة مثال الاستعمال.
- 121 كلمة بلا id، وهي ليست خطأ تشغيل حاليًا لأن word مفتاح التقدم. يُعالج هذا عند اعتماد مخطط جديد، دون تغيير word.

## تصحيحات لغوية وأسئلة

| العنصر | الموجود | المعالجة المقترحة |
| --- | --- | --- |
| Afraid | meaning وhint يقولان always followed by of | حذف التعميم؛ تقبل of وto-infinitive وthat-clause. |
| Upset | adjective/noun فقط | إضافة verb وفق شرط تسجيل الاستخدامات الشائعة. |
| Sprain | noun فقط، والمثال He sprained… | إضافة verb. |
| Sneeze | verb فقط | إضافة noun. |
| Referee | noun فقط | إضافة verb. |
| butter someone up | فراغان يقبلان كلمة someone العامة بدل الشخص المقصود | الأول: She brought coffee to people at work to ______ before asking for favours. ولو المطلوب her boss تحديدًا، يجب أن تدعم الإجابات butter her boss up بدل رفضها؛ لا نغير word. |
| Fish memory | بطاقة تعامل التعبير كعبارة معيارية | يحتاج مراجعة مصدر الكورس؛ الصياغة التعليمية المقترحة a memory like a goldfish. لا نغير word لأنه مفتاح التقدم، ولا نقرر أن عدم وجود مدخل قاموسي يثبت الخطأ. |
| Elbow.collocationChecks | He ______ his elbow on the door and it really hurt. ومن wrong كلمة touched | touched ممكنة لغويًا إذا كان الكوع مصابًا؛ استبدالها باختيار خاطئ واضح مثل listened، أو إضافة سياق اصطدام أوضح. |
| so that + can/could | بعض أسئلة الحكم تعتبر الماضي + can خطأ دائمًا | إبقاء التبسيط كنمط شائع، ومراجعة أسئلة الحكم المطلقة؛ الماضي الرئيسي لا يكفي وحده لتحديد زمن الغرض إذا كان الغرض مستمرًا الآن. إعادة صياغة السياق بحيث يكون الغرض ماضيًا منتهيًا. هذه ملاحظة للمراجعة وليست حكمًا بأن جميع أسئلة القاعدة خاطئة. |
| قصة The Secret Recipe / Flu | أعراض تظهر ساعة بعد تناول مسحوق مجهول، والإجابة Flu | تغيير السياق إلى مرض موضح أو مشخص في القصة. لا نستنتج إنفلونزا من أعراض عامة أو نربطها سببيًا بمسحوق. مثال مؤلف بديل: Earlier that week, a doctor had diagnosed the patient with flu. He still had a fever and body aches. |
| القصة / Terrifying | السؤال عن الحالة العاطفية لشخص، والإجابة صفة تصف الشيء المخيف | السؤال المقترح: Which word best describes the frightening experience Liam witnessed? |
| القصة / text | He kept ______ the lock… فراغ بلا سؤال مطابق ظاهر | إكمال النص: He kept checking the lock… أو تأليف سؤال مرتبط بالفراغ وإجابة محددة؛ لا نترك نص القراءة ناقصًا. |

المصادر اللغوية للتحقق: [Afraid — Cambridge](https://dictionary.cambridge.org/grammar/british-grammar/afraid)، [Upset](https://dictionary.cambridge.org/dictionary/english/upset)، [Sprain](https://dictionary.cambridge.org/dictionary/english/sprain)، [Sneeze](https://dictionary.cambridge.org/dictionary/english/sneeze)، [Referee](https://dictionary.cambridge.org/dictionary/english/referee)، [butter someone up](https://dictionary.cambridge.org/dictionary/english/butter-up). المقترحات الإنجليزية الجديدة مؤلفة لهذه المراجعة.

## العلاقات تحتاج تقييد المعنى

| العلاقة الحالية | الملاحظة | المعالجة |
| --- | --- | --- |
| Avoid ↔ Bring up | ليست أضدادًا عامة؛ يمكن التقابل عند avoid a topic فقط | حذف opposite العام أو تقييده بمعنى السياق في مخطط معتمد. |
| Satisfied ↔ Disappointed | dissatisfied هو التضاد المباشر، الموجود بالفعل في antonyms | توحيد الحقلين حول التضاد المباشر، بعد تحديد سياسة العلاقة. |
| Playoffs ↔ regular season | مرحلتان في بطولة، وليستا تضادًا لغويًا | إزالة antonym وتوثيق علاقة مراحل إذا لزم. |
| Dietitian / Nutritionist | تقارب مجال العمل لا يضمن تطابق المؤهلات أو المعنى | إبقاء منع الجمع في الاختيارات العامة، ومراجعة وصفهما كمرادفين تامين. |
| Cure / Heal، Dizzy / Lightheaded | المعاني تتداخل ولا تتطابق في كل السياقات | إبقاء منع الالتباس؛ لا تُستخدم العلاقات وحدها لإثبات إجابة واحدة. |
| ADHD والمخاوف المرضية | المواقف القصيرة لا تثبت تشخيصًا | عند عرضها كتعريف تعليمي أو سؤال، أضف سياقًا واضحًا أو تشخيصًا في القصة بدل الاستنتاج من عرض واحد. |

## المنهج والتوزيع

ملاحظة content_meta توضّح أن fractional levels مراحل Gateway: Level-4=A1.2، Level-5=A1.3، Level-7=A2.2، Level-8=A2.3، Level-9=B1.1، وأن Sports وBody-Parts عند A2 خارج هذه الجلسات. لا نحكم على CEFR من هذه التسميات. لا نضيف وحدات وهمية للوصول إلى 6–7، ولا نخمن المرحلة للكلمات غير المسندة.

level_order الحالي يحتوي أسماء درسين Health & Body وEmotions & Psychology؛ لذلك يحتاج تحديد المقصود قبل استخدامه لترتيب مراحل الكورس.

| المرحلة | الوحدات | الكلمات | القواعد |
| --- | --- | ---: | ---: |
| A1.2 | Visiting-the-Doctor | 45 | 1 |
| A1.3 | Feelings-and-Emotions | 29 | 1 |
| A2 | Sports, Body-Parts | 12 | 0 |
| A2.2 | Memories-and-Fear, Common-Health-Problems | 71 | 3 |
| A2.3 | Healthy-Nutrition, Embarrassing-Moments, Dreams-and-Sleeping | 58 | 3 |
| B1.1 | Goals-and-Dreams | 23 | 1 |
| Unassigned | Feelings-and-Emotions, Fears | 19 | 0 |

الكلمات غير المسندة:

- Fears: Contribute to, Creepy, Freak out, Intense
- Feelings-and-Emotions: Amusing, Caress, Cuddle, Desperate, Excuse me for living!, Gesturing, Insane, Low self-esteem, Needy, Pick up the pieces, Sarcastic, Suck fest, This blows, Total loss, Tremble

## معالجة مقترحة على دفعات

1. **إكمال الحقول والتصحيحات المؤكدة:** الـ19 partsOfSpeech الناقصة، وإضافة الأنواع المؤكدة، وتصحيح Afraid في المعنى والتلميح معًا. الملف data-repair-proposals-v14.json يحتوي القيم قبل/بعد، ولم يُطبّق.
2. **مراجعة الأمثلة:** اجعل situation مثالًا طبيعيًا يحتوي الكلمة أو تصريفها المناسب، بالتزامن مع situations إن وجدت. لا تضف example مستقلًا في المخطط الحالي. مثال مؤلف: Her acrophobia makes it difficult for her to stand on a high balcony. نفحص تسريب الإجابة في استخدامات Situation قبل تطبيق الدفعة، لأن نفس الحقل يخدم المثال والسؤال.
3. **عدالة الأسئلة:** راجع العلاقات، بدائل الإجابات المقبولة، وأسئلة القصة والجرامر والتراكيب؛ ليس مجرد ملء الحقول.
4. **إسناد المنهج:** راجع الكلمات الـ19 مع مصدر الكورس، وحدد ترتيب المراحل والوحدات من المصدر. CEFR المستقل يحتاج مراجعة منفصلة إذا أردنا إضافته.
5. **تطبيق لاحق قابل للرجوع:** حفظ نسخة قبل التعديل، وتحديث الحقول فقط مع الحفاظ على word وGrammar id، والتحقق من أن version لم يتغير منذ إعداد الدفعة. فحص كل بطاقة معدلة وجميع الحقول المكررة بعد الكتابة، ثم إعادة التحقق من المحتوى والأسئلة. لا توجد كتابة مصرح بها ضمن هذه المراجعة.

ملف المقترحات ليس ملف استيراد محتوى، ولا يصلح رفعه مباشرة إلى اللعبة. قائمة الكلمات ذات أمثلة تحتاج مراجعة مستمدة من فحص آلي وليست قائمة أخطاء مؤكدة؛ ولا تُعامل بطاقات المرادفات الصحيحة كأخطاء لمجرد التشابه.

## الـ19 partsOfSpeech الناقصة — اقتراحات

| العبارة | التصنيف المقترح |
| --- | --- |
| Black and blue | adjective phrase |
| Bottle things up | phrasal verb |
| Does it ring any bells? | expression |
| Excuse me for living! | expression |
| Feel blue | verb phrase |
| Feel like a kid with a new toy | verb phrase |
| Hit the jackpot | verb phrase |
| Hold on | phrasal verb |
| Hold your horses | verb phrase |
| I can live with that | expression |
| Live and learn | expression |
| Man up | phrasal verb |
| Memory lane | noun phrase |
| Peace and quiet | noun phrase |
| Pick up the pieces | verb phrase |
| Pull yourself together | verb phrase |
| See red | verb phrase |
| This blows | expression |
| Tooth and nail | adverbial phrase |
