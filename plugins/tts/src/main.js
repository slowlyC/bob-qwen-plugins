/**
 * Bob Qwen3 TTS Plugin
 * 基于阿里云 Qwen3-TTS 系列模型的语音合成插件
 *
 * 支持模型:
 *   - qwen3-tts-instruct-flash (指令控制，可调语速/情感/音调)
 *   - qwen3-tts-flash          (标准高速合成)
 *   - qwen-tts                 (旧版兼容)
 */

var lang = require('./lang.js');

// ============================================================
// 常量定义
// ============================================================

var API_ENDPOINTS = {
    cn:   'https://dashscope.aliyuncs.com',
    intl: 'https://dashscope-intl.aliyuncs.com'
};

var API_PATH = '/api/v1/services/aigc/multimodal-generation/generation';

// 单次合成最大字符数 (qwen3 系列 600, qwen-tts 512)
var MAX_CHARS_QWEN3 = 600;
var MAX_CHARS_LEGACY = 512;

// 最大自动重试次数
var MAX_RETRIES = 1;

// 各模型支持的音色白名单 ——
// 用于在选择了不兼容音色时自动降级模型
var INSTRUCT_FLASH_VOICES = [
    'Cherry', 'Serena', 'Ethan', 'Chelsie',
    'Momo', 'Vivian', 'Moon', 'Maia', 'Kai', 'Nofish',
    'Bella', 'Eldric Sage', 'Mia', 'Mochi', 'Bellona',
    'Vincent', 'Bunny', 'Neil', 'Elias', 'Arthur',
    'Nini', 'Seren', 'Pip', 'Stella'
];

var FLASH_ONLY_VOICES = [
    'Jennifer', 'Ryan', 'Katerina', 'Aiden',
    'Bodega', 'Sonrisa', 'Alek', 'Dolce', 'Sohee',
    'Ono Anna', 'Lenn', 'Emilien', 'Andre', 'Radio Gol'
];

var DIALECT_VOICES = [
    'Jada', 'Dylan', 'Li', 'Marcus', 'Roy',
    'Peter', 'Sunny', 'Eric', 'Rocky', 'Kiki'
];

// 错误信息映射
var ERROR_MESSAGES = {
    'InvalidApiKey':    'API Key 无效或已过期，请检查配置',
    'Arrearage':        '阿里云账户余额不足，请充值',
    'Throttling':       '请求频率过高触发限流，请稍后再试',
    'AccessDenied':     '访问被拒绝，请检查 API Key 权限',
    'BadRequest':       '请求参数错误',
    'InternalError':    '阿里云服务内部错误',
    'ModelNotFound':    '模型不存在，请检查模型名称',
    'InvalidParameter': '参数格式错误，请检查输入'
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 判断给定模型是否支持指定音色
 */
function isVoiceSupportedByModel(voice, model) {
    if (model === 'qwen3-tts-instruct-flash') {
        return INSTRUCT_FLASH_VOICES.indexOf(voice) !== -1;
    }
    if (model === 'qwen3-tts-flash') {
        return INSTRUCT_FLASH_VOICES.indexOf(voice) !== -1
            || FLASH_ONLY_VOICES.indexOf(voice) !== -1
            || DIALECT_VOICES.indexOf(voice) !== -1;
    }
    // qwen-tts 仅支持少量音色
    return ['Cherry', 'Serena', 'Ethan', 'Chelsie'].indexOf(voice) !== -1;
}

/**
 * 智能选择最佳模型
 * 当用户选择的模型不支持当前音色时，自动降级
 */
function resolveModel(preferredModel, voice) {
    if (isVoiceSupportedByModel(voice, preferredModel)) {
        return preferredModel;
    }
    // 优先尝试 flash
    if (isVoiceSupportedByModel(voice, 'qwen3-tts-flash')) {
        $log.info('[model-switch] "' + preferredModel + '" 不支持音色 "' + voice + '", 自动切换到 qwen3-tts-flash');
        return 'qwen3-tts-flash';
    }
    // 最后回退到 instruct-flash
    if (isVoiceSupportedByModel(voice, 'qwen3-tts-instruct-flash')) {
        $log.info('[model-switch] 自动切换到 qwen3-tts-instruct-flash');
        return 'qwen3-tts-instruct-flash';
    }
    return preferredModel;
}

/**
 * 获取当前文本的最大字符限制
 */
function getMaxChars(model) {
    if (model === 'qwen-tts') {
        return MAX_CHARS_LEGACY;
    }
    return MAX_CHARS_QWEN3;
}

/**
 * 根据 Bob 语言代码获取 DashScope language_type
 */
function getLanguageType(bobLang, userOverride) {
    if (userOverride && userOverride !== 'Auto') {
        return userOverride;
    }
    return lang.langMap.get(bobLang) || 'Auto';
}

// ============================================================
// Bob 接口实现
// ============================================================

function supportLanguages() {
    return lang.supportLanguages.map(function (item) {
        return item[0];
    });
}

/**
 * 语音合成主函数
 */
function tts(query, completion) {
    var text = query.text || '';

    // 检查语言支持
    if (!lang.langMap.has(query.lang)) {
        completion({
            error: {
                type: 'unsupportLanguage',
                message: '不支持的语言: ' + query.lang
            }
        });
        return;
    }

    // 读取用户配置
    var apiKey = $option.apiKey;
    var region = $option.region || 'cn';
    var modelOption = $option.model || 'qwen3-tts-instruct-flash';
    var preferredModel = modelOption === 'custom'
        ? ($option.customModel || '').trim()
        : modelOption;
    var voice = $option.voice || 'Ethan';
    var languageType = getLanguageType(query.lang, $option.languageType);
    var instructions = ($option.instructions || '').trim();
    var optimizeInstructions = $option.optimizeInstructions === 'true';

    // 校验 API Key
    if (!apiKey) {
        completion({
            error: {
                type: 'secretKey',
                message: '请在插件配置中填入 DashScope API Key',
                troubleshootingLink: 'https://dashscope.console.aliyun.com/'
            }
        });
        return;
    }

    // 校验自定义模型
    if (modelOption === 'custom' && !preferredModel) {
        completion({
            error: {
                type: 'param',
                message: '已选择「自定义模型」但未填写模型名称，请在插件配置中填入模型名'
            }
        });
        return;
    }

    // 智能模型选择 (自定义模型跳过兼容性检查，直接使用)
    var model = modelOption === 'custom' ? preferredModel : resolveModel(preferredModel, voice);

    // instructions 仅在 instruct 模型下生效
    if (model !== 'qwen3-tts-instruct-flash') {
        instructions = '';
    }

    // 文本长度保护
    var maxChars = getMaxChars(model);
    if (text.length > maxChars) {
        completion({
            error: {
                type: 'param',
                message: '文本过长 (' + text.length + ' 字符)，当前模型限制 ' + maxChars + ' 字符',
                addition: '请尝试分段朗读'
            }
        });
        return;
    }

    // 构建请求体
    var baseUrl = API_ENDPOINTS[region] || API_ENDPOINTS.cn;
    var url = baseUrl + API_PATH;

    var inputPayload = {
        text: text,
        voice: voice,
        language_type: languageType
    };

    // 指令控制参数
    if (model === 'qwen3-tts-instruct-flash' && instructions) {
        inputPayload.instructions = instructions;
        if (optimizeInstructions) {
            inputPayload.optimize_instructions = true;
        }
    }

    var requestBody = {
        model: model,
        input: inputPayload
    };

    $log.info('[tts] model=' + model + ', voice=' + voice + ', lang=' + languageType + ', chars=' + text.length);

    sendRequest(url, apiKey, requestBody, 0, completion);
}

// ============================================================
// HTTP 请求 (带重试)
// ============================================================

function sendRequest(url, apiKey, body, retryCount, completion) {
    $http.request({
        method: 'POST',
        url: url,
        header: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
        },
        body: body,
        handler: function (resp) {
            // 网络层错误
            if (resp.error) {
                var statusCode = resp.response ? resp.response.statusCode : 0;

                // 5xx / 网络超时 → 自动重试
                if ((statusCode === 0 || statusCode >= 500) && retryCount < MAX_RETRIES) {
                    $log.info('[retry] HTTP ' + statusCode + ', attempt ' + (retryCount + 1) + '/' + MAX_RETRIES);
                    sendRequest(url, apiKey, body, retryCount + 1, completion);
                    return;
                }

                // 401 / 403 → 提示密钥问题
                if (statusCode === 401 || statusCode === 403) {
                    completion({
                        error: {
                            type: 'secretKey',
                            message: 'API Key 无效或权限不足 (HTTP ' + statusCode + ')',
                            troubleshootingLink: 'https://dashscope.console.aliyun.com/'
                        }
                    });
                    return;
                }

                // 429 → 限流
                if (statusCode === 429) {
                    completion({
                        error: {
                            type: 'api',
                            message: '请求频率过高，请稍后再试 (HTTP 429)',
                            addition: '当前模型限流: Instruct/Flash 180 RPM, 旧版 TTS 10 RPM'
                        }
                    });
                    return;
                }

                var errorType = (statusCode >= 400 && statusCode < 500) ? 'param' : 'api';
                completion({
                    error: {
                        type: errorType,
                        message: '接口请求错误 - HTTP ' + statusCode,
                        addition: JSON.stringify(resp.error)
                    }
                });
                return;
            }

            var data = resp.data;

            // API 业务错误
            if (data.code && data.code !== '' && data.code !== 200 && data.code !== '200') {
                var friendlyMsg = ERROR_MESSAGES[data.code] || data.message || data.code;
                completion({
                    error: {
                        type: 'api',
                        message: friendlyMsg,
                        addition: '错误代码: ' + data.code + (data.request_id ? ' | request_id: ' + data.request_id : '')
                    }
                });
                return;
            }

            // 提取音频 URL
            var audioUrl = extractAudioUrl(data);
            if (!audioUrl) {
                completion({
                    error: {
                        type: 'api',
                        message: '响应中未找到音频 URL',
                        addition: JSON.stringify(data).substring(0, 500)
                    }
                });
                return;
            }

            completion({
                result: {
                    type: 'url',
                    value: audioUrl,
                    raw: data
                }
            });
        }
    });
}

/**
 * 从响应中提取音频 URL，兼容多种返回结构
 */
function extractAudioUrl(data) {
    if (!data || !data.output) return null;
    var output = data.output;

    // 标准路径: output.audio.url
    if (output.audio && output.audio.url) {
        return output.audio.url;
    }
    // 兼容路径: output.url
    if (output.url) {
        return output.url;
    }
    return null;
}

// ============================================================
// 插件生命周期
// ============================================================

/**
 * 自定义超时时间 (秒)
 */
function pluginTimeoutInterval() {
    var timeout = parseInt($option.timeout);
    if (isNaN(timeout) || timeout < 30) return 60;
    if (timeout > 300) return 300;
    return timeout;
}

/**
 * 验证插件配置
 */
function pluginValidate(completion) {
    var apiKey = $option.apiKey;
    if (!apiKey) {
        completion({
            result: false,
            error: {
                type: 'secretKey',
                message: '请填写 API Key',
                troubleshootingLink: 'https://dashscope.console.aliyun.com/'
            }
        });
        return;
    }

    var region = $option.region || 'cn';
    var modelOption = $option.model || 'qwen3-tts-instruct-flash';
    var model = modelOption === 'custom'
        ? ($option.customModel || '').trim() || 'qwen3-tts-instruct-flash'
        : modelOption;
    var baseUrl = API_ENDPOINTS[region] || API_ENDPOINTS.cn;
    var url = baseUrl + API_PATH;

    // 使用默认音色发送测试请求
    $http.request({
        method: 'POST',
        url: url,
        header: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
        },
        body: {
            model: model,
            input: {
                text: 'test',
                voice: 'Ethan',
                language_type: 'Auto'
            }
        },
        handler: function (resp) {
            if (resp.error) {
                var statusCode = resp.response ? resp.response.statusCode : 0;
                if (statusCode === 401 || statusCode === 403) {
                    completion({
                        result: false,
                        error: {
                            type: 'secretKey',
                            message: 'API Key 无效或已过期 (HTTP ' + statusCode + ')',
                            troubleshootingLink: 'https://dashscope.console.aliyun.com/'
                        }
                    });
                } else {
                    completion({
                        result: false,
                        error: {
                            type: 'api',
                            message: '验证失败 - HTTP ' + statusCode,
                            addition: JSON.stringify(resp.error)
                        }
                    });
                }
                return;
            }

            var data = resp.data;
            if (data.code && data.code !== '' && data.code !== 200 && data.code !== '200') {
                completion({
                    result: false,
                    error: {
                        type: 'api',
                        message: 'API 错误: ' + (data.message || data.code)
                    }
                });
                return;
            }

            completion({ result: true });
        }
    });
}

// ============================================================
// 导出
// ============================================================

exports.supportLanguages = supportLanguages;
exports.tts = tts;
exports.pluginTimeoutInterval = pluginTimeoutInterval;
exports.pluginValidate = pluginValidate;
