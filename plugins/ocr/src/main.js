/**
 * Bob Qwen VL OCR Plugin
 * 基于阿里云 Qwen-VL-OCR 模型的文字识别插件
 *
 * 支持模型:
 *   - qwen-vl-ocr         (稳定版，推荐)
 *   - qwen-vl-ocr-latest  (最新版)
 *   - 各快照版本
 */

// ============================================================
// 常量定义
// ============================================================

var API_ENDPOINTS = {
    cn:   'https://dashscope.aliyuncs.com',
    intl: 'https://dashscope-intl.aliyuncs.com'
};

var API_PATH = '/compatible-mode/v1/chat/completions';

var MAX_RETRIES = 1;

// 支持的语言列表 [Bob语言代码, 显示名]
var SUPPORT_LANGUAGES = [
    'auto', 'zh-Hans', 'zh-Hant', 'en', 'ja', 'ko',
    'fr', 'de', 'es', 'it', 'pt', 'ru'
];

// OCR 提示词 (根据语言优化)
var PROMPTS = {
    'zh-Hans': '请识别并提取图片中的所有文字内容，保持原始排版格式。',
    'zh-Hant': '請識別並提取圖片中的所有文字內容，保持原始排版格式。',
    'en':      'Read all the text in the image. Preserve the original layout.',
    'ja':      '画像内のすべてのテキストを読み取り、元のレイアウトを維持してください。',
    'ko':      '이미지의 모든 텍스트를 읽어주세요. 원래 레이아웃을 유지하세요.',
    'auto':    'Read all the text in the image. Preserve the original layout and formatting.'
};

// 错误信息映射
var ERROR_MESSAGES = {
    'InvalidApiKey':    'API Key 无效或已过期，请检查配置',
    'Arrearage':        '阿里云账户余额不足，请充值',
    'Throttling':       '请求频率过高，请稍后再试',
    'AccessDenied':     '访问被拒绝，请检查权限',
    'BadRequest':       '请求参数错误',
    'InternalError':    '服务内部错误',
    'DataInspectionFailed': '图片内容审核未通过'
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 从 base64 数据头检测图片 MIME 类型
 */
function detectMimeType(base64) {
    if (base64.indexOf('/9j/') === 0 || base64.indexOf('/9J/') === 0) return 'image/jpeg';
    if (base64.indexOf('iVBOR') === 0) return 'image/png';
    if (base64.indexOf('R0lGO') === 0) return 'image/gif';
    if (base64.indexOf('UklGR') === 0) return 'image/webp';
    return 'image/png'; // 默认 PNG
}

/**
 * 获取 OCR 提示词
 */
function getPrompt(langCode) {
    return PROMPTS[langCode] || PROMPTS['auto'];
}

/**
 * 解析 OCR 结果文本为行数组
 */
function parseTexts(content) {
    if (!content || typeof content !== 'string') return [];

    // 去除可能的 markdown 代码块包裹
    var text = content.trim();
    if (text.indexOf('```') === 0) {
        text = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    }

    // 按行分割，过滤空行
    var lines = text.split('\n');
    var result = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line) {
            result.push({ text: line });
        }
    }
    return result;
}

// ============================================================
// Bob 接口实现
// ============================================================

function supportLanguages() {
    return SUPPORT_LANGUAGES;
}

/**
 * OCR 识别主函数
 */
function ocr(query, completion) {
    var imageData = query.image;
    if (!imageData) {
        completion({
            error: {
                type: 'param',
                message: '未获取到图片数据'
            }
        });
        return;
    }

    // 读取用户配置
    var apiKey = $option.apiKey;
    var region = $option.region || 'cn';
    var modelOption = $option.model || 'qwen-vl-ocr';
    var model = modelOption === 'custom'
        ? ($option.customModel || '').trim()
        : modelOption;

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
    if (modelOption === 'custom' && !model) {
        completion({
            error: {
                type: 'param',
                message: '已选择「自定义模型」但未填写模型名称'
            }
        });
        return;
    }

    // 构建 data URL
    var mimeType = detectMimeType(imageData);
    var dataUrl = 'data:' + mimeType + ';base64,' + imageData;

    // 构建请求
    var baseUrl = API_ENDPOINTS[region] || API_ENDPOINTS.cn;
    var url = baseUrl + API_PATH;
    var langCode = query.detectFrom || query.from || 'auto';
    var prompt = getPrompt(langCode);

    var requestBody = {
        model: model,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: { url: dataUrl },
                        min_pixels: 78400,
                        max_pixels: 802816
                    },
                    {
                        type: 'text',
                        text: prompt
                    }
                ]
            }
        ]
    };

    $log.info('[ocr] model=' + model + ', lang=' + langCode);

    sendRequest(url, apiKey, requestBody, 0, langCode, completion);
}

// ============================================================
// HTTP 请求 (带重试)
// ============================================================

function sendRequest(url, apiKey, body, retryCount, langCode, completion) {
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

                // 5xx / 网络超时 → 重试
                if ((statusCode === 0 || statusCode >= 500) && retryCount < MAX_RETRIES) {
                    $log.info('[retry] HTTP ' + statusCode + ', attempt ' + (retryCount + 1));
                    sendRequest(url, apiKey, body, retryCount + 1, langCode, completion);
                    return;
                }

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

                if (statusCode === 429) {
                    completion({
                        error: {
                            type: 'api',
                            message: '请求频率过高，请稍后再试 (HTTP 429)'
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
            if (data.error) {
                var errCode = data.error.code || '';
                var errMsg = ERROR_MESSAGES[errCode] || data.error.message || '未知错误';
                completion({
                    error: {
                        type: 'api',
                        message: errMsg,
                        addition: errCode ? '错误代码: ' + errCode : ''
                    }
                });
                return;
            }

            // 提取识别结果
            var content = '';
            if (data.choices && data.choices.length > 0 && data.choices[0].message) {
                content = data.choices[0].message.content || '';
            }

            if (!content) {
                completion({
                    error: {
                        type: 'api',
                        message: '未识别到文字内容',
                        addition: JSON.stringify(data).substring(0, 500)
                    }
                });
                return;
            }

            var texts = parseTexts(content);
            var from = langCode === 'auto' ? (query.detectFrom || 'zh-Hans') : langCode;

            completion({
                result: {
                    from: from,
                    texts: texts,
                    raw: data
                }
            });
        }
    });
}

// ============================================================
// 插件生命周期
// ============================================================

function pluginTimeoutInterval() {
    var timeout = parseInt($option.timeout);
    if (isNaN(timeout) || timeout < 30) return 60;
    if (timeout > 300) return 300;
    return timeout;
}

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
    // OCR 验证需要发送图片，直接通过 Key 格式判断
    if (apiKey.indexOf('sk-') !== 0) {
        completion({
            result: false,
            error: {
                type: 'secretKey',
                message: 'API Key 格式不正确，应以 sk- 开头'
            }
        });
        return;
    }
    completion({ result: true });
}

// ============================================================
// 导出
// ============================================================

exports.supportLanguages = supportLanguages;
exports.ocr = ocr;
exports.pluginTimeoutInterval = pluginTimeoutInterval;
exports.pluginValidate = pluginValidate;
