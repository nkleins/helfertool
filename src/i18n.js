// Texte der öffentlichen Seiten auf Deutsch und Englisch.
// Inhalte aus der Datenbank (Bereiche, Schichten, Branding) werden nicht übersetzt.
export const LANGS = ['de', 'en'];

export const messages = {
  de: {
    'title.help': 'Helfen',
    'title.orga': 'Orga',
    'title.thanks': 'Danke',
    'title.mine': 'Meine Schichten',
    'lang.switch': 'English',
    'lang.switchShort': 'EN',
    'intro.orga': 'Orga-Schichten. Voller Name & Telefon sind hier für die Koordination sichtbar.',
    'intro.public': 'Trag dich für eine Schicht ein – nur dein Vorname ist Pflicht. Die Telefonnummer ist freiwillig und nur für das Orga-Team sichtbar.',
    'link.mine': 'Meine Schichten →',
    'list.none': 'Aktuell sind keine Bereiche/Schichten ausgeschrieben.',
    'filter.search': 'Suchen: Schicht, Bereich oder Name …',
    'filter.searchLabel': 'Suchen',
    'filter.dayLabel': 'Tag auswählen',
    'filter.allDays': 'Alle Tage',
    'filter.showPast': 'Vergangene Schichten anzeigen',
    'filter.noMatch': 'Keine passenden Schichten.',
    'slot.past': 'vorbei',
    'slot.free': '{free} von {capacity} frei',
    'slot.full': 'Voll',
    'slot.phoneRequired': 'Telefon erforderlich',
    'form.firstName': 'Dein Vorname',
    'form.phoneRequired': 'Telefon (Pflicht)',
    'form.phoneOptional': 'Telefon (optional)',
    'form.submit': 'Eintragen',
    'err.nameRequired': 'Name ist erforderlich.',
    'err.nameTooLong': 'Name ist zu lang.',
    'err.phoneRequired': 'Für diese Schicht ist die Telefonnummer Pflicht.',
    'err.full': 'Diese Schicht ist leider schon voll.',
    'err.notFound': 'Schicht nicht gefunden.',
    'thanks.title': 'Danke, du bist eingetragen! 🙌',
    'thanks.text': 'Wir freuen uns auf dich!',
    'thanks.mine': 'Meine Schichten ansehen',
    'thanks.back': 'Zurück zum Schichtplan',
    'mine.back': '← Zum Plan',
    'mine.empty': 'Auf diesem Gerät bist du noch nicht eingetragen. Trag dich auf dem <a href="/">Schichtplan</a> ein – deine Anmeldungen erscheinen dann hier.',
    'mine.otherDevice': 'Eintragungen von einem anderen Gerät kannst du hier nicht sehen oder abmelden – dafür bitte an das Orga-Team wenden.',
    'mine.signedUpAs': 'Eingetragen als:',
    'mine.cancel': 'Abmelden',
    'mine.cancelConfirm': 'Von dieser Schicht abmelden?',
    'mine.hint': 'Deine Anmeldungen werden im Cookie dieses Geräts gespeichert und können nur auf dem Gerät angezeigt werden, mit dem du dich eingetragen hast. Möchtest du eine Schicht abmelden, die hier nicht auftaucht, melde dich bei einer Person vom Orga-Team – die können auch Angaben an Schichten in der Liste ändern.',
    weekdays: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  },
  en: {
    'title.help': 'Volunteer',
    'title.orga': 'Orga',
    'title.thanks': 'Thanks',
    'title.mine': 'My shifts',
    'lang.switch': 'Deutsch',
    'lang.switchShort': 'DE',
    'intro.orga': 'Orga shifts. Full names & phone numbers are visible here for coordination.',
    'intro.public': 'Sign up for a shift – only your first name is required. Your phone number is optional and only visible to the orga team.',
    'link.mine': 'My shifts →',
    'list.none': 'There are no areas/shifts open at the moment.',
    'filter.search': 'Search: shift, area or name …',
    'filter.searchLabel': 'Search',
    'filter.dayLabel': 'Choose a day',
    'filter.allDays': 'All days',
    'filter.showPast': 'Show past shifts',
    'filter.noMatch': 'No matching shifts.',
    'slot.past': 'over',
    'slot.free': '{free} of {capacity} free',
    'slot.full': 'Full',
    'slot.phoneRequired': 'Phone number required',
    'form.firstName': 'Your first name',
    'form.phoneRequired': 'Phone (required)',
    'form.phoneOptional': 'Phone (optional)',
    'form.submit': 'Sign up',
    'err.nameRequired': 'Name is required.',
    'err.nameTooLong': 'Name is too long.',
    'err.phoneRequired': 'A phone number is required for this shift.',
    'err.full': 'Sorry, this shift is already full.',
    'err.notFound': 'Shift not found.',
    'thanks.title': 'Thanks, you are signed up! 🙌',
    'thanks.text': 'We are looking forward to seeing you!',
    'thanks.mine': 'View my shifts',
    'thanks.back': 'Back to the shift plan',
    'mine.back': '← Back to the plan',
    'mine.empty': 'You have not signed up on this device yet. Sign up on the <a href="/">shift plan</a> – your shifts will then show up here.',
    'mine.otherDevice': 'Sign-ups made on another device are not shown here and cannot be cancelled here – please contact the orga team.',
    'mine.signedUpAs': 'Signed up as:',
    'mine.cancel': 'Cancel',
    'mine.cancelConfirm': 'Cancel this shift?',
    'mine.hint': 'Your sign-ups are stored in a cookie on this device and can only be shown on the device you signed up with. If you want to cancel a shift that does not show up here, talk to someone from the orga team – they can also change details of shifts in the list.',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
};

// Validierungsmeldungen kommen auf Deutsch aus validate.js.
const MESSAGE_KEYS = {
  'Name ist erforderlich.': 'err.nameRequired',
  'Name ist zu lang.': 'err.nameTooLong',
};

export function translator(lang) {
  const d = messages[lang] ?? messages.de;
  const t = (key, vars = {}) => String(d[key] ?? messages.de[key] ?? key)
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  t.list = (key) => d[key] ?? messages.de[key];
  t.message = (msg) => (MESSAGE_KEYS[msg] ? t(MESSAGE_KEYS[msg]) : msg);
  return t;
}

// Sprache: gespeicherte Wahl (Cookie) > Browsersprache. Deutsch, wenn der
// Browser Deutsch bevorzugt oder nichts angibt, sonst Englisch.
export function pickLang(req) {
  const saved = req.cookies?.lang;
  if (LANGS.includes(saved)) return saved;
  const header = String(req.headers['accept-language'] ?? '').trim().toLowerCase();
  if (!header || header.startsWith('de') || header.startsWith('*')) return 'de';
  return 'en';
}
