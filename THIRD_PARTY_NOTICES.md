# 第三方与既有许可说明

根目录 [LICENSE](LICENSE) 的自定义限制仅适用于项目作者有权独立授权的原创部分。第三方代码、既有许可覆盖的代码、模型、素材及依赖继续遵循各自许可证；本说明不为它们增加集成或再分发限制，也不代替完整许可文本。

## 现有前端的 AGPL 许可

项目已有的 [frontend/LICENSE](frontend/LICENSE) 是 GNU Affero General Public License v3，随前端来源项目一同引入。前端现有许可声明予以保留；`frontend/` 及其编译产物 `editor_dist/` 中受 AGPL 约束的部分，继续按 AGPL 处理，其中另有许可声明的第三方内容按对应许可处理。

根目录的自定义许可不会取消 AGPL 授予使用者的权利，也不能取代分发、对应源码提供及网络交互等情形下可能产生的 AGPL 义务。若原创部分与 AGPL 代码形成必须整体按 AGPL 授权的结合作品，不能仅依靠本自定义许可增加限制或免除义务；发布该结合作品前，需要核实授权链和许可兼容性，并取得必要的其他授权或调整实现。

本次保留上游 AGPL，不将其替换为根目录的自定义许可。若希望整个编辑器统一采用“集成需另行授权”的条款，需要先取得相关著作权人的必要授权，或调整实现与许可安排。已经按 AGPL 或其他不可撤销许可授予的有效权利，不能仅通过新增或替换本地许可文件收回。

## 仓库中已识别的主要组件

| 组件或内容 | 位置 | 已保留的许可或声明 |
| --- | --- | --- |
| Cutia 编辑模块 | `frontend/vendor/cutia/` | [MIT 许可文本及 Copyright 2025 Cutia](frontend/vendor/cutia/LICENSE) |
| Longpipe SDK | `frontend/vendor/longpipe/` | [MIT 许可文本](frontend/vendor/longpipe/LICENSE) |
| Longpipe 模型权重 | `frontend/public/models/longpipe/`、`editor_dist/models/longpipe/` | [源文件侧权重许可](frontend/public/models/longpipe/LICENSE)、[构建产物侧权重许可](editor_dist/models/longpipe/LICENSE)，现有文本授予 MIT 条款下的权利 |
| Cutie 跟踪代码 | `vendor/custom-cutout/` | [MIT 许可文本](vendor/custom-cutout/CUTIE-LICENSE.txt)、[来源与修改说明](vendor/custom-cutout/README.md) |
| MOSS 转写解析代码 | `vendor/moss/` | [Apache-2.0 许可文本](vendor/moss/LICENSE)、[NOTICE](vendor/moss/NOTICE) |
| OpenCut Classic 动画适配代码 | `frontend/src/renderer/editing/animation/` 中标有 OpenCut 来源的文件 | 源文件保留 `Copyright 2025-2026 OpenCut` 和 MIT 声明；对应 MIT 文本见下文 |

该表记录当前文件中可识别的许可信息，不代表已对所有依赖和素材完成许可审查。未列出的依赖仍按各自声明处理，不得仅因未在表中列出就认定其适用根目录的自定义许可。

## OpenCut Classic 动画代码的 MIT 声明

适用于上述源文件中标明来自 OpenCut Classic 的代码部分；相关修改及其他部分应结合其各自许可声明判断。

```text
MIT License

Copyright 2025-2026 OpenCut

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 运行时下载的模型、素材和其他依赖

运行时下载的模型、字体、音乐、贴纸等素材，以及 ComfyUI、自定义节点、Python 与 npm 依赖，均按对应权利人的许可证或服务条款处理。根目录许可和本项目作者出具的授权不包含作者无权授予的第三方权利。

许可范围或集成授权咨询：<geleisongde@gmail.com>。
