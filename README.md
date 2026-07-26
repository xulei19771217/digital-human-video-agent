# Digital Human Video Agent

把一份 Markdown 口播脚本编排为完整的数字人短视频生产包：

`脚本 -> Fish Audio 配音 -> HeyGen Avatar V 数字人 -> HyperFrames 包装 -> 字幕、封面与三平台发布文案`

工作流默认生成 720×1280、30fps 的 9:16 竖屏成片。它不会自动充值、付款或发布到社交平台。

## 安装

需要 Node.js 22+、FFmpeg/FFprobe，以及可用的 HyperFrames CLI。

```bash
npm install -g github:xulei19771217/digital-human-video-agent
video-agent --help
```

## 初始化

```bash
video-agent setup
video-agent doctor --json
```

`setup` 只会打开 Fish Audio 与 HeyGen 官方页面，账号注册、条款确认、订阅、充值和付款必须由用户本人完成。

凭据按以下优先级读取，前者覆盖后者：

1. 当前进程环境变量
2. 当前目录 `.env`
3. 用户配置目录的 `credentials.env`

用户配置目录：

- Windows：`%APPDATA%\digital-human-video-agent\`
- macOS：`~/Library/Application Support/digital-human-video-agent/`
- Linux：`${XDG_CONFIG_HOME:-~/.config}/digital-human-video-agent/`

所需变量见 `.env.example`。用户自己的声音、数字人 ID、媒体和 profile 始终保存在本机，不进入本公共仓库。

## 脚本格式

```markdown
---
title: 角马迁徙不是为了躲狮子
hook: 角马迁徙，并不是为了躲避狮子。
facts:
  - 它们追逐的是新鲜牧草和降雨。
cover_time_seconds: 1.5
media_queries:
  - wildebeest migration
---

这里填写完整口播正文。
```

## 运行与续跑

```bash
video-agent run script.md
video-agent run script.md --voice <voice-id> --avatar <avatar-id> --speed 1.3
video-agent run script.md --media-dir ./media --output-dir ./runs
video-agent status
video-agent status <job-id>
video-agent status <job-id> --runs-dir ./runs
video-agent resume <job-id>
video-agent resume <job-id> --runs-dir ./runs
```

Fish Audio 配音和 HeyGen 数字人生成可能消耗积分。已完成阶段会按输入和文件哈希复用；修改封面或发布模板不会重新调用付费阶段。

若付费请求因断网等原因无法确认结果，任务会标记为 `unknown`。程序不会自动重试，以免重复扣费；有 HeyGen 任务 ID 时会优先恢复原任务。

## 媒体与来源

本地 `media` 目录优先。启用 Pexels 时，工作流才会搜索并记录素材来源；没有合适授权素材时，使用图形包装，不编造动物目击概率、路线、价格或联系方式。

## 输出

每个完成任务的 `output` 目录包含：

```text
master.mp4
captions.srt
cover.png
xiaohongshu.md
douyin.md
channels.md
run-report.json
```

三个平台文档是待审核发布包。程序不会登录或自动发布小红书、抖音、视频号。

## 测试

不使用 API、不消耗积分的本地模拟：

```bash
npm test
npm run build
video-agent run tests/fixtures/script.md --mock
```

真实烟测会调用 Fish Audio 和 HeyGen，可能消耗积分。只有在用户明确授权后运行：

```bash
VIDEO_AGENT_LIVE_SMOKE=1 npm run smoke:live
```

PowerShell：

```powershell
$env:VIDEO_AGENT_LIVE_SMOKE = "1"
npm run smoke:live
```

## 安全边界

- 不自动注册、接受条款、订阅、充值或付款。
- 不自动重试结果不明的付费请求。
- 不在报告中保存 API Key、认证头、`.env` 内容或完整 provider 响应。
- 不自动发布到任何社交平台。

## License

MIT
