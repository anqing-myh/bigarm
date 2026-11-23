# Bigarm

Bigarm 是一个包含多款网页游戏的协作仓库。

## 游戏

- [仔仔（Zaizai Arena）](zaizai/README.md)：支持 2–8 人联机的回合制策略游戏，玩家使用临时昵称创建或加入房间，并通过选择招式进行对局。玩法、运行和部署说明见仔仔的 [README](zaizai/README.md)。
- [大臂（Bigarm Arena）](bigarm/README.md)：支持 2–10 人的网页回合竞技；包含独立于网页和房间服务的规则引擎，支持中途选盾、祝福减伤与续结。

## 协作者须知

**每次开始开发前，必须先在仓库根目录执行 `git pull`，同步最新代码后再修改文件。** 推荐使用仅允许快进的方式，避免意外生成合并提交：

```powershell
cd D:\Bigarm
git status
git pull --ff-only
```

如果已有未提交修改，请先提交，或用 `git stash` 保存这些修改；同步后再恢复并继续开发。如提示分支分叉或发生冲突，先与协作者确认并处理，勿强制覆盖本地或远端改动。手动传递文件时，也应以最新版本为基础合并，避免直接替换导致已有功能或修复丢失。

提交或推送仔仔相关改动前，请在 `zaizai/` 目录运行以下验证，并确认全部通过：

```powershell
npm.cmd test
npm.cmd run test:selection
npm.cmd run test:browser
```

浏览器回归测试需要可用的 Playwright/Edge 环境及运行中的游戏服务。完整测试说明和启动方式见 [仔仔 README](zaizai/README.md)。

大臂相关改动在 `bigarm/` 目录运行 `npm.cmd test`；界面或联机流程改动还须运行 `npm.cmd run test:browser`。大臂浏览器测试会自行启动临时服务，不使用仔仔的端口；依赖安装及引擎调用方式见[大臂 README](bigarm/README.md)。
