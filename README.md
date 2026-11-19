# Bigarm

Bigarm 是一个包含多款网页游戏的协作仓库。

## 游戏

- [仔仔（Zaizai Arena）](zaizai/README.md)：支持 2–8 人联机的回合制策略游戏，玩家使用临时昵称创建或加入房间，并通过选择招式进行对局。玩法、运行和部署说明见仔仔的 [README](zaizai/README.md)。
- `bigarm/`：大臂游戏素材目录，游戏尚未实现。

## 协作者须知

提交或推送仔仔相关改动前，请在 `zaizai/` 目录运行以下验证，并确认全部通过：

```powershell
npm.cmd test
npm.cmd run test:selection
npm.cmd run test:browser
```

浏览器回归测试需要可用的 Playwright/Edge 环境及运行中的游戏服务。完整测试说明和启动方式见 [仔仔 README](zaizai/README.md)。
