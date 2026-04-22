# Bob Qwen Plugins

阿里云 Qwen 系列模型的 Bob 插件集合。

## 插件列表

| 插件 | 描述 | 模型 | 版本 |
|------|------|------|------|
| [Qwen3 TTS](./plugins/tts/) | 语音合成，支持 48 种音色和指令级风格控制 | Qwen3-TTS-Instruct-Flash / Flash | v1.1.0 |
| [Qwen VL OCR](./plugins/ocr/) | 高精度文字识别，支持多语言和复杂排版 | Qwen-VL-OCR | v1.1.0 |

## 安装方法

1. 前往 [Releases](../../releases) 页面
2. 下载所需插件的 `.bobplugin` 文件
3. 双击文件，Bob 会自动安装

## 配置

两个插件共用同一个 DashScope API Key，可在 [阿里云百炼控制台](https://dashscope.console.aliyun.com/) 申请。

## 构建

```bash
# 构建所有插件
./scripts/build.sh all

# 仅构建某个插件
./scripts/build.sh tts
./scripts/build.sh ocr
```

构建产物输出到 `dist/` 目录。

## 项目结构

```
├── plugins/
│   ├── tts/                # TTS 语音合成插件
│   │   ├── src/            # 插件源码
│   │   └── appcast.json    # 更新清单
│   └── ocr/                # OCR 文字识别插件
│       ├── src/            # 插件源码
│       └── appcast.json    # 更新清单
├── scripts/
│   └── build.sh            # 构建脚本
├── README.md
└── LICENSE
```

## 官方文档

- [Qwen TTS API 说明](https://help.aliyun.com/zh/model-studio/qwen-tts)
- [Qwen VL OCR API 说明](https://help.aliyun.com/zh/model-studio/qwen-vl-ocr)

## 许可证

MIT License
