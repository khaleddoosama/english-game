# تصحيح الداتا على Supabase — version 14 → 18

تم التنفيذ يوم 3 أكتوبر 2026 بعد موافقة المستخدم. المصدر الوحيد هو Supabase. اقتصرت الكتابة على content_items وversion/updated_at في content_meta، إضافة إلى سجلات التدقيق التي تولدها triggers الموجودة. لا تعديل للواجهة أو تقدم المستخدم، ولا تغيير للمخطط أو الصلاحيات.

## النتيجة

تم تعديل محتوى 163 كلمة وقاعدة جرامر واحدة وقصة واحدة. العدد الإجمالي ثابت: 257 كلمة، 9 قواعد، قصة واحدة.

| التصحيح | العدد / التفاصيل |
| --- | --- |
| partsOfSpeech | 49 بطاقة: إكمال 19 حقلًا فارغًا، وإضافة أدوار شائعة إلى 30 بطاقة أخرى. لم ننسخ type إلى partsOfSpeech. |
| أمثلة الاستعمال situation | 146 بطاقة. بعض الأمثلة القديمة كانت تصريفات صحيحة لغويًا؛ جرى استبدالها بأمثلة تتضمن الصيغة المخزنة كاملة لتلبية عقد المحتوى. |
| situations | مزامنة الأمثلة المناظرة في 27 بطاقة تحمل الحقل الإضافي. |
| Afraid | تصحيح معنى وتلميح always followed by of. |
| butter someone up | صياغة فراغين يقبلان العبارة المخزنة طبيعيًا، وتحديث المثال. |
| Ill | تقوية السياق في الفراغ الأساسي والنسخة المطابقة له. |
| أضداد | حذف opposite العام من Avoid وBring up، وحذف avoid من antonyms الخاصة بـBring up؛ إزالة regular season من antonyms الخاصة بـPlayoffs؛ إزالة opposite=Disappointed من Satisfied مع إبقاء antonyms=dissatisfied. |
| Elbow | استبدال distractors تحت collocationChecks لتجنب قبول touched منطقيًا. |
| so that + can/could | تثبيت سياق الماضي المنتهي في سؤالين ومثال commonMistakes. |
| The Secret Recipe | جعل Flu تشخيصًا مذكورًا في النص بدل استنتاجه من المسحوق؛ إعادة سؤال Terrifying ليصف التجربة؛ إكمال فراغ القراءة بكلمة checking. |

الأمثلة الجديدة في أغلب البطاقات نسخة مكتملة من الفراغ الحالي بعد مراجعة الجملة وإصلاح حالة الأحرف. هذا مسموح بعقد المحتوى؛ لم تُولّد معانٍ أو مستويات جديدة من ملفات قديمة. لم يُضف حقل example.

## التحقق بعد الكتابة

- قورنت نسخة حية نهائية بكل الدفعات المخطط لها؛ لا تغيير إضافي في محتوى أي سجل.
- word وGrammar id وجميع IDs القديمة ومفاتيح الصفوف ثابتة. كذلك level وunits وcategory وposition وdeleted.
- جرى تحديث version في كل دفعة وupdated_at لكل صف معدل لكي يلتقط تحميل Supabase التدريجي التصحيحات.
- كل الدفعات داخل معاملات ذرية، مع قفل نسخة المحتوى والتحقق من القيم السابقة لمنع الكتابة فوق تعديل متزامن.
- الشكل البنيوي الذي يستخدمه التطبيق الحالي نجح بلا أخطاء.
- 240 تشغيلًا لتوليد التدريب واختبارات الوحدات، مع تغطية كل عناصر التدريب، وكل النهائيات والقصة: لا جولة معطلة، ولا إجابة مفقودة أو اختيارات مكررة.
- فحص النص الكامل يثبت وجود الصيغة المخزنة في 256 من 257 مثالًا، مع بقاء Fish memory للمراجعة.

## حدود الفحص الصارم

تم تشغيل validator الخاص بمهارة Word Hunter Pipeline أيضًا. نتيجته الكلية FAIL: 42 تشخيصًا، وصفر تحذيرات. لم يُسجل التقرير PASS كاملًا ولم يُنتج ملف import معتمدًا.

التشخيصات: 26 تربط تصنيف type بالتصنيف اللغوي partsOfSpeech، وهذا يخالف قرار المستخدم بإبقائهما منفصلين؛ 15 تفترض أن القواعد الخمس متعددة الأسئلة يجب أن تحمل prompt/answer/options في المستوى الأعلى، بينما صيغة questions الحالية مدعومة من محرك اللعبة؛ وتشخيص فعلي واحد يتعلق بعدم وجود Fish memory في مثاله. يلزم تحديث أداة التحقق لعقد اللعبة الحالي في مهمة أدوات مستقلة، لا تغيير الداتا الصحيحة لإرضاء هذه الافتراضات.

لا يمكن للفحص الآلي ضمان صحة كل علاقة دلالية أو كل جواب كتابي؛ لم تُحسم جميع الفروق بين المرادفات القريبة. وجود الكلمة في situation قد يكشف إجابة بعض ألعاب Situation التي تستخدم نفس الحقل؛ الملف المعتمد يقر هذا التوافق مؤقتًا. فصل المثال عن السؤال يحتاج تعديلًا برمجيًا، وهو خارج مهمة الداتا الحالية.

## ما بقي دون تخمين

1. **19 كلمة بلا level:** المطلوب مطابقة مصدر الكورس، لا استنتاج المستوى من صعوبة الكلمة أو من الوحدة فقط.
2. **Fish memory:** يحتاج تثبيت الصياغة من مصدر الكورس ومراجعة التعبير الطبيعي المقابل. لم نغير word كي لا نفصل التقدم.
3. **121 كلمة بلا id:** ليست مشكلة تحميل حاليًا؛ يحتاج الترحيل إلى مخطط موحد قرارًا مستقلًا، مع الإبقاء على المفاتيح الحالية.
4. **ترتيب المنهج:** لم نعدّل level_order الذي يحمل أسماء الدروس، أو نضف وحدات وهمية للوصول إلى 6–7 وحدات.
5. **الفروق الدلالية الدقيقة:** Dietitian/Nutritionist وCure/Heal وDizzy/Lightheaded تحتاج مراجعة علاقات حسب المعنى، مع الحفاظ على منع الالتباس الحالي في الخيارات.

الكلمات غير المسندة:

- Fears: Contribute to, Creepy, Freak out, Intense
- Feelings-and-Emotions: Amusing, Caress, Cuddle, Desperate, Excuse me for living!, Gesturing, Insane, Low self-esteem, Needy, Pick up the pieces, Sarcastic, Suck fest, This blows, Total loss, Tremble

## سجل التغييرات والرجوع

ملف data-repair-changes-v14-v18.json يسجل كل حقل تغير بقيمتيه قبل وبعد، بما في ذلك ما إذا كان الحقل موجودًا أصلًا. يصلح أساسًا لرجوع مقيد بالقيم الحالية؛ لا يُرفع كملف استيراد. توجد كذلك آثار التعديل في سجلات تدقيق Supabase القائمة. يجب ألا يكون الرجوع overwrite لصف كامل إذا ظهرت تعديلات لاحقة.

## مراجع التحقق اللغوي

[Afraid](https://dictionary.cambridge.org/grammar/british-grammar/afraid)، [Upset](https://dictionary.cambridge.org/dictionary/english/upset)، [Sprain](https://dictionary.cambridge.org/dictionary/english/sprain)، [Bandage](https://dictionary.cambridge.org/dictionary/english/bandage)، [Patient](https://dictionary.cambridge.org/dictionary/english/patient)، [Good](https://dictionary.cambridge.org/dictionary/english/good)، [Joint](https://dictionary.cambridge.org/dictionary/english/joint)، [Sign](https://dictionary.cambridge.org/dictionary/english/sign)، [Express](https://dictionary.cambridge.org/dictionary/english/express)، وباقي مداخل Cambridge للكلمات المعدلة. هذه المراجع لتثبيت الأدوار الشائعة؛ الأمثلة الجديدة مؤلفة أو مشتقة من الفراغات الحالية.
