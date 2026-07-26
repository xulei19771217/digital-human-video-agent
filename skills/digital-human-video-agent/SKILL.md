---
name: digital-human-video-agent
description: Run the Fish Audio to HeyGen Avatar V to HyperFrames workflow from a Markdown script. Use when creating, checking, resuming, or packaging a digital-human short video and its captions, cover, and Xiaohongshu, Douyin, and WeChat Channels publishing documents.
---

# Digital Human Video Agent

1. Run `video-agent doctor --json`.
2. If configuration is missing, run `video-agent setup`.
3. Let the user personally complete registration, terms acceptance, subscription, recharge, or payment.
4. Run `video-agent run <script-path>` only after doctor reports ready.
5. Poll with `video-agent status <job-id>` and resume failed work with `video-agent resume <job-id>`.
6. Never automatically retry a stage marked `unknown`. Explain that a paid call may already exist, and use provider recovery when a saved task ID is available.
7. Present paths for `master.mp4`, `captions.srt`, `cover.png`, the three platform documents, and `run-report.json`.
8. Never publish to a social platform or expose credentials.
9. Use `--mock` for a no-credit local test. Run `npm run smoke:live` only after the user explicitly authorizes the paid smoke test and sets `VIDEO_AGENT_LIVE_SMOKE=1`.
