# 大臂 · BIGARM ARENA

按规则文档和最新问答实现的 2–10 人网页回合游戏，使用仔仔的深绿、浅绿配色与环形战场布局。无需账号，使用临时昵称。规则版本为 2026-11-24（V2）：68 个行动，包括 6 个基础动作、41 个攻击、11 种装备、10 个法术/辅助动作。新版锤锤锤已恢复；锤、打断、幽灵回旋镖及旧反弹、物理抵消仍停用。

本轮规则见 [V2 实现说明](doc/v2-实现说明.md)、[单回合结算顺序](doc/回合结算顺序.md)和完整 [YAML 招式清单](doc/招式清单.yaml)。

## 启动和联机

需要 Node.js 22+。运行服务没有第三方依赖，首次启动无需安装包：

```powershell
cd D:\games\bigarm\bigarm
npm.cmd start
```

访问 `http://localhost:3200`。同一台电脑可用多个普通标签页模拟多个玩家；身份在各标签页的 sessionStorage 中独立保存，刷新保持身份。复制标签页可能复制身份，可以在右上角更换临时昵称。

Windows 可以双击 `开始游戏.cmd`，或运行：

```powershell
.\start-preview.cmd -LocalOnly
```

创建房间，分享房间号或邀请链接；至少两人且全员准备后开局。两人局单体招式默认选择对手，地震可以选择一名或两名不同目标，回旋镖需要选择方向。头像可查看完整资源、盾层和防御状态。

战场与选招同屏：电脑左右布局，手机上下布局。六种基础资源直接点击按钮；其他招式通过汉字、全拼或拼音首字母模糊搜索（例如“回镖”“huixuanbiao”“hxb”），也可点击“查看所有可出招式”从列表选择。搜索和列表共用规则引擎校验，只展示本回合可用招式；选好后仍需指定目标或方向并锁定。

生命、护盾层数变化会显示短暂飘字，受伤头像会闪动；系统开启“减少动态效果”时改为静态提示。祝福减伤按每次伤害分别分配，提供 1～5 点快捷按钮、任意合法整数输入和“不用”清零；超出该次伤害上限或剩余祝福预算的快捷按钮隐藏，并显示剩余祝福及实际承受伤害。

每次出招会积存同名招式资源，实际护盾、招式库存和持续状态独立保存；点击“招式库存”查看，可消耗两个幽灵闪资源使用相应高级攻击。被锤锤锤取消的新普通法术不获得本次库存，已付成本不返还。持续法术从下一回合开始，状态栏显示法术名称；钻心咒生效时 S/C 按钮标红，实际选择会在开局流失 2 体力，不能用盾、免疫或祝福阻止，仍到回合末才判死。

同一局域网的设备访问服务端电脑的 IPv4 地址加 `:3200`，不能使用其他设备自己的 localhost。首次可能需要在 Windows 防火墙允许 Node.js 的相应网络。

临时公网可沿用仔仔预览方式：安装或提供 `cloudflared.exe`，运行不带 `-LocalOnly` 的 `start-preview.cmd`。可指定 `-CloudflaredPath`、`-Port 3300`、`-NoBrowser`。脚本只停止本次启动的进程，不关闭其他服务；已有同版本服务可复用。临时公网隧道本次未作端到端验证；也可以部署容器或常驻 Node.js 服务并共享固定地址。

```sh
docker build -t bigarm-arena .
docker run --rm -p 3200:3200 bigarm-arena
```

## 模块分层

| 模块 | 职责 |
| --- | --- |
| `rules/catalog.js` | 招式、资源与装备参数，不读取 Excel 或 DOM。 |
| `rules/engine.js` | 行动校验、纯状态转移、互攻、攻击排序、盾交互、持续效果、生命与胜负。没有网络、计时器或 Node.js 专用 API，也可在浏览器导入。 |
| `server/index.js` | 临时身份、2–10 人房间、权限、选招保密、倒计时、弃权、排行榜及 HTTP/SSE。保存可信判定续结状态。 |
| `public/` | 登录、大厅、环形战场、目标/方向选择、中途选择、规则手册和战况记录。不决定最终伤害。 |
| `public/interaction.js` | 拼音模糊匹配、祝福控件额度、已确认状态变化提示等纯界面辅助逻辑，不修改规则状态。 |
| `doc/招式清单.yaml` | 全部招式的成本、资源价值、法术分类、固有/攻击/法术/命中组件与时程，供审阅修改；与代码同步维护。 |
| `test/` | 规则与 HTTP 集成测试，以及独立浏览器回归。 |

服务端选招和浏览器可选招式列表共用 `validateAction`，最终执行只在服务端调用规则模块。可不启动网页，直接在脚本、模拟器、机器人或其他服务中调用引擎。

## 单独调用判定引擎

```js
import {
  createPlayer, createMatch, validateAction,
  beginRound, resumeRound, availableMoves,
} from './rules/engine.js';

const state = createMatch([
  createPlayer('a', '甲', 0),
  createPlayer('b', '乙', 1),
]);
console.log(availableMoves(state, 'a').map(move => move.name));
const actions = {
  a: validateAction(state, 'a', { move: 'basicB' }),
  b: validateAction(state, 'b', { move: 'basicF' }),
};
let result = beginRound(state, actions);

// 有多种合法承伤盾、小电移除对象、祝福分配或必要弃置方案时：
if (result.status === 'choice') {
  const request = result.pending;
  // 实际应用应让 request.playerId 对应玩家决定，示例仅使用零减伤/第一项。
  const answer = request.kind === 'blessing' ? {} : request.options[0].id;
  result = resumeRound(result, request.playerId, request.id, answer);
}
// 可能连续需要多次选择；每次继续检查 status，直到 complete。
if (result.status === 'complete') {
  console.log(result.state, result.damage, result.logs);
}
```

`beginRound`、`resumeRound` 不修改传入的状态或续结对象。非法输入抛出异常，不把部分状态提交回输入。结果是可 JSON 序列化的数据，可保存后恢复：

```js
const stored = JSON.stringify(result);
const restored = JSON.parse(stored);
```

不要把客户端传回的整个续结对象作为可信状态。房间服务应保存原续结，只接受玩家、选择请求 ID 和答案；`resumeRound` 会核对归属及当前选择 ID，拒绝旧选择和越权。

### 状态与选择格式

- `createPlayer(id, name, seat)`：初始 5 生命、上限 5。`resources.B/Z/F/Y/S/C/Q` 为基础资源与祝福，其他资源键为非基础招式 ID（如 `ghostDodge`、`voidDodge`、`punch`），均初始为 0。装备为 `shields`，具名状态为 `effects`，实际基础动作历史为 `history`。
- `createMatch(players)`：初始第 1 回合；`ongoing` 保存持续攻击，`nextId` 分配稳定事件/实例编号。
- 普通单体输入 `{move,target}`，地震 `{move:'quake',targets:[id1,id2]}`（也可一个），回旋镖 `{move:'boomerang',direction:'clockwise'}` 或 `counterclockwise`。校验后使用统一的 `targets` 数组；规范化行动可以再次直接传给引擎。
- 完成结果 `status:'complete'`，含下一回合 `state`、`completedRound`、`logs`、逐次 `damage`、独立的 `lifeLoss`、`finished`、`winnerId`、`hasDamage` 和 `hasLifeLoss`。体力流失不在伤害账本内。
- 等待结果 `status:'choice'`，`pending` 含 `id`、`playerId`、`kind`、合法 `options`。装备答案为选项 ID；祝福答案为 `{伤害事件ID:非负整数}`，省略表示 0，不能超预算或把单次伤害减到 0。
- 续结只执行当前未完成步骤，不重复扣费、生成攻击或发放命中收益。一次攻击穿过多个盾也只触发一次命中收益。

点数用十分之一整数计算；招式库存价值按原成本递归折算。生命与伤害只使用当前规则中的整数或 0.5。回旋镖按路径预分配点数后全量入队，高点先行；弧光仅反转数值互攻关系，不改投递队列。持续/延迟攻击来源死亡仍可攻击活目标，目标死亡则移除，不保留空转。持续法术状态从次回合起，普通持续攻击仍含施放回合，飞刀只下一回合一次。

YAML 清单中的 `is_spell` 用于审阅行动是否含法术效果，与法术攻击属性分开；当前程序读取 `rules/catalog.js`。以后修改/新增招式要同步更新清单、规则和测试，启动或测试不会覆盖 YAML。显式重新导出可运行 `node scripts/export-rules.mjs --write`，但应先合并清单中的人工修改。

## 联机层的默认约定

这些计时和身份行为属于服务层，不改变独立引擎：

- HTTP 提交操作；网页以串行轮询同步，兼容会缓冲 SSE 的代理；同时保留 SSE 端点供其他客户端使用。
- 选招默认 30 秒，超时出免费基础大臂；全员提前锁定即揭晓。选择期只公开谁已锁定，不公开对方招式。
- 中途选择默认 45 秒，超时选择第一项合法装备方案或零祝福减伤；引擎本身没有这些自动代选和时限。
- 断线保留 60 秒可重连。主动离房或断线超时视为弃权，当前回合已锁定招式完成，未锁定补基础大臂；当前轮末标记弃权者阵亡。离场者的中途选择由服务层代选。
- 无生命伤害且无体力流失时展示 2 秒，否则展示 5 秒。最终胜负锁定后，胜者离房不改结果；胜场每局只累计一次，重新准备重置战斗资源。
- 身份、房间、战报和胜场保存在单进程内存中，服务重启清空；没有跨实例共享存储。

配置：`PORT=3200`、`SELECTION_MS=30000`、`CHOICE_MS=45000`、`DISCONNECT_MS=60000`（后三项单位毫秒）。创建服务时也可通过 `createServer(options)` 注入测试计时。

## 测试

```powershell
npm.cmd test
```

规则和 HTTP 测试只需要 Node.js，不依赖浏览器。浏览器测试需安装开发依赖，以及可用的 Edge 或 Chromium：

```powershell
npm.cmd ci
npm.cmd run test:browser
```

Windows 默认使用系统 Edge；其他环境可安装 Playwright Chromium，或使用 `BROWSER_PATH` 指定可执行文件。有现成 Playwright 时也可设置 `PLAYWRIGHT_MODULE_DIR` 指向其包目录，避免重复安装。

浏览器回归自行启动和关闭临时服务，使用独立浏览器身份，覆盖首页、手册、加入/准备、选招保密、汉字/拼音/首字母搜索、可用招式列表、真实攻击与护盾提示、刷新后选盾续结、电脑与小屏手机同屏布局、十人战场、祝福共享预算、具名状态、钻心咒红色提醒、实际招式库存积存/消费、体力流失、战报、结果与邀请。截图输出到被 Git 忽略的 `test-results/`。

规则依据见[游戏规则与判定](doc/游戏规则与判定-1.md)和[条件明确](doc/条件明确-1.md)。修改前先按根 README 同步仓库；规则修改运行 `npm test`，界面或联机修改还需浏览器回归。
