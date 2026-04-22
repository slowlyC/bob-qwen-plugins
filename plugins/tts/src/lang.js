/**
 * Bob 语言代码 → DashScope language_type 映射
 *
 * Qwen3-TTS 支持:
 *   Chinese, English, German, Italian, Portuguese,
 *   Spanish, Japanese, Korean, French, Russian
 */

var supportLanguages = [
    ['zh-Hans', 'Chinese'],
    ['zh-Hant', 'Chinese'],
    ['en',      'English'],
    ['ja',      'Japanese'],
    ['ko',      'Korean'],
    ['fr',      'French'],
    ['de',      'German'],
    ['es',      'Spanish'],
    ['it',      'Italian'],
    ['pt',      'Portuguese'],
    ['ru',      'Russian']
];

var langMap = new Map(supportLanguages);

function getQwenLangType(bobLang) {
    return langMap.get(bobLang) || 'Auto';
}

exports.supportLanguages = supportLanguages;
exports.langMap = langMap;
exports.getQwenLangType = getQwenLangType;
