import { FingerprintData } from '../database/schema';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 2: OS-specific font databases
// Each OS has: required core fonts (always included), marker fonts (OS-specific
// identifiers that help detect spoofing if missing), and optional extras.
// ─────────────────────────────────────────────────────────────────────────────

/** Fonts that exist on every Windows installation */
const WINDOWS_CORE_FONTS = [
  'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Cambria', 'Cambria Math',
  'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New',
  'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode',
  'Microsoft Sans Serif', 'Segoe UI', 'Segoe UI Emoji', 'Segoe UI Symbol',
  'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Wingdings'
];

/**
 * Windows marker fonts — presence of these strongly signals Windows.
 * Detectors check for them specifically; they MUST be included.
 */
const WINDOWS_MARKER_FONTS = [
  'Segoe UI', 'Segoe UI Emoji', 'Segoe UI Symbol',
  'Microsoft Sans Serif', 'Calibri', 'Consolas'
];

/** Optional Windows fonts (Office, language packs, etc.) */
const WINDOWS_EXTRA_FONTS = [
  'Agency FB', 'Algerian', 'Arial Rounded MT Bold', 'Bahnschrift',
  'Baskerville Old Face', 'Bauhaus 93', 'Bell MT', 'Berlin Sans FB',
  'Bernard MT Condensed', 'Bodoni MT', 'Book Antiqua', 'Bookman Old Style',
  'Bookshelf Symbol 7', 'Bradley Hand ITC', 'Broadway', 'Brush Script MT',
  'Californian FB', 'Calisto MT', 'Castellar', 'Centaur', 'Century',
  'Century Gothic', 'Century Schoolbook', 'Chiller', 'Colonna MT',
  'Cooper Black', 'Copperplate Gothic Bold', 'Copperplate Gothic Light',
  'Curlz MT', 'Dubai', 'Edwardian Script ITC', 'Elephant', 'Engravers MT',
  'Eras Bold ITC', 'Eras Demi ITC', 'Eras Light ITC', 'Eras Medium ITC',
  'Felix Titling', 'Footlight MT Light', 'Forte', 'Franklin Gothic Book',
  'Franklin Gothic Demi', 'Franklin Gothic Heavy', 'Franklin Gothic Medium',
  'Freestyle Script', 'French Script MT', 'Garamond', 'Gigi',
  'Gill Sans MT', 'Gill Sans MT Condensed', 'Gloucester MT Extra Condensed',
  'Goudy Old Style', 'Goudy Stout', 'Haettenschweiler', 'Harlow Solid Italic',
  'Harrington', 'High Tower Text', 'Imprint MT Shadow', 'Informal Roman',
  'Jokerman', 'Juice ITC', 'Kristen ITC', 'Kunstler Script', 'Leelawadee',
  'Lucida Bright', 'Lucida Calligraphy', 'Lucida Fax', 'Lucida Handwriting',
  'Lucida Sans', 'Lucida Sans Typewriter', 'Magneto', 'Maiandra GD',
  'Matura MT Script Capitals', 'Mistral', 'Modern No. 20', 'Monotype Corsiva',
  'MS Gothic', 'MS PGothic', 'MS PMincho', 'MS Reference Sans Serif',
  'MS Reference Specialty', 'MS UI Gothic', 'MT Extra', 'MV Boli',
  'Niagara Engraved', 'Niagara Solid', 'OCR A Extended', 'Old English Text MT',
  'Onyx', 'Palace Script MT', 'Papyrus', 'Parchment', 'Perpetua',
  'Perpetua Titling MT', 'Playbill', 'PMingLiU', 'Poor Richard',
  'Pristina', 'Rage Italic', 'Ravie', 'Rockwell', 'Rockwell Condensed',
  'Rockwell Extra Bold', 'Script MT Bold', 'Showcard Gothic', 'SimSun',
  'Snap ITC', 'Stencil', 'Sylfaen', 'Tempus Sans ITC', 'Tw Cen MT',
  'Tw Cen MT Condensed', 'Tw Cen MT Condensed Extra Bold', 'Viner Hand ITC',
  'Vivaldi', 'Vladimir Script', 'Wide Latin', 'Wingdings 2', 'Wingdings 3'
];

/** Fonts present on every macOS installation */
const MACOS_CORE_FONTS = [
  'Arial', 'Arial Black', 'Arial Narrow', 'Comic Sans MS', 'Courier New',
  'Georgia', 'Impact', 'Times New Roman', 'Trebuchet MS', 'Verdana',
  'Helvetica', 'Helvetica Neue', 'Times', 'Courier', 'Futura', 'Gill Sans',
  'Optima', 'Palatino', 'Baskerville', 'Geneva', 'Monaco',
  'American Typewriter', 'Andale Mono', 'Apple Chancery', 'Apple Color Emoji'
];

/**
 * macOS marker fonts — these are Apple-exclusive and signal macOS clearly.
 * Must always be present in macOS fingerprints.
 */
const MACOS_MARKER_FONTS = [
  'Helvetica Neue', '.SF NS Text', 'SF Pro Display', 'SF Pro Text',
  'Apple Color Emoji', 'Apple Chancery', 'Helvetica', 'Geneva', 'Monaco'
];

/** Optional macOS fonts (iWork, system extras) */
const MACOS_EXTRA_FONTS = [
  'Abadi MT Condensed Extra Bold', 'Abadi MT Condensed Light',
  'Al Bayan', 'Al Nile', 'Al Tarikh', 'Aldhabi', 'Alegreya',
  'Alegreya SC', 'Andale Mono', 'Antiqua', 'Apple Braille',
  'Apple LiGothic', 'Apple LiSung', 'Apple Myungjo', 'Apple SD Gothic Neo',
  'Apple Symbols', 'AppleGothic', 'AppleMyungjo', 'Arial Hebrew',
  'Arial Hebrew Scholar', 'Arial Rounded MT Bold', 'Athelas', 'Ayuthaya',
  'Baghdad', 'Bangla MN', 'Bangla Sangam MN', 'Baoli SC', 'Baoli TC',
  'Beirut', 'Big Caslon', 'Book Antiqua', 'Bookman Old Style',
  'Brush Script MT', 'Chalkboard', 'Chalkboard SE', 'Chalkduster',
  'Charter', 'Cochin', 'Copperplate', 'Corsiva Hebrew', 'Damascus',
  'DecoType Naskh', 'Devanagari MT', 'Devanagari Sangam MN',
  'Diwan Kufi', 'Diwan Thuluth', 'Euphemia UCAS', 'Farah', 'Farisi',
  'Footlight MT Light', 'Frutiger', 'Galvji', 'Geeza Pro', 'Gill Sans',
  'Gurmukhi MN', 'Gurmukhi MT', 'Gurmukhi Sangam MN', 'Hannotate SC',
  'Hannotate TC', 'HanziPen SC', 'HanziPen TC', 'Herculanum', 'Hiragino Kaku Gothic Pro',
  'Hiragino Kaku Gothic ProN', 'Hiragino Mincho Pro', 'Hiragino Mincho ProN',
  'Hiragino Sans', 'Hiragino Sans GB', 'Hoefler Text', 'ITF Devanagari',
  'InaiMathi', 'Iowan Old Style', 'Kailasa', 'Kannada MN', 'Kannada Sangam MN',
  'Kefa', 'Khmer MN', 'Khmer Sangam MN', 'Kohinoor Bangla',
  'Kohinoor Devanagari', 'Kohinoor Gujarati', 'Kohinoor Telugu',
  'Koster', 'Krungthep', 'Lao MN', 'Lao Sangam MN', 'Lucida Grande',
  'Luminari', 'Malayalam MN', 'Malayalam Sangam MN', 'Marion',
  'Marker Felt', 'Menlo', 'Microsoft Sans Serif', 'Mishafi', 'Mishafi Gold',
  'Mshtakan', 'Muna', 'Myanmar MN', 'Myanmar Sangam MN', 'Nadeem', 'New Peninim MT',
  'Noteworthy', 'Noto Nastaliq Urdu', 'Noto Sans Oriya', 'Noto Serif',
  'Oriya MN', 'Oriya Sangam MN', 'Osaka', 'PT Mono', 'PT Sans', 'PT Serif',
  'Palatino', 'Papyrus', 'Phosphate', 'PingFang HK', 'PingFang SC',
  'PingFang TC', 'Plantagenet Cherokee', 'Raanana', 'Rockwell', 'STFangsong',
  'STHeiti', 'STKaiti', 'STSong', 'STXihei', 'Sana', 'Sathu', 'Savoye LET',
  'Seravek', 'Silom', 'Sinhala MN', 'Sinhala Sangam MN', 'Skia',
  'Snell Roundhand', 'Songti SC', 'Songti TC', 'Sukhumvit Set', 'Superclarendon',
  'Symbol', 'System Font', 'Tahoma', 'Tamil MN', 'Tamil Sangam MN',
  'Telugu MN', 'Telugu Sangam MN', 'Thonburi', 'Trattatello', 'Tw Cen MT',
  'Waseem', 'Wawati SC', 'Wawati TC', 'Webdings', 'Weibei SC', 'Weibei TC',
  'Wingdings', 'Wingdings 2', 'Wingdings 3', 'Xingkai SC', 'Xingkai TC',
  'Yuanti SC', 'Yuanti TC', 'YuGothic', 'Yuppy SC', 'Yuppy TC',
  'Zapf Chancery', 'Zapfino'
];

/** Fonts present on every Linux (Debian/Ubuntu/Fedora) installation */
const LINUX_CORE_FONTS = [
  'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif',
  'Liberation Mono', 'Liberation Sans', 'Liberation Serif',
  'FreeMono', 'FreeSans', 'FreeSerif',
  'Courier New', 'Arial', 'Times New Roman', 'Verdana', 'Georgia', 'Impact'
];

/**
 * Linux marker fonts — these signal Linux clearly.
 * Must always be present in Linux fingerprints.
 */
const LINUX_MARKER_FONTS = [
  'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono',
  'Liberation Sans', 'Liberation Mono', 'Liberation Serif',
  'Ubuntu', 'Ubuntu Mono'
];

/** Optional Linux fonts (desktop environments, distro-specific) */
const LINUX_EXTRA_FONTS = [
  'Cantarell', 'Droid Sans', 'Droid Sans Mono', 'Droid Serif',
  'FreeSans', 'FreeSerif', 'Gentium', 'Gentium Basic', 'Gentium Book Basic',
  'Inconsolata', 'Linux Biolinum G', 'Linux Libertine G',
  'Lohit Devanagari', 'Lohit Tamil', 'Noto Mono', 'Noto Sans',
  'Noto Sans CJK JP', 'Noto Sans CJK KR', 'Noto Sans CJK SC',
  'Noto Serif', 'Noto Serif CJK JP', 'Open Sans', 'Oxygen',
  'Oxygen Mono', 'Roboto', 'Roboto Condensed', 'Roboto Mono',
  'Source Code Pro', 'Source Sans Pro', 'Source Serif Pro', 'Symbola',
  'Terminus', 'Tlwg Mono', 'Tlwg Typewriter', 'Ubuntu Condensed',
  'Ubuntu Light', 'Unifont', 'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei'
];

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 2: OS-specific voice databases for SpeechSynthesis API
// Voice URI format varies by OS backend:
//   macOS  → "urn:moz-tts:osx:<slug>"
//   Windows → "urn:moz-tts:sapi:<slug>"
//   Linux   → "urn:moz-tts:speechd:<escaped-name>?<lang>"
// ─────────────────────────────────────────────────────────────────────────────

interface VoiceDefinition {
  name: string;
  lang: string;
  voiceURI: string;
  default?: boolean;
  localService?: boolean;
}

/** Windows SAPI voices — required core + optional pool */
const WINDOWS_VOICES_REQUIRED: VoiceDefinition[] = [
  { name: 'Microsoft David - English (United States)', lang: 'en-US', voiceURI: 'Microsoft David - English (United States)', default: true, localService: true },
  { name: 'Microsoft Zira - English (United States)', lang: 'en-US', voiceURI: 'Microsoft Zira - English (United States)', localService: true },
  { name: 'Microsoft Mark - English (United States)', lang: 'en-US', voiceURI: 'Microsoft Mark - English (United States)', localService: true },
];

const WINDOWS_VOICES_OPTIONAL: VoiceDefinition[] = [
  { name: 'Microsoft Hazel Desktop - English (Great Britain)', lang: 'en-GB', voiceURI: 'Microsoft Hazel Desktop - English (Great Britain)', localService: true },
  { name: 'Microsoft George - English (Great Britain)', lang: 'en-GB', voiceURI: 'Microsoft George - English (Great Britain)', localService: true },
  { name: 'Microsoft Susan - English (Great Britain)', lang: 'en-GB', voiceURI: 'Microsoft Susan - English (Great Britain)', localService: true },
  { name: 'Microsoft Helena Desktop - Spanish (Spain)', lang: 'es-ES', voiceURI: 'Microsoft Helena Desktop - Spanish (Spain)', localService: true },
  { name: 'Microsoft Raul Desktop - Spanish (Mexico)', lang: 'es-MX', voiceURI: 'Microsoft Raul Desktop - Spanish (Mexico)', localService: true },
  { name: 'Microsoft Hortense Desktop - French (France)', lang: 'fr-FR', voiceURI: 'Microsoft Hortense Desktop - French (France)', localService: true },
  { name: 'Microsoft Hedda Desktop - German (Germany)', lang: 'de-DE', voiceURI: 'Microsoft Hedda Desktop - German (Germany)', localService: true },
  { name: 'Microsoft Stefan Desktop - German (Germany)', lang: 'de-DE', voiceURI: 'Microsoft Stefan Desktop - German (Germany)', localService: true },
  { name: 'Microsoft Irina Desktop - Russian', lang: 'ru-RU', voiceURI: 'Microsoft Irina Desktop - Russian', localService: true },
  { name: 'Microsoft Pavel Desktop - Russian', lang: 'ru-RU', voiceURI: 'Microsoft Pavel Desktop - Russian', localService: true },
  { name: 'Microsoft Haruka Desktop - Japanese', lang: 'ja-JP', voiceURI: 'Microsoft Haruka Desktop - Japanese', localService: true },
  { name: 'Microsoft Naayf Desktop - Arabic (Saudi Arabia)', lang: 'ar-SA', voiceURI: 'Microsoft Naayf Desktop - Arabic (Saudi Arabia)', localService: true },
  { name: 'Microsoft Kangkang Desktop - Chinese (Simplified)', lang: 'zh-CN', voiceURI: 'Microsoft Kangkang Desktop - Chinese (Simplified)', localService: true },
  { name: 'Microsoft Huihui Desktop - Chinese (Simplified)', lang: 'zh-CN', voiceURI: 'Microsoft Huihui Desktop - Chinese (Simplified)', localService: true },
  { name: 'Microsoft Yating Desktop - Chinese (Traditional)', lang: 'zh-TW', voiceURI: 'Microsoft Yating Desktop - Chinese (Traditional)', localService: true },
  { name: 'Microsoft Sabina Desktop - Portuguese (Portugal)', lang: 'pt-PT', voiceURI: 'Microsoft Sabina Desktop - Portuguese (Portugal)', localService: true },
  { name: 'Microsoft Daniel Desktop - Italian (Italy)', lang: 'it-IT', voiceURI: 'Microsoft Daniel Desktop - Italian (Italy)', localService: true },
  { name: 'Microsoft Hanhan Desktop - Chinese (Traditional Taiwan)', lang: 'zh-TW', voiceURI: 'Microsoft Hanhan Desktop - Chinese (Traditional Taiwan)', localService: true },
  { name: 'Microsoft Elsa Desktop - Italian (Italy)', lang: 'it-IT', voiceURI: 'Microsoft Elsa Desktop - Italian (Italy)', localService: true },
  { name: 'Microsoft Paulina Desktop - Polish (Poland)', lang: 'pl-PL', voiceURI: 'Microsoft Paulina Desktop - Polish (Poland)', localService: true },
];

/** macOS built-in voices — required core */
const MACOS_VOICES_REQUIRED: VoiceDefinition[] = [
  { name: 'Alex', lang: 'en-US', voiceURI: 'Alex', default: true, localService: true },
  { name: 'Samantha', lang: 'en-US', voiceURI: 'Samantha', localService: true },
  { name: 'Victoria', lang: 'en-US', voiceURI: 'Victoria', localService: true },
  { name: 'Karen', lang: 'en-AU', voiceURI: 'Karen', localService: true },
  { name: 'Daniel', lang: 'en-GB', voiceURI: 'Daniel', localService: true },
];

/** macOS optional voices (downloadable, language packs) */
const MACOS_VOICES_OPTIONAL: VoiceDefinition[] = [
  { name: 'Tom', lang: 'en-US', voiceURI: 'Tom', localService: true },
  { name: 'Fred', lang: 'en-US', voiceURI: 'Fred', localService: true },
  { name: 'Junior', lang: 'en-US', voiceURI: 'Junior', localService: true },
  { name: 'Kathy', lang: 'en-US', voiceURI: 'Kathy', localService: true },
  { name: 'Princess', lang: 'en-US', voiceURI: 'Princess', localService: true },
  { name: 'Ralph', lang: 'en-US', voiceURI: 'Ralph', localService: true },
  { name: 'Albert', lang: 'en-US', voiceURI: 'Albert', localService: true },
  { name: 'Bahh', lang: 'en-US', voiceURI: 'Bahh', localService: true },
  { name: 'Bells', lang: 'en-US', voiceURI: 'Bells', localService: true },
  { name: 'Boing', lang: 'en-US', voiceURI: 'Boing', localService: true },
  { name: 'Bubbles', lang: 'en-US', voiceURI: 'Bubbles', localService: true },
  { name: 'Cellos', lang: 'en-US', voiceURI: 'Cellos', localService: true },
  { name: 'Deranged', lang: 'en-US', voiceURI: 'Deranged', localService: true },
  { name: 'Good News', lang: 'en-US', voiceURI: 'Good News', localService: true },
  { name: 'Hysterical', lang: 'en-US', voiceURI: 'Hysterical', localService: true },
  { name: 'Pipe Organ', lang: 'en-US', voiceURI: 'Pipe Organ', localService: true },
  { name: 'Trinoids', lang: 'en-US', voiceURI: 'Trinoids', localService: true },
  { name: 'Whisper', lang: 'en-US', voiceURI: 'Whisper', localService: true },
  { name: 'Zarvox', lang: 'en-US', voiceURI: 'Zarvox', localService: true },
  { name: 'Amelie', lang: 'fr-CA', voiceURI: 'Amelie', localService: true },
  { name: 'Thomas', lang: 'fr-FR', voiceURI: 'Thomas', localService: true },
  { name: 'Alice', lang: 'it-IT', voiceURI: 'Alice', localService: true },
  { name: 'Anna', lang: 'de-DE', voiceURI: 'Anna', localService: true },
  { name: 'Luciana', lang: 'pt-BR', voiceURI: 'Luciana', localService: true },
  { name: 'Paulina', lang: 'es-MX', voiceURI: 'Paulina', localService: true },
  { name: 'Monica', lang: 'es-ES', voiceURI: 'Monica', localService: true },
  { name: 'Milena', lang: 'ru-RU', voiceURI: 'Milena', localService: true },
  { name: 'Kyoko', lang: 'ja-JP', voiceURI: 'Kyoko', localService: true },
  { name: 'Ting-Ting', lang: 'zh-CN', voiceURI: 'Ting-Ting', localService: true },
  { name: 'Sin-ji', lang: 'zh-HK', voiceURI: 'Sin-ji', localService: true },
  { name: 'Mei-Jia', lang: 'zh-TW', voiceURI: 'Mei-Jia', localService: true },
  { name: 'Yuna', lang: 'ko-KR', voiceURI: 'Yuna', localService: true },
  { name: 'Fiona', lang: 'en-SCOTLAND', voiceURI: 'Fiona', localService: true },
  { name: 'Moira', lang: 'en-IE', voiceURI: 'Moira', localService: true },
  { name: 'Tessa', lang: 'en-ZA', voiceURI: 'Tessa', localService: true },
  { name: 'Veena', lang: 'en-IN', voiceURI: 'Veena', localService: true },
];

/** Linux espeak/speech-dispatcher voices */
const LINUX_VOICES_REQUIRED: VoiceDefinition[] = [
  { name: 'English (Great Britain)', lang: 'en-GB', voiceURI: 'English (Great Britain)', default: true, localService: true },
  { name: 'English (United States)', lang: 'en-US', voiceURI: 'English (United States)', localService: true },
];

const LINUX_VOICES_OPTIONAL: VoiceDefinition[] = [
  { name: 'Afrikaans', lang: 'af', voiceURI: 'Afrikaans', localService: true },
  { name: 'Aragonese', lang: 'an', voiceURI: 'Aragonese', localService: true },
  { name: 'Bulgarian', lang: 'bg', voiceURI: 'Bulgarian', localService: true },
  { name: 'Bosnian', lang: 'bs', voiceURI: 'Bosnian', localService: true },
  { name: 'Catalan', lang: 'ca', voiceURI: 'Catalan', localService: true },
  { name: 'Czech', lang: 'cs', voiceURI: 'Czech', localService: true },
  { name: 'Welsh', lang: 'cy', voiceURI: 'Welsh', localService: true },
  { name: 'Danish', lang: 'da', voiceURI: 'Danish', localService: true },
  { name: 'German', lang: 'de', voiceURI: 'German', localService: true },
  { name: 'Greek', lang: 'el', voiceURI: 'Greek', localService: true },
  { name: 'Esperanto', lang: 'eo', voiceURI: 'Esperanto', localService: true },
  { name: 'Spanish', lang: 'es', voiceURI: 'Spanish', localService: true },
  { name: 'Estonian', lang: 'et', voiceURI: 'Estonian', localService: true },
  { name: 'Persian', lang: 'fa', voiceURI: 'Persian', localService: true },
  { name: 'Finnish', lang: 'fi', voiceURI: 'Finnish', localService: true },
  { name: 'French (Belgium)', lang: 'fr-BE', voiceURI: 'French (Belgium)', localService: true },
  { name: 'French', lang: 'fr', voiceURI: 'French', localService: true },
  { name: 'Irish', lang: 'ga', voiceURI: 'Irish', localService: true },
  { name: 'Croatian', lang: 'hr', voiceURI: 'Croatian', localService: true },
  { name: 'Hungarian', lang: 'hu', voiceURI: 'Hungarian', localService: true },
  { name: 'Armenian', lang: 'hy', voiceURI: 'Armenian', localService: true },
  { name: 'Indonesian', lang: 'id', voiceURI: 'Indonesian', localService: true },
  { name: 'Icelandic', lang: 'is', voiceURI: 'Icelandic', localService: true },
  { name: 'Italian', lang: 'it', voiceURI: 'Italian', localService: true },
  { name: 'Georgian', lang: 'ka', voiceURI: 'Georgian', localService: true },
  { name: 'Kannada', lang: 'kn', voiceURI: 'Kannada', localService: true },
  { name: 'Korean', lang: 'ko', voiceURI: 'Korean', localService: true },
  { name: 'Latin', lang: 'la', voiceURI: 'Latin', localService: true },
  { name: 'Lithuanian', lang: 'lt', voiceURI: 'Lithuanian', localService: true },
  { name: 'Latvian', lang: 'lv', voiceURI: 'Latvian', localService: true },
  { name: 'Macedonian', lang: 'mk', voiceURI: 'Macedonian', localService: true },
  { name: 'Malay', lang: 'ms', voiceURI: 'Malay', localService: true },
  { name: 'Norwegian Bokmål', lang: 'nb', voiceURI: 'Norwegian Bokmål', localService: true },
  { name: 'Dutch', lang: 'nl', voiceURI: 'Dutch', localService: true },
  { name: 'Polish', lang: 'pl', voiceURI: 'Polish', localService: true },
  { name: 'Portuguese (Brazil)', lang: 'pt-BR', voiceURI: 'Portuguese (Brazil)', localService: true },
  { name: 'Portuguese (Portugal)', lang: 'pt-PT', voiceURI: 'Portuguese (Portugal)', localService: true },
  { name: 'Romanian', lang: 'ro', voiceURI: 'Romanian', localService: true },
  { name: 'Russian', lang: 'ru', voiceURI: 'Russian', localService: true },
  { name: 'Slovak', lang: 'sk', voiceURI: 'Slovak', localService: true },
  { name: 'Albanian', lang: 'sq', voiceURI: 'Albanian', localService: true },
  { name: 'Serbian', lang: 'sr', voiceURI: 'Serbian', localService: true },
  { name: 'Swedish', lang: 'sv', voiceURI: 'Swedish', localService: true },
  { name: 'Swahili', lang: 'sw', voiceURI: 'Swahili', localService: true },
  { name: 'Tamil', lang: 'ta', voiceURI: 'Tamil', localService: true },
  { name: 'Turkish', lang: 'tr', voiceURI: 'Turkish', localService: true },
  { name: 'Ukrainian', lang: 'uk', voiceURI: 'Ukrainian', localService: true },
  { name: 'Vietnamese', lang: 'vi', voiceURI: 'Vietnamese', localService: true },
  { name: 'Mandarin Chinese', lang: 'zh-CN', voiceURI: 'Mandarin Chinese', localService: true },
  { name: 'Cantonese', lang: 'zh-TW', voiceURI: 'Cantonese', localService: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// GPU tier classification — used for coherence checks (Sprint 2)
// Ensures high-end GPU isn't paired with netbook-class resolution
// ─────────────────────────────────────────────────────────────────────────────

type GpuTier = 'integrated' | 'mid' | 'high';

function classifyGpuTier(renderer: string): GpuTier {
  const r = renderer.toLowerCase();
  // High-end discrete GPUs
  if (/rtx\s*[34][0-9]{3}|rx\s*6[5-9][0-9]{2}|rx\s*7[0-9]{3}|m[123]\s*(pro|max|ultra)|radeon\s*pro\s*5[5-9]/i.test(r)) {
    return 'high';
  }
  // Mid-range discrete GPUs
  if (/rtx\s*[23][0-9]{3}|gtx\s*1[0-9]{3}|rx\s*5[0-9]{3}|uhd\s*6[0-9]{2}|m[123]\b/i.test(r)) {
    return 'mid';
  }
  // Everything else (Intel HD, old Intel, Apple base M chips, etc.)
  return 'integrated';
}

/**
 * Minimum screen resolutions per GPU tier.
 * Integrated GPU can pair with any resolution.
 * High-end GPU must have at least 1920×1080.
 */
const GPU_MIN_RESOLUTION: Record<GpuTier, { w: number; h: number }> = {
  integrated: { w: 1366, h: 768 },
  mid:        { w: 1920, h: 1080 },
  high:       { w: 1920, h: 1080 },
};

/**
 * Fingerprint Generator - Ultimate Stealth v24.0 (Sprint 2)
 * Sprint 2 additions:
 *   - OS-specific font sets with marker fonts + random 30-78% subset
 *   - SpeechSynthesis voice generation with OS-correct voiceURIs
 *   - Coherence checks: GPU tier vs resolution, netbook lift, window bounds
 */
export class FingerprintGenerator {
  private seed: string;
  private defaultChromeVersion: string;
  /** Stateful counter for seeded PRNG calls — increments on each call */
  private randomCounter: number = 0;

  constructor(seed: string, defaultChromeVersion: string = '132.0.6834.110') {
    this.seed = seed;
    this.defaultChromeVersion = defaultChromeVersion;
  }

  // ── Sprint 2 helpers ──────────────────────────────────────────────────────

  /**
   * Generates an OS-specific font list with mandatory marker fonts included
   * and a random subset of optional extras (30-78% of the full optional pool).
   */
  private generateFontList(isWindows: boolean, isMac: boolean): string[] {
    const coreFonts  = isWindows ? WINDOWS_CORE_FONTS  : isMac ? MACOS_CORE_FONTS  : LINUX_CORE_FONTS;
    const markerFonts = isWindows ? WINDOWS_MARKER_FONTS : isMac ? MACOS_MARKER_FONTS : LINUX_MARKER_FONTS;
    const extraFonts = isWindows ? WINDOWS_EXTRA_FONTS  : isMac ? MACOS_EXTRA_FONTS  : LINUX_EXTRA_FONTS;

    // Start with core + markers (no duplicates)
    const required = Array.from(new Set([...coreFonts, ...markerFonts]));

    // Pick a random subset of optional extras: 30-78%
    const minPct = 0.30;
    const maxPct = 0.78;
    const pct = minPct + this.random() * (maxPct - minPct);
    const pickCount = Math.floor(extraFonts.length * pct);

    // Fisher-Yates shuffle of extras using seeded random
    const shuffled = [...extraFonts];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const extras = shuffled.slice(0, pickCount);

    // Merge and sort alphabetically (real browsers return sorted lists)
    return Array.from(new Set([...required, ...extras])).sort();
  }

  /**
   * Generates OS-correct SpeechSynthesis voice list.
   * Required voices always included; optional voices at 40-80% random subset.
   */
  private generateVoiceList(isWindows: boolean, isMac: boolean): NonNullable<FingerprintData['speech_voices']> {
    const required = isWindows ? WINDOWS_VOICES_REQUIRED : isMac ? MACOS_VOICES_REQUIRED : LINUX_VOICES_REQUIRED;
    const optional = isWindows ? WINDOWS_VOICES_OPTIONAL : isMac ? MACOS_VOICES_OPTIONAL : LINUX_VOICES_OPTIONAL;

    // Pick 40-80% of optional voices
    const minPct = 0.40;
    const maxPct = 0.80;
    const pct = minPct + this.random() * (maxPct - minPct);
    const pickCount = Math.floor(optional.length * pct);

    const shuffled = [...optional];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const extras = shuffled.slice(0, pickCount);

    // Return combined list preserving required order first
    return [...required, ...extras].map(v => ({
      name: v.name,
      lang: v.lang,
      voiceURI: v.voiceURI,
      default: v.default ?? false,
      localService: v.localService ?? true,
    }));
  }

  /**
   * Coherence check & correction pass.
   * Enforces:
   *   1. No netbook resolution (lifts 1024×600 and similar to 1366×768 minimum)
   *   2. GPU tier vs screen resolution consistency
   *   3. Screen bounds: availWidth/availHeight ≤ width/height
   *   4. Window outer ≤ screen (screenX/Y clamped to valid range)
   */
  private applyCoherenceChecks(fp: FingerprintData, gpuTier: GpuTier): void {
    const s = fp.screen;

    // 1. Lift netbook-class resolution to modern minimum (1366×768)
    const NETBOOK_MAX_W = 1280;
    const NETBOOK_MAX_H = 768;
    if (s.width < NETBOOK_MAX_W || s.height < NETBOOK_MAX_H) {
      s.width = 1366;
      s.height = 768;
      s.availWidth = 1366;
      s.availHeight = 728; // subtract a plausible taskbar
    }

    // 2. GPU tier vs resolution: high-end GPU must have ≥ minimum resolution
    const minRes = GPU_MIN_RESOLUTION[gpuTier];
    if (s.width < minRes.w || s.height < minRes.h) {
      // Upgrade to the GPU-appropriate minimum
      s.width = minRes.w;
      s.height = minRes.h;
    }

    // 3. availWidth/availHeight must be ≤ screen dimensions
    if (s.availWidth > s.width) s.availWidth = s.width;
    if (s.availHeight > s.height) s.availHeight = s.height;

    // Ensure at least a 24px taskbar/menu bar offset on availHeight
    if (s.availHeight >= s.height) {
      s.availHeight = s.height - 40;
    }

    // 4. Pixel ratio coherence: 4K resolutions shouldn't have pixelRatio=1
    if (s.width >= 2560 && s.pixelRatio < 1.25) {
      s.pixelRatio = 1.5;
    }
  }

  generateFingerprint(template: string = 'windows_chrome'): FingerprintData {
    // Reset counter so each call to generateFingerprint is deterministic
    this.randomCounter = 0;

    const isMac = template.includes('mac');
    const isLinux = template.includes('linux');
    const isWindows = !isMac && !isLinux;

    // ── Screen resolution pool ────────────────────────────────────────────
    // Only include modern resolutions — netbook sizes excluded here since
    // applyCoherenceChecks will also guard against them
    const resolutions = [
      { w: 1920, h: 1080, ratio: 1 },
      { w: 1536, h: 864, ratio: 1.25 },
      { w: 1440, h: 900, ratio: 2 },
      { w: 2560, h: 1440, ratio: 1.5 },
      { w: 1680, h: 1050, ratio: 1 },
      { w: 2560, h: 1600, ratio: 2 },
      { w: 1280, h: 800,  ratio: 2 },  // MacBook Air 13" Retina
    ];
    const res = resolutions[Math.floor(this.random() * resolutions.length)];

    const cpuCores = isMac ? [8, 10, 12] : [4, 6, 8, 12, 16];
    const memory   = isMac ? [8, 16, 32] : [8, 16, 32, 64];

    const webglData = isMac ? [
      { vendor: 'Apple Inc.',            renderer: 'Apple M1' },
      { vendor: 'Apple Inc.',            renderer: 'Apple M2' },
      { vendor: 'Apple Inc.',            renderer: 'Apple M3' },
      { vendor: 'Apple Inc.',            renderer: 'Apple M2 Pro' },
      { vendor: 'Apple Inc.',            renderer: 'Apple M3 Pro' },
    ] : isWindows ? [
      { vendor: 'Google Inc. (NVIDIA)',  renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (NVIDIA)',  renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (NVIDIA)',  renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (NVIDIA)',  renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (Intel)',   renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0)' },
      { vendor: 'Google Inc. (Intel)',   renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)' },
      { vendor: 'Google Inc. (AMD)',     renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    ] : [
      { vendor: 'Google Inc. (AMD)',     renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT, OpenGL 4.6)' },
      { vendor: 'Google Inc. (NVIDIA)',  renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080, OpenGL 4.6)' },
      { vendor: 'Google Inc. (Intel)',   renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)' },
    ];
    const gpu = webglData[Math.floor(this.random() * webglData.length)];
    const gpuTier = classifyGpuTier(gpu.renderer);

    const platform = isMac ? 'MacIntel' : isLinux ? 'Linux x86_64' : 'Win32';
    const ua = isMac
      ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${this.defaultChromeVersion} Safari/537.36`
      : isLinux
      ? `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${this.defaultChromeVersion} Safari/537.36`
      : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${this.defaultChromeVersion} Safari/537.36`;

    // ── Sprint 2: OS-specific fonts ───────────────────────────────────────
    const fonts = this.generateFontList(isWindows, isMac);

    // ── Sprint 2: OS-specific voices ─────────────────────────────────────
    const speech_voices = this.generateVoiceList(isWindows, isMac);

    // ── Build initial screen object ───────────────────────────────────────
    const screen = {
      width: res.w,
      height: res.h,
      availWidth: res.w,
      availHeight: res.h - (isWindows ? 40 : isMac ? 25 : 36),
      colorDepth: 24,
      pixelDepth: 24,
      pixelRatio: res.ratio,
    };

    // ── Build fingerprint ─────────────────────────────────────────────────
    const fp: FingerprintData = {
      canvas:   { mode: 'noise', noise: Math.floor(this.random() * 5) + 1 },
      webgl:    { mode: 'noise', vendor: gpu.vendor, renderer: gpu.renderer },
      audio:    { mode: 'noise', noise: Math.floor(this.random() * 10) + 1 },
      screen,
      timezone:  { id: 'auto', offset: 0 },
      languages: { language: 'auto_ip', languages: ['en-US', 'en'], acceptLanguage: 'en-US,en;q=0.9' },
      navigator: {
        userAgent: ua,
        platform,
        platformVersion: isWindows ? '10.0.0' : isMac ? '14.5.0' : '6.1.0',
        hardwareConcurrency: cpuCores[Math.floor(this.random() * cpuCores.length)],
        deviceMemory: memory[Math.floor(this.random() * memory.length)],
        maxTouchPoints: 0,
        doNotTrack: '0',
      },
      fonts,
      speech_voices,
      webrtc:       { mode: 'altered' },
      mediaDevices: { audioInputs: 1, audioOutputs: 1, videoInputs: 1 },
      clientRects:  { mode: 'noise' },
      plugins: [
        { name: 'PDF Viewer',              filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer',       filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chromium PDF Viewer',     filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'WebKit built-in PDF',     filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      ],
      ultraStealth: { battery: true, v8BreakIterator: true, chromeObject: true, perfJitter: true },
    };

    // ── Sprint 2: Coherence checks (must run after fp is assembled) ───────
    this.applyCoherenceChecks(fp, gpuTier);

    return fp;
  }

  private random(): number {
    // Stateful seeded PRNG using xorshift32 seeded from string hash + call counter.
    // Each call returns a different value, making font/voice subsets vary across
    // profiles with the same seed character set.
    let h = 0x811c9dc5;
    const seedStr = this.seed + ':' + (this.randomCounter++);
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = (Math.imul(h, 0x01000193) | 0) >>> 0;
    }
    // Xorshift to spread bits
    h ^= h >>> 16;
    h = (Math.imul(h, 0x45d9f3b) | 0) >>> 0;
    h ^= h >>> 16;
    return (h >>> 0) / 0xffffffff;
  }

  generateInjectionScript(fp: FingerprintData): string {
    const fpJson = JSON.stringify(fp);
    const chromeVersion = fp.navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || '132.0.0.0';
    const chromeMajor = chromeVersion.split('.')[0];

    return `
(function() {
  'use strict';
  try {
    const fp = ${fpJson};
    // 0. Core Shadowing Utils
    const originalToString = Function.prototype.toString;
    const shadowedFns = new WeakMap();

    const setNative = (fn, name) => {
      if (!fn) return;
      const str = 'function ' + (name || fn.name || 'anonymous') + '() { [native code] }';
      shadowedFns.set(fn, str);
      
      try {
        Object.defineProperty(fn, 'name', { value: name || fn.name || '', configurable: true });
      } catch(e) {}
      
      try {
        const toStringHandler = function toString() {
            if (this === fn || this === toStringHandler) return str;
            return originalToString.apply(this, arguments);
        };
        // Use defineProperty to avoid potential non-writable errors
        Object.defineProperty(fn, 'toString', {
            value: toStringHandler,
            configurable: true,
            writable: true,
            enumerable: false
        });
        shadowedFns.set(toStringHandler, 'function toString() { [native code] }');
      } catch(e) {}
    };

    Function.prototype.toString = function toString() {
      if (shadowedFns.has(this)) return shadowedFns.get(this);
      return originalToString.apply(this, arguments);
    };
    setNative(Function.prototype.toString, 'toString');

    const hook = (obj, prop, val) => {
      try {
        const desc = Object.getOwnPropertyDescriptor(obj, prop);
        if (desc && !desc.configurable) return;

        const getter = function() { return val; };
        setNative(getter, 'get ' + prop);
        Object.defineProperty(obj, prop, { 
            get: getter, 
            configurable: true, 
            enumerable: true 
        });
      } catch(e) {}
    };

    // 1. Navigator Consistency
    const navProps = {
      userAgent: fp.navigator.userAgent,
      appVersion: fp.navigator.userAgent.substring(8),
      platform: fp.navigator.platform,
      vendor: 'Google Inc.',
      deviceMemory: fp.navigator.deviceMemory,
      hardwareConcurrency: fp.navigator.hardwareConcurrency,
      maxTouchPoints: fp.navigator.maxTouchPoints || 0,
      doNotTrack: fp.navigator.doNotTrack || '0',
      onLine: true,
      cookieEnabled: true,
      pdfViewerEnabled: true,
      language: fp.languages.language,
      languages: fp.languages.languages,
    };

    Object.keys(navProps).forEach(prop => hook(Navigator.prototype, prop, navProps[prop]));

    // 1.0 Timezone Hook
    // CDP Emulation.setTimezoneOverride only applies to the tab it was connected to.
    // New tabs opened by the user don't inherit it - so we NEED JS injection too.
    if (fp.timezone && fp.timezone.id && fp.timezone.id !== 'auto') {
        const tzId = fp.timezone.id;
        const tzOffset = fp.timezone.offset || 0;

        // Override Intl.DateTimeFormat to return correct timezone
        const oldResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
        Intl.DateTimeFormat.prototype.resolvedOptions = function() {
            const res = oldResolvedOptions.apply(this, arguments);
            Object.defineProperty(res, 'timeZone', { get: () => tzId, configurable: true });
            return res;
        };
        setNative(Intl.DateTimeFormat.prototype.resolvedOptions, 'resolvedOptions');

        // Override getTimezoneOffset to return correct offset
        Date.prototype.getTimezoneOffset = function() { return tzOffset; };
        setNative(Date.prototype.getTimezoneOffset, 'getTimezoneOffset');

        // Override Date.toString() to show correct timezone
        const oldDateToString = Date.prototype.toString;
        Date.prototype.toString = function() {
            const absOffset = Math.abs(tzOffset);
            const sign = tzOffset <= 0 ? '+' : '-';
            const hh = String(Math.floor(absOffset / 60)).padStart(2, '0');
            const mm = String(absOffset % 60).padStart(2, '0');
            const gmtStr = 'GMT' + sign + hh + mm;
            // Format: "Fri Sep 18 2026 12:00:00 GMT+0100 (Europe/London)"
            const d = new Date(this.valueOf());
            const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            // Adjust time to display in spoofed timezone
            const localMs = this.valueOf() + (tzOffset * -60000);
            const ld = new Date(localMs);
            const dayStr = days[ld.getUTCDay()];
            const monStr = months[ld.getUTCMonth()];
            const dateStr = String(ld.getUTCDate()).padStart(2, ' ');
            const year = ld.getUTCFullYear();
            const timeStr = String(ld.getUTCHours()).padStart(2,'0') + ':' + String(ld.getUTCMinutes()).padStart(2,'0') + ':' + String(ld.getUTCSeconds()).padStart(2,'0');
            return dayStr + ' ' + monStr + ' ' + dateStr + ' ' + year + ' ' + timeStr + ' ' + gmtStr + ' (' + tzId + ')';
        };
        setNative(Date.prototype.toString, 'toString');
    }

    // 1.1 Client Hints - Sec-CH-UA
    if (navigator.userAgentData) {
        try {
            const brands = [
                { brand: 'Not(A:Brand', version: '99' },
                { brand: 'Google Chrome', version: '${chromeMajor}' },
                { brand: 'Chromium', version: '${chromeMajor}' }
            ];
            const platformName = fp.navigator.platform.includes('Win') ? 'Windows' : 
                                 fp.navigator.platform.includes('Mac') ? 'macOS' : 'Linux';
            
            const uaData = Object.create(NavigatorUAData.prototype);
            hook(uaData, 'brands', brands);
            hook(uaData, 'mobile', false);
            hook(uaData, 'platform', platformName);
            
            const getHighEntropyValues = function(hints) {
                return Promise.resolve({
                    brands,
                    mobile: false,
                    platform: platformName,
                    platformVersion: fp.navigator.platformVersion || (platformName === 'Windows' ? '10.0.0' : '14.5.0'),
                    architecture: platformName === 'macOS' ? (fp.navigator.userAgent.includes('Arm') ? 'arm' : 'x86') : 'x86',
                    bitness: '64',
                    model: '',
                    uaFullVersion: '${chromeVersion}',
                    fullVersionList: brands.map(b => ({ brand: b.brand, version: b.brand === 'Not(A:Brand' ? '99.0.0.0' : '${chromeVersion}' }))
                });
            };
            setNative(getHighEntropyValues, 'getHighEntropyValues');
            uaData.getHighEntropyValues = getHighEntropyValues;
            hook(navigator, 'userAgentData', uaData);
        } catch (e) {}
    }

    // 2. Plugins & MimeTypes
    const createPlugin = (name, filename, description) => {
        const p = Object.create(Plugin.prototype);
        hook(p, 'name', name);
        hook(p, 'filename', filename);
        hook(p, 'description', description);
        hook(p, 'length', 0);
        return p;
    };

    const plugins = (fp.plugins || []).map(p => createPlugin(p.name, p.filename, p.description));
    const pluginArray = Object.create(PluginArray.prototype);
    hook(pluginArray, 'length', plugins.length);
    plugins.forEach((p, i) => {
        pluginArray[i] = p;
        hook(pluginArray, p.name, p);
    });

    const item = function(index) { return this[index] || null; };
    const namedItem = function(name) { return this[name] || null; };
    setNative(item, 'item');
    setNative(namedItem, 'namedItem');
    pluginArray.item = item;
    pluginArray.namedItem = namedItem;

    const mimeTypeArray = Object.create(MimeTypeArray.prototype);
    hook(mimeTypeArray, 'length', 0);
    mimeTypeArray.item = item;
    mimeTypeArray.namedItem = namedItem;
    
    hook(Navigator.prototype, 'plugins', pluginArray);
    hook(Navigator.prototype, 'mimeTypes', mimeTypeArray);

    // 3. WebGL & Canvas Spoofing
    const patchGL = (proto) => {
      if (!proto) return;
      const oldGetParam = proto.getParameter;
      proto.getParameter = function(param) {
        // UNMASKED_VENDOR_WEBGL
        if (param === 37445) return fp.webgl.vendor;
        // UNMASKED_RENDERER_WEBGL
        if (param === 37446) return fp.webgl.renderer;
        // VENDOR
        if (param === 7936) return 'WebKit';
        // RENDERER
        if (param === 7937) return 'WebKit WebGL';
        // VERSION
        if (param === 7938) return 'WebGL 1.0 (OpenGL ES 2.0 Chromium)';
        // SHADING_LANGUAGE_VERSION
        if (param === 35724) return 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)';
        
        return oldGetParam.apply(this, arguments);
      };
      setNative(proto.getParameter, 'getParameter');

      const oldGetExtension = proto.getExtension;
      proto.getExtension = function(name) {
        if (name === 'WEBGL_debug_renderer_info') return {
            UNMASKED_VENDOR_WEBGL: 37445,
            UNMASKED_RENDERER_WEBGL: 37446
        };
        return oldGetExtension.apply(this, arguments);
      };
      setNative(proto.getExtension, 'getExtension');

      // Spoof supported extensions to look like a real browser
      const oldGetSupportedExtensions = proto.getSupportedExtensions;
      proto.getSupportedExtensions = function() {
        const exts = oldGetSupportedExtensions.apply(this, arguments) || [];
        if (!exts.includes('WEBGL_debug_renderer_info')) exts.push('WEBGL_debug_renderer_info');
        return exts;
      };
      setNative(proto.getSupportedExtensions, 'getSupportedExtensions');
    };
    patchGL(WebGLRenderingContext.prototype);
    patchGL(WebGL2RenderingContext.prototype);

    if (fp.canvas && fp.canvas.mode === 'noise') {
        const oldToDataURL = HTMLCanvasElement.prototype.toDataURL;
        const oldToBlob = HTMLCanvasElement.prototype.toBlob;
        const oldGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        
        const noiseCanvas = (canvas) => {
            const ctx = canvas.getContext('2d');
            if (ctx && !canvas._noised) {
                canvas._noised = true;
                const oldFill = ctx.fillStyle;
                // Very subtle noise
                ctx.fillStyle = 'rgba(' + fp.canvas.noise + ',' + fp.canvas.noise + ',' + fp.canvas.noise + ', 0.00001)';
                ctx.fillRect(0, 0, 1, 1);
                ctx.fillStyle = oldFill;
            }
        };

        HTMLCanvasElement.prototype.toDataURL = function() {
            noiseCanvas(this);
            return oldToDataURL.apply(this, arguments);
        };
        setNative(HTMLCanvasElement.prototype.toDataURL, 'toDataURL');

        HTMLCanvasElement.prototype.toBlob = function() {
            noiseCanvas(this);
            return oldToBlob.apply(this, arguments);
        };
        setNative(HTMLCanvasElement.prototype.toBlob, 'toBlob');

        CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
            const res = oldGetImageData.apply(this, arguments);
            if (!this.canvas._noised && w > 10 && h > 10) {
                // Only noise one pixel to change hash but stay statistically safe
                res.data[0] = (res.data[0] + (fp.canvas.noise % 2)) % 256;
            }
            return res;
        };
        setNative(CanvasRenderingContext2D.prototype.getImageData, 'getImageData');
    }

    // 3.1 Audio Spoofing
    if (fp.audio && fp.audio.mode === 'noise') {
        const audioCtx = window.AudioContext || window.webkitAudioContext;
        if (audioCtx) {
            const oldCreateOscillator = audioCtx.prototype.createOscillator;
            audioCtx.prototype.createOscillator = function() {
                const osc = oldCreateOscillator.apply(this, arguments);
                const oldStart = osc.start;
                osc.start = function() {
                    // Inject very subtle frequency shift
                    if (this.frequency) {
                        this.frequency.value += (fp.audio.noise / 1000000);
                    }
                    return oldStart.apply(this, arguments);
                };
                setNative(osc.start, 'start');
                return osc;
            };
            setNative(audioCtx.prototype.createOscillator, 'createOscillator');

            const oldGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function() {
                const res = oldGetChannelData.apply(this, arguments);
                // Subtle noise in audio buffer
                for (let i = 0; i < res.length; i += 4096) {
                    res[i] += (fp.audio.noise / 1000000);
                }
                return res;
            };
            setNative(AudioBuffer.prototype.getChannelData, 'getChannelData');
        }
    }

    // 3.2 WebRTC Spoofing - ENHANCED (Sprint 1: SDP-level sanitization)
    if (fp.webrtc && fp.webrtc.mode === 'altered') {
        const oldRTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
        if (oldRTCPeerConnection) {
            const publicIp = fp.webrtc.publicIp || '1.1.1.1';
            
            // Advanced SDP sanitization function (like Camoufox)
            const sanitizeSDP = (sdp) => {
                if (!sdp) return sdp;
                
                // Replace IPs in candidate lines (a=candidate:)
                // Format: a=candidate:<foundation> <component> <protocol> <priority> <ip> <port> typ <type> ...
                sdp = sdp.replace(
                    /a=candidate:(\d+) (\d+) (udp|tcp) (\d+) ([0-9a-f.:]+) (\d+) typ ([a-z]+)/gi,
                    (match, foundation, component, protocol, priority, ip, port, type) => {
                        return \`a=candidate:\${foundation} \${component} \${protocol} \${priority} \${publicIp} \${port} typ \${type}\`;
                    }
                );
                
                // Replace IPs in origin lines (o=)
                // Format: o=<username> <session-id> <session-version> IN IP4/IP6 <address>
                sdp = sdp.replace(
                    /o=([^ ]+) ([^ ]+) ([^ ]+) IN (IP4|IP6) ([0-9a-f.:]+)/gi,
                    (match, username, sessionId, sessionVersion, ipType, ip) => {
                        return \`o=\${username} \${sessionId} \${sessionVersion} IN \${ipType} \${publicIp}\`;
                    }
                );
                
                // Replace IPs in connection lines (c=)
                // Format: c=IN IP4/IP6 <address>
                sdp = sdp.replace(
                    /c=IN (IP4|IP6) ([0-9a-f.:]+)/gi,
                    (match, ipType, ip) => {
                        return \`c=IN \${ipType} \${publicIp}\`;
                    }
                );
                
                // Generic IP replacement for any remaining IPs (fallback)
                sdp = sdp.replace(/([0-9]{1,3}(\.[0-9]{1,3}){3}|([a-f0-9]{1,4}(:[a-f0-9]{1,4}){7}))/g, publicIp);
                
                return sdp;
            };
            
            const mockRTCPeerConnection = function(config) {
                const pc = new oldRTCPeerConnection(config);
                
                const patchCandidate = (candidate) => {
                    if (!candidate || !candidate.candidate) return candidate;
                    const newCandidate = Object.create(RTCIceCandidate.prototype);
                    const original = candidate.candidate;
                    
                    // Use advanced SDP sanitization
                    const spoofed = sanitizeSDP(original);
                    
                    Object.defineProperty(newCandidate, 'candidate', { get: () => spoofed });
                    Object.defineProperty(newCandidate, 'sdpMid', { get: () => candidate.sdpMid });
                    Object.defineProperty(newCandidate, 'sdpMLineIndex', { get: () => candidate.sdpMLineIndex });
                    Object.defineProperty(newCandidate, 'usernameFragment', { get: () => candidate.usernameFragment });
                    return newCandidate;
                };

                const oldAddEventListener = pc.addEventListener;
                pc.addEventListener = function(type, listener, options) {
                    if (type === 'icecandidate') {
                        const wrappedListener = (event) => {
                            if (event.candidate) {
                                const patched = patchCandidate(event.candidate);
                                Object.defineProperty(event, 'candidate', { get: () => patched });
                            }
                            listener.call(this, event);
                        };
                        return oldAddEventListener.call(this, type, wrappedListener, options);
                    }
                    return oldAddEventListener.apply(this, arguments);
                };

                const oldCreateOffer = pc.createOffer;
                pc.createOffer = function() {
                    return oldCreateOffer.apply(this, arguments).then(offer => {
                        offer.sdp = sanitizeSDP(offer.sdp);
                        return offer;
                    });
                };
                setNative(pc.createOffer, 'createOffer');
                
                // Also override createAnswer to replace IPs in SDP
                const oldCreateAnswer = pc.createAnswer;
                pc.createAnswer = function() {
                    return oldCreateAnswer.apply(this, arguments).then(answer => {
                        answer.sdp = sanitizeSDP(answer.sdp);
                        return answer;
                    });
                };
                setNative(pc.createAnswer, 'createAnswer');
                
                // Override setLocalDescription and setRemoteDescription to sanitize SDP
                const oldSetLocalDescription = pc.setLocalDescription;
                pc.setLocalDescription = function(description) {
                    if (description && description.sdp) {
                        description.sdp = sanitizeSDP(description.sdp);
                    }
                    return oldSetLocalDescription.apply(this, arguments);
                };
                setNative(pc.setLocalDescription, 'setLocalDescription');
                
                const oldSetRemoteDescription = pc.setRemoteDescription;
                pc.setRemoteDescription = function(description) {
                    if (description && description.sdp) {
                        description.sdp = sanitizeSDP(description.sdp);
                    }
                    return oldSetRemoteDescription.apply(this, arguments);
                };
                setNative(pc.setRemoteDescription, 'setRemoteDescription');
                
                return pc;
            };
            mockRTCPeerConnection.prototype = oldRTCPeerConnection.prototype;
            setNative(mockRTCPeerConnection, 'RTCPeerConnection');
            window.RTCPeerConnection = mockRTCPeerConnection;
            if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = mockRTCPeerConnection;
        }
    }

    // 4. Permissions & Notifications
    if (typeof Notification !== 'undefined') {
        const oldRequest = Notification.requestPermission;
        Notification.requestPermission = function() {
            return Promise.resolve('granted');
        };
        setNative(Notification.requestPermission, 'requestPermission');
        hook(Notification, 'permission', 'granted');
    } else {
        const mockNotification = function(title, options) {
            this.title = title;
            this.close = function() {};
            setNative(this.close, 'close');
        };
        mockNotification.requestPermission = function() { return Promise.resolve('granted'); };
        mockNotification.permission = 'granted';
        setNative(mockNotification, 'Notification');
        setNative(mockNotification.requestPermission, 'requestPermission');
        window.Notification = mockNotification;
    }

    if (typeof Permissions !== 'undefined' && Permissions.prototype.query) {
        const oldQuery = Permissions.prototype.query;
        Permissions.prototype.query = function(queryObj) {
            if (queryObj && (queryObj.name === 'notifications' || queryObj.name === 'geolocation')) {
                const status = Object.create(PermissionStatus.prototype);
                hook(status, 'name', queryObj.name);
                hook(status, 'state', 'granted');
                hook(status, 'onchange', null);
                return Promise.resolve(status);
            }
            return oldQuery.apply(this, arguments);
        };
        setNative(Permissions.prototype.query, 'query');
    }

    // 5. Automation & CDC Cleanup
    const clean = () => {
      try {
        // 5.0 Chrome Object Mocking
        if (fp.ultraStealth && fp.ultraStealth.chromeObject && !window.chrome) {
            const chrome = {
                app: {
                    isInstalled: false,
                    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
                },
                runtime: {
                    OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
                    OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
                    PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                    PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                    PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
                    RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }
                },
                loadTimes: function() { return {}; },
                csi: function() { return {}; }
            };
            setNative(chrome.loadTimes, 'loadTimes');
            setNative(chrome.csi, 'csi');
            window.chrome = chrome;
        }

        const proto = Navigator.prototype;
        if (proto.hasOwnProperty('webdriver')) {
            delete proto.webdriver;
        }
        Object.defineProperty(proto, 'webdriver', { get: () => false, configurable: true, enumerable: true });
        
        // 5.1 Geolocation Hook (Double Layer)
        if (fp.geolocation && navigator.geolocation) {
            const coords = {
                latitude: fp.geolocation.latitude,
                longitude: fp.geolocation.longitude,
                accuracy: fp.geolocation.accuracy || 10,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null
            };
            
            const position = {
                coords: coords,
                timestamp: Date.now()
            };

            navigator.geolocation.getCurrentPosition = function(success) {
                setTimeout(() => success(position), 10);
            };
            setNative(navigator.geolocation.getCurrentPosition, 'getCurrentPosition');

            navigator.geolocation.watchPosition = function(success) {
                setTimeout(() => success(position), 10);
                return Math.floor(Math.random() * 1000);
            };
            setNative(navigator.geolocation.watchPosition, 'watchPosition');
        }

        const keys = [
            '__last_focus_id', 'cdc_adoiery6178e7_Array', 'cdc_adoiery6178e7_Promise', 
            'cdc_adoiery6178e7_Symbol', '__webdriver_evaluate', '__webdriver_unwrapped',
            '__webdriver_script_function', '__webdriver_script_func', '__webdriver_script_fn',
            '$cdc_asdjflasdf_', '$chrome_asyncScriptInfo', '__$webdriverAsyncExecutor'
        ];
        keys.forEach(k => {
            if (window[k] !== undefined) window[k] = undefined;
            if (document[k] !== undefined) document[k] = undefined;
        });
      } catch(e) {}
    };
    
    clean();
    setInterval(clean, 500);

    // Iframe Support
    const originalCreate = document.createElement;
    document.createElement = function(tag) {
        const el = originalCreate.apply(this, arguments);
        if (tag && tag.toLowerCase() === 'iframe') {
            try {
                Object.defineProperty(el, 'contentWindow', {
                    get: function() {
                        const win = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get.apply(this);
                        if (win && !win._patched) {
                            win._patched = true;
                            // Basic patch for sub-frames
                            Object.defineProperty(win.navigator, 'webdriver', { get: () => false });
                        }
                        return win;
                    }
                });
            } catch(e) {}
        }
        return el;
    };
    setNative(document.createElement, 'createElement');


    // ── Sprint 2: Screen coherence — spoof window.screen & window dimensions ──
    try {
        const sw  = fp.screen.width;
        const sh  = fp.screen.height;
        const saw = fp.screen.availWidth;
        const sah = fp.screen.availHeight;
        const scd = fp.screen.colorDepth || 24;
        const spd = fp.screen.pixelDepth  || 24;
        const spr = fp.screen.pixelRatio  || 1;

        const screenProto = Object.getPrototypeOf(window.screen);
        const screenPropMap = { width: sw, height: sh, availWidth: saw, availHeight: sah, colorDepth: scd, pixelDepth: spd };
        Object.entries(screenPropMap).forEach(([prop, val]) => {
            try {
                Object.defineProperty(screenProto, prop, { get: () => val, configurable: true, enumerable: true });
            } catch(e) {}
        });

        try {
            Object.defineProperty(window, 'devicePixelRatio', { get: () => spr, configurable: true, enumerable: true });
        } catch(e) {}

        const clampedX = Math.min(Math.max(0, window.screenX || 0), Math.max(0, sw - (window.outerWidth  || sw)));
        const clampedY = Math.min(Math.max(0, window.screenY || 0), Math.max(0, sh - (window.outerHeight || sh)));
        try {
            Object.defineProperty(window, 'screenX',    { get: () => clampedX, configurable: true });
            Object.defineProperty(window, 'screenY',    { get: () => clampedY, configurable: true });
            Object.defineProperty(window, 'screenLeft', { get: () => clampedX, configurable: true });
            Object.defineProperty(window, 'screenTop',  { get: () => clampedY, configurable: true });
        } catch(e) {}
    } catch(e) {}

    // ── Sprint 2: SpeechSynthesis spoofing ────────────────────────────────────
    if (fp.speech_voices && fp.speech_voices.length > 0 && typeof SpeechSynthesis !== 'undefined') {
        try {
            const spoofedVoices = fp.speech_voices.map(v => {
                const voice = Object.create(SpeechSynthesisVoice.prototype);
                Object.defineProperty(voice, 'name',         { get: () => v.name,                   enumerable: true, configurable: true });
                Object.defineProperty(voice, 'lang',         { get: () => v.lang,                   enumerable: true, configurable: true });
                Object.defineProperty(voice, 'voiceURI',     { get: () => v.voiceURI || v.name,     enumerable: true, configurable: true });
                Object.defineProperty(voice, 'default',      { get: () => v.default  || false,      enumerable: true, configurable: true });
                Object.defineProperty(voice, 'localService', { get: () => v.localService !== false, enumerable: true, configurable: true });
                return voice;
            });

            const getVoicesFn = function() { return spoofedVoices; };
            setNative(getVoicesFn, 'getVoices');
            try { SpeechSynthesis.prototype.getVoices = getVoicesFn; } catch(e) {}
            try { window.speechSynthesis.getVoices     = getVoicesFn; } catch(e) {}

            const origSSSAddEvent = SpeechSynthesis.prototype.addEventListener;
            if (origSSSAddEvent) {
                SpeechSynthesis.prototype.addEventListener = function(type, listener, opts) {
                    if (type === 'voiceschanged') {
                        setTimeout(() => { try { listener.call(this, new Event('voiceschanged')); } catch(e2) {} }, 0);
                    }
                    return origSSSAddEvent.apply(this, arguments);
                };
                setNative(SpeechSynthesis.prototype.addEventListener, 'addEventListener');
            }
        } catch(e) {}
    }

    // ── Sprint 2: Date.now() / performance.timeOrigin timezone shift ──────────
    if (fp.timezone && fp.timezone.id && fp.timezone.id !== 'auto' && fp._systemTimezoneOffset !== undefined) {
        try {
            const targetOffset = fp.timezone.offset || 0;
            const systemOffset = fp._systemTimezoneOffset;
            const offsetMs = (targetOffset - systemOffset) * -60000;
            if (offsetMs !== 0) {
                const _origDateNow = Date.now.bind(Date);
                Date.now = function() { return _origDateNow() + offsetMs; };
                setNative(Date.now, 'now');
                if (window.performance && typeof window.performance.timeOrigin === 'number') {
                    const origTimeOrigin = window.performance.timeOrigin;
                    Object.defineProperty(window.performance, 'timeOrigin', {
                        get: () => origTimeOrigin + offsetMs, configurable: true, enumerable: true
                    });
                }
            }
        } catch(e) {}
    }

  } catch(e) {}
})();`;
  }
}
