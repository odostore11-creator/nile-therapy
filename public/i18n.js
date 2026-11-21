'use strict';
// English / Arabic text for the portal. To change a word, edit it here.
// t('key') returns the text in the current language; {name}-style parts are filled in.
// Data the users type (names, notes, places) is never translated, only the interface.

const STRINGS = {
  en: {
    'app.title': 'Nile Therapy — Portal',
    'lang.switch': 'العربية', 'lang.switchLabel': 'Switch to Arabic',

    'common.cancel': 'Cancel', 'common.save': 'Save', 'common.delete': 'Delete', 'common.edit': 'Edit',
    'common.loading': 'Loading…', 'common.done': 'Done', 'common.copy': 'Copy', 'common.copied': 'Copied',

    'login.tagline': 'Care that moves with the river.',
    'login.intro': "The internal portal for Nile Therapy's founders and doctors — session logs, the doctor team, and each founder's AI partner in one place.",
    'login.internal': 'Internal use only',
    'login.title': 'Sign in',
    'login.help': 'Use the username and password Nile Therapy gave you.',
    'login.username': 'Username', 'login.password': 'Password',
    'login.ph.admin': 'e.g. abdurrahman', 'login.ph.doctor': 'e.g. dr.mona',
    'login.go.admin': 'Enter admin dashboard', 'login.go.doctor': 'Enter doctor portal',
    'login.asFounder': 'Signed in as a founder', 'login.asDoctor': 'Signed in as a doctor',
    'role.founder': 'Founder', 'role.doctor': 'Doctor',

    'nav.sessions': 'Sessions', 'nav.doctors': 'Doctors', 'nav.chat': 'My AI room', 'nav.log': 'My sessions',
    'me.password': 'Password', 'me.logout': 'Log out',

    'pw.title': 'Change password', 'pw.current': 'Current password', 'pw.new': 'New password (8+ characters)',
    'pw.done': 'Password changed',

    'form.doctor': 'Doctor', 'form.choose': 'Choose…',
    'form.patient': 'Patient name', 'form.patient.ph': 'Short name, e.g. Ahmed S.',
    'form.type': 'Session type',
    'form.where': 'Where was the session?', 'form.where.ph': "Area / address, or 'Video call'",
    'form.videoCall': 'Video call',
    'form.date': 'Date', 'form.time': 'Time', 'form.minutes': 'Minutes',
    'form.notes': 'Notes', 'form.optional': '(optional)', 'form.notes.ph': 'Anything the founders should know',

    'type.Home visit': 'Home visit', 'type.Clinic': 'Clinic', 'type.Online': 'Online',

    'edit.title': 'Edit session', 'edit.confirmDelete': 'Delete this session?',
    'edit.updated': 'Session updated', 'edit.deleted': 'Session deleted',

    'table.empty': 'No sessions yet.',
    'th.date': 'Date', 'th.doctor': 'Doctor', 'th.patient': 'Patient', 'th.type': 'Type',
    'th.location': 'Location', 'th.min': 'Min', 'th.notes': 'Notes',

    'portal.hi': 'Hi, {name}', 'portal.sub': 'Log every Nile Therapy session right after you finish it.',
    'portal.log': 'Log a session', 'portal.submit': 'Submit session', 'portal.mine': 'My sessions',
    'portal.total': '{n} total', 'portal.thanks': 'Session logged — thank you',

    'sessions.title': 'Sessions', 'sessions.sub': 'Every session your doctors have logged.',
    'sessions.add': '+ Add for a doctor', 'sessions.csv': 'Export to Excel (CSV)',
    'sessions.search': 'Search', 'sessions.search.ph': 'Patient, place or note',
    'sessions.allDoctors': 'All doctors', 'sessions.from': 'From', 'sessions.to': 'To',
    'sessions.view': 'View', 'sessions.byDoctor': 'By doctor', 'sessions.oneList': 'All in one list',
    'sessions.stat.filtered': 'Sessions (filtered)', 'sessions.stat.month': 'This month',
    'sessions.stat.week': 'Last 7 days', 'sessions.stat.active': 'Doctors active',
    'sessions.count': n => `${n} session${n === 1 ? '' : 's'}`,
    'sessions.profile': 'Profile', 'sessions.noMatch': 'No sessions match these filters.',
    'sessions.addTitle': 'Add a session for a doctor', 'sessions.addBtn': 'Add session', 'sessions.added': 'Session added',

    'doc.fullName': 'Full name', 'doc.fullName.ph': 'Dr. …', 'doc.username': 'Username',
    'doc.usernameNew': 'Username (for login)', 'doc.title': 'Title', 'doc.titleDefault': 'Physiotherapist',
    'doc.specialty': 'Specialty', 'doc.specialty.ph': 'e.g. Sports rehab', 'doc.phone': 'Phone',
    'doc.area': 'Area', 'doc.area.ph': 'Where they usually work', 'doc.about': 'About',
    'creds.intro': 'Send these to the doctor privately. The password is shown only once — they can change it after logging in.',
    'creds.username': 'Username', 'creds.password': 'Password', 'creds.portal': 'Nile Therapy portal',

    'doctors.title': 'Doctors', 'doctors.sub': 'Your team. Click a doctor to open their profile.',
    'doctors.add': '+ Add doctor', 'doctors.inactive': 'Inactive',
    'doctors.n.sessions': 'sessions', 'doctors.n.month': 'this month', 'doctors.n.patients': 'patients',
    'doctors.none': 'No doctors yet. Add your first one.',
    'doctors.addTitle': 'Add a doctor', 'doctors.create': 'Create account', 'doctors.created': 'Doctor account created',

    'profile.back': '← All doctors', 'profile.reset': 'Reset password', 'profile.edit': 'Edit profile',
    'profile.joined': 'Joined', 'profile.last': 'Last session',
    'profile.done': 'Sessions done', 'profile.patients': 'Patients', 'profile.noPatients': 'No patients yet.',
    'profile.history': 'Session history', 'profile.active': 'Active (can log in)', 'profile.saved': 'Profile saved',
    'profile.confirmReset': 'Give {name} a new password? Their old one will stop working.',
    'profile.newPw': 'New password',

    'chat.title': 'My AI room',
    'chat.sub': "Private to you, {name}. The other founders can't see this chat or its memory.",
    'chat.assistant': 'Nile Therapy assistant', 'chat.model': 'Model', 'chat.new': 'New chat',
    'model.claude-sonnet-5-5': 'Sonnet (fast, everyday)', 'model.claude-opus-5-5': 'Opus (deep thinking)',
    'chat.input.ph': 'Ask about sessions, doctors, plans… (Enter to send, Shift+Enter for a new line)',
    'chat.send': 'Send', 'chat.memory': 'What it remembers',
    'chat.memory.sub': "Things the AI saved about you and your plans. It uses these in every chat. Remove anything that's wrong.",
    'chat.forget': 'Forget this', 'chat.nothing': 'Nothing yet.',
    'chat.welcome': 'Ahlan, {name}',
    'chat.welcome.sub': 'I can see every session and doctor in the portal. Ask me anything about the business.',
    'chat.suggest': ['Which doctors had the most sessions this month?', 'Summarize this week for me in 5 bullet points',
      "Which doctors haven't logged anything in the last 7 days?", 'remember: I want a weekly report every Saturday'],
    'chat.off': 'AI not connected yet. Chat, history and memory work, but replies are placeholders until the Anthropic API key is added.',
    'chat.missing': "The AI server function isn't set up yet, so messages can't be sent. History and memory still show here.",
    'chat.thinking': 'Thinking…', 'chat.savedMem': 'Saved to memory',
    'chat.confirmNew': 'Start a new chat? This clears the conversation, but keeps what the AI remembers about you.',

    'err.login': 'Please log in again', 'err.notAllowed': 'Not allowed',
    'err.invalid': 'Some fields are too long or invalid',
    'err.network': "Can't reach the server. Check your internet connection.",
    'err.fnMissing': "This feature needs its server function, which isn't set up yet.",
    'err.wrongLogin': 'Wrong username or password', 'err.tooMany': 'Too many attempts. Try again in a few minutes.',
    'err.accountOff': 'This account is turned off. Ask a founder.',
    'err.pwShort': 'New password must be at least 8 characters', 'err.pwWrong': 'Current password is wrong',
    'err.patient': 'Patient name is required', 'err.location': 'Location is required',
    'err.date': 'Session date is required', 'err.pickDoctor': 'Pick a doctor', 'err.noDoctor': 'Doctor not found',
  },

  ar: {
    'app.title': 'نايل ثيرابي — البوابة',
    'lang.switch': 'English', 'lang.switchLabel': 'التبديل إلى الإنجليزية',

    'common.cancel': 'إلغاء', 'common.save': 'حفظ', 'common.delete': 'حذف', 'common.edit': 'تعديل',
    'common.loading': 'جارٍ التحميل…', 'common.done': 'تم', 'common.copy': 'نسخ', 'common.copied': 'تم النسخ',

    'login.tagline': 'رعاية تتدفق مع النيل.',
    'login.intro': 'البوابة الداخلية لمؤسسي وأطباء نايل ثيرابي: سجل الجلسات، فريق الأطباء، ومساعد ذكي لكل مؤسس في مكان واحد.',
    'login.internal': 'للاستخدام الداخلي فقط',
    'login.title': 'تسجيل الدخول',
    'login.help': 'استخدم اسم المستخدم وكلمة المرور اللذين حصلت عليهما من نايل ثيرابي.',
    'login.username': 'اسم المستخدم', 'login.password': 'كلمة المرور',
    'login.ph.admin': 'abdurrahman', 'login.ph.doctor': 'dr.mona', // the box is left-to-right (usernames are English)
    'login.go.admin': 'الدخول إلى لوحة الإدارة', 'login.go.doctor': 'الدخول إلى بوابة الطبيب',
    'login.asFounder': 'تم تسجيل الدخول كمؤسس', 'login.asDoctor': 'تم تسجيل الدخول كطبيب',
    'role.founder': 'مؤسس', 'role.doctor': 'طبيب',

    'nav.sessions': 'الجلسات', 'nav.doctors': 'الأطباء', 'nav.chat': 'مساعدي الذكي', 'nav.log': 'جلساتي',
    'me.password': 'كلمة المرور', 'me.logout': 'تسجيل الخروج',

    'pw.title': 'تغيير كلمة المرور', 'pw.current': 'كلمة المرور الحالية', 'pw.new': 'كلمة المرور الجديدة (8 أحرف على الأقل)',
    'pw.done': 'تم تغيير كلمة المرور',

    'form.doctor': 'الطبيب', 'form.choose': 'اختر…',
    'form.patient': 'اسم المريض', 'form.patient.ph': 'اسم مختصر، مثال: أحمد س.',
    'form.type': 'نوع الجلسة',
    'form.where': 'أين كانت الجلسة؟', 'form.where.ph': 'المنطقة / العنوان، أو «مكالمة فيديو»',
    'form.videoCall': 'مكالمة فيديو',
    'form.date': 'التاريخ', 'form.time': 'الوقت', 'form.minutes': 'المدة (دقيقة)',
    'form.notes': 'ملاحظات', 'form.optional': '(اختياري)', 'form.notes.ph': 'أي شيء يجب أن يعرفه المؤسسون',

    'type.Home visit': 'زيارة منزلية', 'type.Clinic': 'عيادة', 'type.Online': 'أونلاين',

    'edit.title': 'تعديل الجلسة', 'edit.confirmDelete': 'حذف هذه الجلسة؟',
    'edit.updated': 'تم تحديث الجلسة', 'edit.deleted': 'تم حذف الجلسة',

    'table.empty': 'لا توجد جلسات بعد.',
    'th.date': 'التاريخ', 'th.doctor': 'الطبيب', 'th.patient': 'المريض', 'th.type': 'النوع',
    'th.location': 'المكان', 'th.min': 'دقيقة', 'th.notes': 'ملاحظات',

    'portal.hi': 'أهلاً، {name}', 'portal.sub': 'سجّل كل جلسة لنايل ثيرابي فور انتهائك منها.',
    'portal.log': 'تسجيل جلسة', 'portal.submit': 'إرسال الجلسة', 'portal.mine': 'جلساتي',
    'portal.total': 'الإجمالي: {n}', 'portal.thanks': 'تم تسجيل الجلسة، شكراً لك',

    'sessions.title': 'الجلسات', 'sessions.sub': 'كل الجلسات التي سجّلها أطباؤك.',
    'sessions.add': '+ إضافة جلسة لطبيب', 'sessions.csv': 'تصدير إلى Excel (CSV)',
    'sessions.search': 'بحث', 'sessions.search.ph': 'مريض أو مكان أو ملاحظة',
    'sessions.allDoctors': 'كل الأطباء', 'sessions.from': 'من', 'sessions.to': 'إلى',
    'sessions.view': 'طريقة العرض', 'sessions.byDoctor': 'حسب الطبيب', 'sessions.oneList': 'قائمة واحدة',
    'sessions.stat.filtered': 'الجلسات (حسب البحث)', 'sessions.stat.month': 'هذا الشهر',
    'sessions.stat.week': 'آخر 7 أيام', 'sessions.stat.active': 'الأطباء النشطون',
    'sessions.count': n => (n === 1 ? 'جلسة واحدة' : n === 2 ? 'جلستان' : n <= 10 ? `${n} جلسات` : `${n} جلسة`),
    'sessions.profile': 'الملف', 'sessions.noMatch': 'لا توجد جلسات تطابق هذا البحث.',
    'sessions.addTitle': 'إضافة جلسة لطبيب', 'sessions.addBtn': 'إضافة الجلسة', 'sessions.added': 'تمت إضافة الجلسة',

    'doc.fullName': 'الاسم الكامل', 'doc.fullName.ph': 'د. …', 'doc.username': 'اسم المستخدم',
    'doc.usernameNew': 'اسم المستخدم (للدخول، بالإنجليزية)', 'doc.title': 'المسمى الوظيفي', 'doc.titleDefault': 'أخصائي علاج طبيعي',
    'doc.specialty': 'التخصص', 'doc.specialty.ph': 'مثال: تأهيل رياضي', 'doc.phone': 'الهاتف',
    'doc.area': 'المنطقة', 'doc.area.ph': 'أين يعمل عادةً', 'doc.about': 'نبذة',
    'creds.intro': 'أرسل هذه البيانات إلى الطبيب بشكل خاص. تظهر كلمة المرور مرة واحدة فقط، ويمكنه تغييرها بعد تسجيل الدخول.',
    'creds.username': 'اسم المستخدم', 'creds.password': 'كلمة المرور', 'creds.portal': 'بوابة نايل ثيرابي',

    'doctors.title': 'الأطباء', 'doctors.sub': 'فريقك. اضغط على أي طبيب لفتح ملفه.',
    'doctors.add': '+ إضافة طبيب', 'doctors.inactive': 'غير نشط',
    'doctors.n.sessions': 'جلسة', 'doctors.n.month': 'هذا الشهر', 'doctors.n.patients': 'مريض',
    'doctors.none': 'لا يوجد أطباء بعد. أضف أول طبيب.',
    'doctors.addTitle': 'إضافة طبيب', 'doctors.create': 'إنشاء الحساب', 'doctors.created': 'تم إنشاء حساب الطبيب',

    'profile.back': '→ كل الأطباء', 'profile.reset': 'إعادة تعيين كلمة المرور', 'profile.edit': 'تعديل الملف',
    'profile.joined': 'تاريخ الانضمام', 'profile.last': 'آخر جلسة',
    'profile.done': 'الجلسات المنجزة', 'profile.patients': 'المرضى', 'profile.noPatients': 'لا يوجد مرضى بعد.',
    'profile.history': 'سجل الجلسات', 'profile.active': 'نشط (يمكنه تسجيل الدخول)', 'profile.saved': 'تم حفظ الملف',
    'profile.confirmReset': 'إعطاء {name} كلمة مرور جديدة؟ ستتوقف كلمة المرور القديمة عن العمل.',
    'profile.newPw': 'كلمة مرور جديدة',

    'chat.title': 'مساعدي الذكي',
    'chat.sub': 'هذه المساحة خاصة بك يا {name}. لا يستطيع المؤسسون الآخرون رؤية هذه المحادثة أو ذاكرتها.',
    'chat.assistant': 'مساعد نايل ثيرابي', 'chat.model': 'النموذج', 'chat.new': 'محادثة جديدة',
    'model.claude-sonnet-5-5': 'Sonnet (سريع، للاستخدام اليومي)', 'model.claude-opus-5-5': 'Opus (تفكير أعمق)',
    'chat.input.ph': 'اسأل عن الجلسات أو الأطباء أو الخطط… (Enter للإرسال، Shift+Enter لسطر جديد)',
    'chat.send': 'إرسال', 'chat.memory': 'ما يتذكره المساعد',
    'chat.memory.sub': 'معلومات حفظها المساعد عنك وعن خططك، ويستخدمها في كل محادثة. احذف أي شيء غير صحيح.',
    'chat.forget': 'انسَ هذا', 'chat.nothing': 'لا شيء بعد.',
    'chat.welcome': 'أهلاً يا {name}',
    'chat.welcome.sub': 'أستطيع رؤية كل الجلسات والأطباء في البوابة. اسألني أي شيء عن العمل.',
    'chat.suggest': ['أي الأطباء لديهم أكثر عدد من الجلسات هذا الشهر؟', 'لخّص لي هذا الأسبوع في 5 نقاط',
      'أي الأطباء لم يسجلوا أي جلسة في آخر 7 أيام؟', 'تذكر: أريد تقريراً أسبوعياً كل يوم سبت'],
    'chat.off': 'المساعد الذكي غير متصل بعد. المحادثة والسجل والذاكرة تعمل، لكن الردود تجريبية حتى تتم إضافة مفتاح Anthropic.',
    'chat.missing': 'وظيفة المساعد على الخادم غير جاهزة بعد، لذلك لا يمكن إرسال الرسائل. السجل والذاكرة ما زالا ظاهرين هنا.',
    'chat.thinking': 'يفكر…', 'chat.savedMem': 'تم الحفظ في الذاكرة',
    'chat.confirmNew': 'بدء محادثة جديدة؟ سيتم مسح المحادثة، لكن سيبقى ما يتذكره المساعد عنك.',

    'err.login': 'يرجى تسجيل الدخول مرة أخرى', 'err.notAllowed': 'غير مسموح',
    'err.invalid': 'بعض الحقول طويلة جداً أو غير صالحة',
    'err.network': 'تعذّر الوصول إلى الخادم. تحقق من اتصال الإنترنت.',
    'err.fnMissing': 'هذه الميزة تحتاج إلى وظيفة على الخادم غير جاهزة بعد.',
    'err.wrongLogin': 'اسم المستخدم أو كلمة المرور غير صحيحة', 'err.tooMany': 'محاولات كثيرة. حاول مرة أخرى بعد بضع دقائق.',
    'err.accountOff': 'هذا الحساب موقوف. تواصل مع أحد المؤسسين.',
    'err.pwShort': 'يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل', 'err.pwWrong': 'كلمة المرور الحالية غير صحيحة',
    'err.patient': 'اسم المريض مطلوب', 'err.location': 'المكان مطلوب',
    'err.date': 'تاريخ الجلسة مطلوب', 'err.pickDoctor': 'اختر طبيباً', 'err.noDoctor': 'الطبيب غير موجود',
  },
};

// Messages that come back in English from the server functions.
const SERVER_MESSAGES_AR = {
  'Please log in': 'يرجى تسجيل الدخول',
  'Please log in again': 'يرجى تسجيل الدخول مرة أخرى',
  'Only founders can do this': 'هذا الإجراء متاح للمؤسسين فقط',
  'That username is taken': 'اسم المستخدم مستخدم بالفعل',
  'Username: 3+ characters, letters/numbers/._- only': 'اسم المستخدم: 3 أحرف على الأقل، حروف إنجليزية وأرقام و . _ - فقط',
  'Full name is required': 'الاسم الكامل مطلوب',
  'Doctor not found': 'الطبيب غير موجود',
  'Empty message': 'الرسالة فارغة',
  'Could not create the account': 'تعذّر إنشاء الحساب',
  'Could not create the doctor profile': 'تعذّر إنشاء ملف الطبيب',
  'Could not reset the password': 'تعذّر إعادة تعيين كلمة المرور',
  'Server error': 'حدث خطأ في الخادم',
};

let LANG = 'en';
try { if (localStorage.getItem('nt_lang') === 'ar') LANG = 'ar'; } catch { /* storage blocked: stay English */ }

function t(key, vars) {
  let s = STRINGS[LANG][key] ?? STRINGS.en[key] ?? key;
  if (typeof s === 'function') return s(vars);
  if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}
function trServer(msg) { return LANG === 'ar' ? (SERVER_MESSAGES_AR[msg] ?? msg) : msg; }

function applyLang() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  document.title = t('app.title');
}
function setLang(next) {
  LANG = next === 'ar' ? 'ar' : 'en';
  try { localStorage.setItem('nt_lang', LANG); } catch { /* not saved; still switches for this visit */ }
  applyLang();
}
applyLang();
