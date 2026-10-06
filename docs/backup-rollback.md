# خطة Backup وRollback — Word Hunter

**الحالة: خطة جاهزة للمراجعة، وليست نسخة احتياطية منفذة أو تجربة استرجاع ناجحة.**
كل الملفات على `feature/personal-library-friends`. لا merge ولا migrations ولا
restore على الإنتاج بدون طلب خالد. لا توجد قاعدة dev مستقلة متاحة حتى الآن.

## نقاط الرجوع

آخر نسخة إنتاج تم رصدها أثناء إعداد الخطة في 6 أكتوبر 2026:
`dpl_FHgtZo3odXgYF8DjBzVzHscnbVqD`، commit
`2f6f19ecf5e28f248375976275d74d3d55cc502c`،
[رابط deployment](https://english-game-73negn523-khaled-osamas-projects-273fd486.vercel.app).
هذه نقطة رصد وليست backup معتمدة؛ نعيد التحقق من النسخة الفعلية قبل كل نشر.

نسجل قبل كل إصدار: وقت النسخة بالـUTC والقاهرة، production deployment ID ورابطه،
Git commit، مشروع Supabase، إصدارات CLI/Postgres، آخر migration مطبقة، وجرد البيانات.
بيانات الاتصال وكلمات المرور تحفظ في مدير أسرار خارج Git.

| الجزء | ما نحفظه | أين/كيف |
|---|---|---|
| الموقع وAPI | رابط وID النسخة العاملة + commit + إعدادات البناء | Vercel + سجل إصدار خارج ملفات النسخ الحساسة |
| قاعدة البيانات | roles، schema، data، RLS، functions، triggers، migration history | تصدير SQL مشفر خارج المستودع |
| المستخدمون والتقدم | Auth + profiles + progress + mastery وبقية public | ضمن data.sql؛ نتحقق بعد الاستعادة |
| المحتوى الشخصي الجديد | personal_words، personal_content_items، friendships، friend_shares، friend_invites | ضمن النسخة بعد تفعيل الميزات؛ لا نحذفها عند rollback للكود |
| الصور والصوتيات | ملفات word-images وtts الفعلية + أسماء/أحجام/checksums | نسخة Storage منفصلة؛ SQL يحفظ metadata فقط |
| إعدادات المنصات | أسماء env، نطاقها، Supabase Auth/redirects، Realtime، SMTP، cron/domains | جرد إعدادات + أسرار محفوظة منفصلًا |

لا نفترض أن Free يوفر backup يمكن تنزيله أو PITR. لا نعتبر dump بديلًا لنسخ ملفات
Storage أو إعدادات المنصات. لا ننسخ JWT/API keys الخاصة بمشروع إلى مشروع آخر؛ نستخدم
مفاتيح مشروع الاستعادة ونتوقع إعادة تسجيل الدخول عند تغيير المشروع.

## سياسة مقترحة، لم تتم جدولتها

- نسخة قبل كل تغيير schema أو نشر كبير، ونسخة بعد التأكد من نجاحه.
- نسخة يومية مشفرة، الاحتفاظ بآخر 7 يومية و4 أسبوعية، في مكان منفصل عن Supabase/Git.
- تجربة استرجاع قبل أول نشر لهذه الميزة، وبعد تغير طريقة النسخ، ومرة شهريًا إذا اعتمدنا السياسة.
- مسؤول التنفيذ: خالد أو منفذ النشر الذي يحدده. لا ننشر dump أو أسرار داخل PR/CI artifacts.
- هدف مبدئي: رجوع الكود خلال 15 دقيقة؛ استرجاع البيانات نقيس وقته في أول تجربة.
  النسخ اليومية تعني احتمال فقد حتى 24 ساعة بين النسخ، وليس ضمان عدم فقد البيانات.

## قبل النسخ والنشر

1. تأكد من المشروع المقصود؛ إنتاج اللعبة هو `sbekepibxivyysgealpr`، وVercel هو
   `english-game` ضمن فريق خالد. لا تستخدم المشروع الآخر كتجربة دون تخصيصه صراحة.
2. اختبر نسخة dev وقاعدة مستقلة، بما فيها حسابان، bulk، grammar، RLS، sharing،
   وتوافق نسخة الكود القديمة مع schema الجديدة. نجاح CI وحده لا يثبت التوافق الفعلي.
3. سجل نسخة Vercel العاملة لحظة الإصدار. لا تستخدم عنوان Preview المتصل بالإنتاج كـdev.
4. أوقف الكتابة في نافذة صيانة: المستخدمون، admin، التسجيل، طلبات AI، تحديات Live،
   uploads، وأي jobs/cron/integrations تكتب. مجرد إخفاء الزر لا يوقف طلبات عملاء مفتوحة.
   منع الكتابة يحتاج تطبيق/قواعد وصول على الخادم؛ آلية صيانة عامة لم تنفذ بعد في هذه الخطة.
5. سجل inventory ثم نفذ dump والنسخة المنفصلة من Storage. تظل الكتابة متوقفة حتى
   اكتمال النسخ: أوامر roles/schema/data المنفصلة لا تمثل snapshot مشتركة تحت كتابات مستمرة.
6. لا تنشر حتى تنجح تجربة restore ومقارنة inventory والملفات واختبارات الدخول والتقدم.

## أوامر النسخ المراجعة

تحتاج Supabase CLI بإصدار مسجل، Docker، وPostgres 17/psql. نفذ على جهاز موثوق.
الأوامر التالية أمثلة تشغيل يدوي؛ لم تنفذ هنا. استخدم مجلدًا خاصًا خارج المستودع
بصلاحيات مقيدة، وحدد مسارات output مطلقة لأن workdir قد يغير مكانها. لا تضع password في الأوامر أو الشات؛ `link` يطلبها تفاعليًا.

```bash
supabase --version
supabase db dump --help
supabase login
supabase link --project-ref sbekepibxivyysgealpr
```

بعد التحقق من الربط، ومن داخل مجلد نسخ خاص، مع تحديد `--workdir` لمسار checkout
المرتبط، نفذ الأمثلة التالية (استبدل المسار بمسارك الحقيقي):

```bash
RECOVERY_DIR=/secure/wordhunter-backups/RELEASE
# أنشئ هذا المجلد الخاص بصلاحيات مقيدة أولًا، واستبدل RELEASE بمعرف الإصدار.
supabase db dump --linked --workdir /path/to/english-game --role-only -f "$RECOVERY_DIR/roles.sql"
supabase db dump --linked --workdir /path/to/english-game -f "$RECOVERY_DIR/schema.sql"
supabase db dump --linked --workdir /path/to/english-game --data-only --use-copy -x storage.buckets_vectors -x storage.vector_indexes -f "$RECOVERY_DIR/data.sql"
supabase db dump --linked --workdir /path/to/english-game --schema supabase_migrations -f "$RECOVERY_DIR/history_schema.sql"
supabase db dump --linked --workdir /path/to/english-game --schema supabase_migrations --data-only --use-copy -f "$RECOVERY_DIR/history_data.sql"
```

Supabase CLI يفلتر schemas/roles المحجوزة؛ أي تعديلات مخصصة على `auth` أو `storage`
تحتاج جردًا وdiff منفصلًا، مثل سياسات bucket الصور وtriggers. راجع الناتج ولا تفترض
أن schema.sql يشمل تلك التعديلات. يمكن استخراج diff باستخدام:

```bash
supabase db diff --linked --workdir /path/to/english-game --schema auth,storage > "$RECOVERY_DIR/auth-storage-changes.sql"
```

تحقق من exit status لكل أمر ومن الملفات، ووجود بيانات الجداول الأساسية/Auth في dump.
قارن `ops/backup-inventory.sql` قبل النسخ وبعد الاستعادة. شغله عبر psql باستخدام
connection service أو prompt آمن، واحفظ الناتج خاصًا:

```bash
cd "$RECOVERY_DIR"
psql 'service=wordhunter_source' --no-psqlrc --file /path/to/english-game/ops/backup-inventory.sql > source-inventory.txt
sha256sum roles.sql schema.sql data.sql history_schema.sql history_data.sql auth-storage-changes.sql > SHA256SUMS
```

`service=...` يحتاج pg_service.conf خاصًا وpgpass بصلاحيات مناسبة خارج Git؛ service
للإنتاج وآخر مختلف لقاعدة الاستعادة. شفر الملفات وانقلها لمكان النسخ المعتمد. امسح
النسخ المؤقتة غير المشفرة بعد التأكد من النسخة المشفرة. checksum يثبت سلامة النقل؛
**نجاح الاسترجاع هو ما يثبت قابلية استخدام النسخة**.

## تجربة الاسترجاع

1. أنشئ مشروع اختبار **فارغًا ومخصصًا** بإعدادات/إصدارات مناسبة، وفعل extensions المطلوبة.
   لا تستخدم مشروع الإنتاج أو مشروعًا موجودًا فيه بيانات. يلزم حل حد مشاريع Free أولًا.
2. راجع roles/schema وأي تعارضات مع schemas المدارة حسب دليل Supabase؛ لا تتجاهل الأخطاء.
3. استرجع roles وschema ثم التعديلات المخصصة على auth/storage إن وجدت ثم data في
   transaction واحدة مع التوقف عند أول خطأ. يوقف replica triggers مؤقتًا خلال إدخال
   البيانات فقط، ثم نعيدها origin في نفس جلسة الاسترجاع. الأمر التالي قالب لمشروع فارغ:

```bash
psql 'service=wordhunter_restore' --no-psqlrc --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql --file auth-storage-changes.sql \
  --command 'SET session_replication_role = replica' --file data.sql \
  --command 'SET session_replication_role = origin' \
  --file history_schema.sql --file history_data.sql
```

4. أعد ملفات Storage بصورة مستقلة، وأعد ضبط Auth/Realtime/env/cron. لا تطلق وظائف
   الإرسال أو jobs في المشروع المستعاد قبل ضبطها. لا توصل الموقع العام بالمشروع بعد.
5. شغل inventory وقارن: أعداد الحسابات/المحتوى/progress/mastery، RLS/grants/functions/
   triggers/extensions/history. تحقق من checksum الملفات، ثم عينات فعلية للكلمات والتقدم
   والصور والصوتيات والدخول. اختبار RLS يكون عبر مستخدمين عاديين، وليس service role فقط.
6. احفظ وقت النسخ ووقت الاسترجاع والنتائج. فشل أي خطوة يعني أن النسخة غير معتمدة للنشر.

## قرار الـRollback

| المشكلة | التصرف الأول | أثر البيانات |
|---|---|---|
| UI أو API في الإصدار الجديد | رجوع deployment السابقة في البيئة المعنية | الجداول الجديدة والمحتوى الشخصي يبقوا محفوظين |
| ميزة شخصية معطلة، بقية اللعبة سليمة | رجوع الكود، وإيقاف مسارات/كتابات الميزة الجديدة على الخادم عند الحاجة | لا DROP/DELETE ولا مساس بالتقدم |
| migration فشلت | تأكد مما طُبق بالفعل وسجل history، وقف rollout وصحح للأمام | لا تعيد تشغيل كل migrations عشوائيًا |
| تلف بيانات مثبت | وقف الكتابة، خذ نسخة للحالة الحالية، restore لقاعدة مستقلة وافحص الفرق | قد نحتاج إصلاحًا انتقائيًا بدل استبدال كل البيانات |
| فقد المشروع كله | restore كامل لقاعدة مستقلة + Storage/config، ثم cutover بعد التحقق | بيانات ما بعد النسخة لن ترجع تلقائيًا |

## رجوع الموقع

من Vercel، اختَر deployment السابقة المسجلة وافحص commit والبيئة والمشروع ثم Rollback.
لـdev، غيّر رابط/alias dev فقط؛ لا تستخدم production rollback لمشكلة في dev.
للإنتاج، مثال CLI بعد التأكد من الهدف وإصداره:

```bash
vercel rollback PREVIOUS_PRODUCTION_DEPLOYMENT_URL --scope khaled-osamas-projects-273fd486
```

Vercel rollback لا يرجع قاعدة البيانات. لا تعمل Git force reset ولا merge للبرانش
التجريبي. اضبط عملية النشر التالية بعد الرجوع؛ rollback قد يوقف التعيين التلقائي
للنشرات التالية. افتح الموقع من متصفح عادي وجلسة خاصة، وتحقق من cache/PWA؛ قد يظل
عميل مفتوح على bundle جديد ويكتب في schema الجديدة، لذلك رجوع الكود وحده لا يغني
عن وقف المسارات/الكتابات أثناء الحادث.

## إيقاف أو استعادة الداتابيز

لا توجد down migration تلقائية مقترحة. التعديل الثاني يغير `my_library_content` وسياسة
مشاركة ويضيف trigger وentries؛ الأول يزيد صلاحيات service_role ويضيف trigger لتغيير
أسماء الكلمات. لذلك حذف الجداول فقط ليس rollback كاملًا.

عند الحاجة لإيقاف الميزة بعد رجوع الكود، جهز patch وصول محدودًا بعد أخذ نسخة من grants:
منع DML للمستخدمين على جداول الميزة الجديدة ومنع execute للـRPCs الجديدة، بما فيها
`store_generated_word` لدور server، مع الحفاظ على جداول المحتوى والتقدم القديمة.
لا توقف حسابات/التقدم العام لمجرد عطل في الميزة. هذا patch يحتاج تجربة منفصلة وطلب تنفيذ؛
لم نطبقه أو ندّعِ أنه جاهز للتشغيل دون فحص الاعتماديات.

قبل أي استرجاع كامل: انسخ الحالة الحالية حتى لو تالفة؛ حدد الكتابات التي حصلت بعد
النسخة، واسترجع في مشروع مستقل، ثم قرر الإصلاح الانتقائي أو تبديل الاتصال. الاستبدال
الكامل قد يفقد تقدمًا/كلمات أضيفت بعد النسخة. لو بدّلنا Supabase، قيم VITE_* تحتاج build
جديدة، وقيم API/server تحتاج تحديث أيضًا؛ اختيار deployment قديمة بمشروعها القديم لا
يحول الاتصال تلقائيًا للمشروع المستعاد. لا تبدل الاتصال حتى نجاح الفحص وموافقة خالد.

## سجل التنفيذ لكل إصدار

- مصدر النسخة/project ref:
- وقت بداية/نهاية وقف الكتابة:
- deployment ID / URL / commit السابق والجديد:
- migrations قبل/بعد:
- مكان النسخة المشفرة/checksums + نسخة Storage:
- نتيجة تجربة restore والجرد/الاختبارات + الوقت المستغرق:
- الكتابات بعد النسخة وخطة التعامل معها:
- قرار خالد بالنشر أو الرجوع ومنفذ العملية:

## مراجع

- [Supabase: Backup and Restore using CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase: Database backups](https://supabase.com/docs/guides/platform/backups)
- [Vercel: Rolling back a deployment](https://vercel.com/docs/deployments/rolling-back-a-deployment)
