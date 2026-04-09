# ComfyUI-3D-OpenPose-Editor2026 詳細實作計畫

## 文件目的

本文件將目前 `ComfyUI-3D-OpenPose-Editor2026` 的現況分析整理成可執行的實作計畫，重點涵蓋：

- `js/` 遺留程式碼是否仍有實際用途，以及安全移除策略
- 3D pose editor 應補強的核心功能
- 3D 模式背景圖故障的修正方案
- 程式邏輯與數學實作的校正重點
- 額外的 UI / 相機 / 操作體驗優化

本文件目前是「設計與施工計畫」，不是已完成變更的說明。

## 目標

1. 在不破壞目前可用功能的前提下，修復 3D 模式背景圖。
2. 將 3D 編輯模式從「可用」提升到更接近真正 pose 軟體的操作水準。
3. 釐清並逐步移除 legacy `js/` 遺留內容，但只在有充分證據時進行。
4. 修正目前數學與狀態同步上的不一致問題。
5. 建立可回歸驗證的實作順序，避免再次引入與其他 OpenPose editor 的前端衝突。

## 非目標

- 本輪不引入 full-body IK、手指 rig、碰撞偵測、物理模擬。
- 本輪不修改 `ComfyUI-OpenPose-Studio` 專案。
- 本輪不先做大型檔案拆分或 build system 重構，先以穩定修正為主。

## 現況證據與結論

### 1. Active frontend 已經是 `web/`，不是 `js/`

證據：

- `__init__.py:44` 設定 `WEB_DIRECTORY = "./web"`
- `TECHNICAL_REPORT.md` 已明確記錄 `js/` 是 legacy frontend

結論：

- 執行期活躍路徑應以 `web/openpose.js` 為準
- `js/` 很可能只剩歷史遺留與備份用途
- 但因歷史上曾有 duplicate bootstrap / mixed-editor conflict 問題，`js/` 不能在未驗證前直接整包刪除

### 2. `js/` 幾乎可判定為遺留內容，但目前不宜直接暴力移除

證據：

- repo 搜尋沒有發現任何 runtime 設定再把前端入口指回 `js/`
- `js/openpose.js` 與 `web/openpose.js` 都保留 bootstrap guard，但 active path 只有 `web/`
- `js/openpose.js` 仍嘗試載入 `./vendor/three.min.txt`，但 active fallback 已位於 `web/vendor/three.min.txt`

結論：

- `js/openpose.js`
- `js/openpose.js.backup`
- `js/OrbitControls.js`
- `js/three.min.js`
- `js/fabric.min.js`

以上高度疑似為遺留資產，但需在 GUI 實測與 mixed-editor 共存回歸通過後再分階段刪除。

### 3. 3D 模式背景圖目前是結構性失效，不是單一小 bug

證據：

- 進入 3D 模式時，2D Fabric canvas 會被整個隱藏：`web/openpose.js:2531-2547`
- 3D scene 初始化為黑底：`web/openpose.js:3937-3938`
- 目前 3D scene 中沒有對應背景平面、背景材質或背景 texture 同步機制
- 背景圖目前只會套用到 Fabric canvas：
  - 初始化載入：`web/openpose.js:1723-1740`
  - 上傳背景：`web/openpose.js:3487-3521`
  - 執行後重載：`web/openpose.js:7190-7204`

結論：

- 只要切到 3D，背景就會因 2D canvas 被隱藏而消失
- 修法不應只改 URL 或 `setBackgroundImage`
- 必須在 3D scene 內建立真正的背景層；優先方案為 `THREE.Scene.background = texture`，若 bundled Three.js 版本或透明度需求不相容，再退回 orthographic background quad

### 4. 背景圖狀態有 round-trip 問題，`subfolder` 會遺失

證據：

- 背景圖上傳後只把 `data.name` 存進 `backgroundImage`：`web/openpose.js:3501-3506`
- 即時載入時使用了 `subfolder=${data.subfolder}`：`web/openpose.js:3508`
- 後續重新載入背景時，卻只拿 `backgroundImage` 當檔名，沒有 `subfolder`：
  - `web/openpose.js:1526`
  - `web/openpose.js:6366`
  - `web/openpose.js:7191`

結論：

- 若背景圖位於子資料夾，重新打開 panel、重新執行 workflow、pause/resume 後，都可能找不到正確背景圖
- `backgroundImage` 需要升級成可表達完整背景資產資訊的資料格式

### 4.1 目前 bundled Three.js fallback 版本可支援 `Scene.background`

證據：

- `web/vendor/three.min.txt` 內可找到 `THREE.REVISION = "128"`

結論：

- bundled fallback 版本本身足以支援 `THREE.Scene.background = texture`
- 但仍需在實作時確認「實際執行期使用的是 shared Three.js 還是 bundled fallback」
- 若 shared runtime 版本未知，仍應保留 runtime capability check

### 5. 目前相機控制其實偏向「旋轉模型」，不是完整 3D 相機系統

證據：

- `setup3DOrbitControls()` 中右鍵拖曳會直接旋轉所有點與 `threeModelQuaternion`：`web/openpose.js:3992-4094`
- 真正 camera state 雖有 `theta / phi / radius`，但主要只在 reset / load / init 時使用：`web/openpose.js:1836-1869`
- scene 僅使用 `PerspectiveCamera`，沒有 orthographic / preset view 支援：`web/openpose.js:3943`

結論：

- 現狀不利於實作「正視圖 / 側視圖 / 垂直轉動相機 / 正交視圖」
- 應將「相機 orbit」與「模型旋轉」明確拆開

### 6. IK 只支援端點，肘 / 膝拖曳目前會破壞比例

證據：

- `TWO_BONE_IK_CHAINS` 只定義四條以手腕 / 腳踝為 end effector 的鏈：`web/openpose.js:147-152`
- 點拖曳時，只有選中單點且該點符合 IK end effector 時，才進入 IK：`web/openpose.js:4848-4853`
- gizmo 平移時也只對同樣情況套用 IK：`web/openpose.js:5957-5964`

結論：

- 目前拖肘 / 拖膝屬於一般平移，不保骨長
- 這與使用者期望的「不改變比例移動手肘或膝蓋」不一致

### 7. 已有數學與邏輯不一致點，應納入修正

證據：

- `Add` 在 3D 模式下會先 `clear3DPose()` 再新增：`web/openpose.js:6081-6086`
- `rotate3DSelection()` 計算了 `rotationAxis`，但實際旋轉仍使用 `cameraDirection`，造成旋轉語意與滑鼠方向不完全一致：`web/openpose.js:5042-5056`
- `sync3DTo2DCanvas()` 會把超出畫面的點強制夾回畫布邊界：`web/openpose.js:3223-3228`
- `three_pose_data` 目前只看到寫入，沒看到讀回：`web/openpose.js:7001-7003`
- `analyzePoseAndGenerateDescription()` 在 `animate3D()` 每 frame 執行：`web/openpose.js:3980-3988`

結論：

- 目前存在 state drift、行為語意錯誤與不必要的每幀負擔
- 這些應在功能新增前先一起納入修正範圍

### 8. `inputPose` 與 `three_pose_data` 都有潛在邊界風險

證據：

- `nodes.py` 中 `inputPose` UI 欄位目前回傳的是 `ld_filepath`，即本機絕對路徑，而不是 ComfyUI 可重載的 filename：`nodes.py:405-408`、`nodes.py:555-560`
- `web/openpose.js` 的 `onExecuted()` 會把 `inputPose` 收到的值再塞回 `backgroundImage` 路徑流程中：`web/openpose.js:7173-7181`
- `three_pose_data` 目前只看到寫入 `node.properties`，沒有發現明確讀回邏輯：`web/openpose.js:7001-7003`

結論：

- `inputPose` 是既有獨立 bug，Phase 1 修背景時很容易一起踩到
- `three_pose_data` 看似無讀用途，但在正式移除前仍要先驗證是否有 workflow serialization 邊界情況依賴它

## 目標架構

### 架構原則

1. `node.properties` 是持久狀態來源，但不應再保存殘缺格式。
2. 2D 與 3D 必須共享同一份 pose state 與 background state。
3. 2D 背景與 3D 背景必須由同一個 background descriptor 驅動。
4. camera 狀態、model 旋轉、pose 資料應清楚分層，不互相混用。
5. 所有 legacy 清理必須走「先停用 / 驗證，再刪除」。

### 狀態分層

- `poses_datas`
  - 仍作為主要 pose JSON
  - 保持相容既有 `width / height / people / _3d_pose_data`
- `backgroundImage`
  - 升級為可 backward compatible 的背景描述格式
  - 舊資料仍接受純檔名字串
  - 新資料建議接受 JSON string
- `threePoseData`
  - 編輯期的 3D point / connection 狀態
- `threeCameraState`
  - camera 的 `theta / phi / radius`
- `threeModelQuaternion`
  - 模型額外旋轉

### 相機與模型旋轉的序列化策略

- `_3d_pose_data.camera_state`
  - 專職保存 orbit camera 的 `theta / phi / radius`
  - 視角預設、滑鼠 orbit、zoom、pan 只修改這個欄位
- `_3d_pose_data.model_rotation`
  - 只保存「明確模型旋轉工具」造成的旋轉
  - 不應再被一般 right-drag 相機操作污染
- backward compatibility
  - 舊 JSON 若同時含有 `camera_state` 與 `model_rotation`，仍完整還原
  - 新版 save 仍維持相同欄位名稱，避免破壞既有載入流程
- 實作原則
  - `Reset View` 重設的是 camera view state
  - `Reset Model Rotation` 若要提供，應是獨立動作
  - `setCameraPreset()` 只改 `camera_state`，不改 `model_rotation`

### 骨架座標系與視角命名校準

目前預設 3D 點位初始化方式為：

- `x = circle.left - canvas.width / 2`
- `y = -(circle.top - canvas.height / 2)`
- `z = 0`

因此可先採用以下暫定座標語意：

- `+X`：畫面右方
- `+Y`：世界上方
- `+Z`：初始相機所在方向

但 `Front / Back` 的命名仍需在實作前做一次校準，原因是：

- 預設骨架在世界座標中的「面向前方」不是由座標公式直接保證
- 現有程式還有 `threeModelQuaternion` 與姿態描述中的 facing 推論邏輯

因此正式實作時，必須先建立一份 `CAMERA_PRESET_CALIBRATION`：

- 載入預設骨架
- 記錄 `theta=0, phi=π/2` 與 `theta=π, phi=π/2` 各自對應的使用者感知視角
- 確認後再把它命名為 `Front` 或 `Back`

### 建議背景描述格式

前端與後端皆需接受以下兩種格式：

1. legacy：

```json
"my_background.png"
```

2. 新格式：

```json
{
  "filename": "my_background.png",
  "subfolder": "",
  "type": "input",
  "opacity": 0.6
}
```

理由：

- 不破壞舊 workflow
- 可以正確 round-trip `subfolder`
- 也能把背景透明度與後續 3D 同步參數納入狀態

## 檔案級操作計畫

### 1. `web/openpose.js`

這是主戰場，預計分成以下修改群組。

#### A. 背景狀態正規化

新增或重構以下 helper：

- `parseBackgroundState(rawValue)`
- `serializeBackgroundState(state)`
- `buildBackgroundViewUrl(state)`
- `setBackgroundState(state, { syncNode, syncCanvas, sync3D })`
- `clearBackgroundState()`

修改位置：

- `loadBackgroundImage()`
- panel 初始化背景載入
- `openpose_node_pause` 事件背景回填
- `onExecuted()` 背景回填
- `Reset`
- `Clear Background`

目的：

- 所有路徑都走同一個 background API
- 避免不同區塊自己組 `/view?filename=...`
- 修掉 `subfolder` 遺失與 2D/3D 不一致

#### B. 3D 背景真正實作

新增：

- `threeBackgroundTexture`
- `syncThreeSceneBackgroundFromState()`
- `clearThreeSceneBackground()`
- `supportsSceneBackgroundTexture()`
- fallback only:
  - `syncThreeBackgroundQuadFromState()`
  - `disposeThreeBackgroundQuadResources()`

設計：

- 以 `THREE.Scene.background = texture` 作為優先方案
- 先確認 `web/vendor/three.min.txt` 與執行期 shared Three.js 是否支援 texture background
- 若 `Scene.background` 不能滿足透明度、裁切或版本需求，再退回 orthographic quad
- 背景圖 URI 一律由 `buildBackgroundViewUrl()` 組裝
- 2D 與 3D 使用同一份 background state
- 切回 2D 時不重置背景 state

預期修改點：

- `enter3DMode()`
- `resizeCanvas()`
- `loadBackgroundImage()`
- `Clear Background`
- `Reset`
- `loadJSON()` 後的背景重建

#### C. 相機系統重整

新增：

- `orbitCameraByDelta(deltaX, deltaY)`
- `panCameraByDelta(deltaX, deltaY)`
- `zoomCameraByDelta(deltaY)`
- `setCameraPreset(name)`
- `frameModel()`
- `focusSelection()`
- `setProjectionMode(mode)`

行為調整：

- 右鍵拖曳改為 orbit camera，不再直接旋轉整個模型
- 保留模型旋轉作為獨立工具或 modifier
- `phi` 做 clamp，避免翻越極點後操作反轉
- 先完成 `CAMERA_PRESET_CALIBRATION`，再決定 `Front / Back` 最終 `theta` 定義
- 支援：
  - `Front`
  - `Back`
  - `Left`
  - `Right`
  - `Top`
  - `Reset`
- 視需求加入 `Perspective / Orthographic`

序列化要求：

- orbit 行為只更新 `_3d_pose_data.camera_state`
- 顯式模型旋轉工具才更新 `_3d_pose_data.model_rotation`
- `serialize3DJSON()` 與 `loadJSON()` 的欄位結構維持相容，不改 key 名稱
- 新增視角 preset 後，需驗證 save/load 後視角重建與 preset 命名一致

原因：

- 使用者要求的「正視圖、側視圖、垂直轉動相機」必須建立在真正的相機系統上

#### D. 鏡像功能

新增：

- `mirrorPose3D({ poseIds, axis, swapLeftRight })`
- `mirrorAllPoses3D()`
- `mirrorSelectedPose3D()`
- `mirror2DPeopleData(people, canvasWidth)`

核心規則：

- 明確採用模型 local 空間做鏡像，不使用單純 world centroid 反射
- 左右關節必須交換：
  - shoulder
  - elbow
  - wrist
  - hip
  - knee
- ankle
  - eye / ear
- 維持骨長與 `z` 深度語意一致

實作原則：

- 先以 `threeModelQuaternion` 的反向四元數將點位轉回 model-local frame
- 在 local frame 內以 pose center 或 pelvis / neck 中線進行 X 軸反射
- 完成左右 joint swap 後，再重新套回 `threeModelQuaternion`
- 若 pose filter 啟用，鏡像只影響當前 poseId

UI：

- 新增 `Mirror Pose`
- 如有 pose filter，支援只鏡像當前 pose

#### E. 肘 / 膝比例保持編輯

新增：

- `findMidJointConstraintChain(obj)`
- `solveMiddleJointConstraint(obj, targetPosition)`
- `dragJointWithConstraints(obj, targetPosition)`

規則：

- 若選到 elbow / knee：
  - 固定 parent-mid 與 mid-end 的骨長
  - 修改 mid joint 的彎曲平面與夾角
  - end joint 跟著重定位
- 若選到 wrist / ankle：
  - 維持現有 two-bone IK
- 若選到其他點：
  - 視情況維持平移或 FK

目的：

- 滿足「不改變比例的情況下一動手肘或膝蓋」

數學定義：

- `buildStableBendPlane(root, end, target, camera)`
  - 先取 `root->end` 與 `root->target` 張成平面
  - 若兩向量近共線，退回 `cross(root->end, cameraForward)`
  - 若仍退化，退回 `cross(root->end, worldUp)`
- `projectTargetToBendSolution(root, end, target, lenA, lenB, planeNormal)`
  - 設 `d = |root->target|`
  - 夾取 `d` 到 `[abs(lenA-lenB)+eps, lenA+lenB-eps]`
  - `projectedLength = (d^2 + lenA^2 - lenB^2) / (2d)`
  - `perpendicularLength = sqrt(max(0, lenA^2 - projectedLength^2))`
  - `mid = root + dir * projectedLength + bendDir * perpendicularLength`
- `enforceEndFromMid(root, mid, target, lenA, lenB)`
  - 先決定 clamped target
  - 再以 root-mid-end 順序做 forward pass，確保兩段骨長不變

Undo/Redo 要求：

- 3D 互動目前沒有真正整合到 `undo_history`
- 本輪新增的肘 / 膝約束、鏡像、視角 preset、模型旋轉，至少要在 discrete action 結束時推入 3D snapshot
- 建議在 `mouseup`、toolbar action、mirror action、load 完成後推入 `serialize3DJSON()` 快照，而不是每 frame 記錄

#### F. Gizmo 與顯示比例優化

新增：

- `computeAdaptiveGizmoScale()`
- `applyAdaptiveGizmoScale()`
- `setGizmoSizeMultiplier(multiplier)`

調整：

- 目前 `arrowLength = 100` 與 ring `radius = 110` 為硬編碼，改為依 camera distance 自適應
- 點球大小與 hover/selected scale 也應一起校正
- 新增 UI 控制：
  - `Gizmo Size`
  - `Point Size` 可選

目的：

- 使用者可以把 gizmo 調小
- 遠近縮放時仍維持可操作但不擋畫面

#### G. 邏輯與數學修正

預計修正：

- `add3DPose()` 不應先清空全部 pose
- `rotate3DSelection()` 應明確決定：
  - 要嘛真正使用 `rotationAxis`
  - 要嘛保留 camera-view-axis 旋轉，但同步修正命名與 UI 語意
- `sync3DTo2DCanvas()` 不應硬夾投影點到邊界
- `update3DOrbitCenter()` 不應在每次編輯都重算成全模型中心，避免 camera target 漂移
  - 保留更新時機：
  - `add3DPose()` 完成後
  - `loadJSON()` / `deserialize3DJSON()` 完成後
  - `Frame All` / `Focus Selection` 明確指令時
  - 可選：多選 translate 結束於 `mouseup` 後
  - 不在 single-point drag、單次 gizmo 微調、每 frame render 後自動更新
- `three_pose_data` 若無讀用途，應移除這條殘留 state
- 但移除前要先驗證：
  - repo 內無任何讀取點
  - workflow reopen 不依賴 `node.properties.three_pose_data`
  - 可先在 `panel.close()` 增加暫時性 instrumentation 做驗證

#### H. 效能與狀態更新優化

新增：

- `schedulePoseDescriptionUpdate()`
- `mark3DDirty(flags)`

調整：

- `analyzePoseAndGenerateDescription()` 改為 interaction 後 debounce，不再每 frame 執行
- DOM 顯示與 JSON 回寫分流：
  - editor 內文字預覽可 debounce 更新
  - `poses_datas.posture_description` 只在 `mouseup`、save、panel close、explicit sync 時回寫
- 減少不必要的 `render3DPose()` 全量重建

### 2. `nodes.py`

預計修改內容：

#### A. 背景狀態解析

新增：

- `parse_background_image_payload(raw_value)`
- `resolve_background_image_path(payload)`

目標：

- 同時接受 legacy string 與 JSON string
- 在 backend 合成 `dw_combined_image` 時能正確找到帶 `subfolder` 的背景圖
- 第一階段先審計 `folder_paths.get_annotated_filepath(backgroundImage)` 的相容性，再修改；不可直接把 JSON string 原樣傳進去

實作順序要求：

1. 先在 backend 加上 `parse_background_image_payload()`
2. 確認 parser 輸出仍能安全呼叫 `folder_paths.get_annotated_filepath(filename)`
3. 再修改前端把 `backgroundImage` 寫成新格式

原因：

- 若先改前端、不改後端，`dw_combined_image` 的背景合成立即會壞掉

#### B. UI 回傳格式一致化

檢查並必要時調整：

- `ui_data["backgroundImage"]`
- `ui_data["inputPose"]`

目標：

- 前端不再收到殘缺背景資訊
- pause/resume / executed / reopen 都能使用同一格式
- `inputPose` 不再傳本機絕對路徑，而是傳可被 `/view` API 正確讀取的 filename / descriptor

#### C. 相容性維持

限制：

- 不破壞現有只傳檔名的 workflow
- 如解析失敗，退回 legacy 路徑

### 3. `__init__.py`

預計操作：

- 原則上不改 functional 行為
- 保留 `WEB_DIRECTORY = "./web"`
- 若需要，僅補註解說明 `js/` 為 legacy 非 active frontend

### 4. `README.md` / `README.zh-TW.md`

待功能完成後更新：

- 新增背景圖在 3D 模式可用的說明
- 新增 view presets / mirror / elbow-knee constrained editing
- 更新快捷鍵與 toolbar 說明

### 5. `TECHNICAL_REPORT.md` / `TECHNICAL_REPORT.zh-TW.md`

待功能完成後更新：

- 補一節記錄本輪架構調整
- 特別說明：
  - 3D background fix
  - camera system refactor
  - constraint-based elbow / knee editing
  - legacy js retirement

### 6. `js/` 目錄

#### 原則

不直接刪整包。

#### 分階段操作

Phase A：

- 保留全部檔案
- 完成 `web/` 版本所有功能修正
- 做 GUI 驗證

Phase B：

- 若確認無引用，先刪：
  - `js/openpose.js.backup`

Phase C：

- 若確認 mixed-editor 共存正常，刪：
  - `js/openpose.js`
  - `js/OrbitControls.js`
  - `js/three.min.js`
  - `js/fabric.min.js`
  - `js/vendor/`

Phase D：

- 若 repo 內再無用途，移除空目錄 `js/`

#### 證明要求

只有在以下條件全成立時才刪：

1. `WEB_DIRECTORY` 確認仍指向 `./web`
2. repo 搜尋沒有任何 active runtime 路徑引用 `js/`
3. GUI 實測通過
4. 與 `ComfyUI-OpenPose-Studio` 共存回歸通過

## 關鍵實作草案

### 1. 背景狀態正規化

```js
function parseBackgroundState(rawValue) {
    if (!rawValue || typeof rawValue !== "string") return null;
    try {
        const parsed = JSON.parse(rawValue);
        if (parsed && typeof parsed === "object" && parsed.filename) {
            return {
                filename: parsed.filename,
                subfolder: parsed.subfolder || "",
                type: parsed.type || "input",
                opacity: Number.isFinite(parsed.opacity) ? parsed.opacity : 0.6,
            };
        }
    } catch (_) {
    }
    return {
        filename: rawValue,
        subfolder: "",
        type: "input",
        opacity: 0.6,
    };
}

function serializeBackgroundState(state) {
    if (!state?.filename) return "";
    return JSON.stringify({
        filename: state.filename,
        subfolder: state.subfolder || "",
        type: state.type || "input",
        opacity: state.opacity ?? 0.6,
    });
}

function buildBackgroundViewUrl(state) {
    const subfolder = state.subfolder ? `&subfolder=${encodeURIComponent(state.subfolder)}` : "";
    return `/view?filename=${encodeURIComponent(state.filename)}&type=${state.type || "input"}${subfolder}&t=${Date.now()}`;
}
```

### 2. 3D 背景同步

```js
function supportsSceneBackgroundTexture() {
    return !!(this.threeScene && globalThis.THREE && "background" in this.threeScene);
}

async function syncThreeSceneBackgroundFromState() {
    const state = parseBackgroundState(this.node.properties.backgroundImage);
    if (!state) {
        this.clearThreeSceneBackground();
        return;
    }

    const texture = await loadThreeTexture(buildBackgroundViewUrl(state));
    if (this.threeBackgroundTexture) {
        this.threeBackgroundTexture.dispose();
    }

    this.threeBackgroundTexture = texture;

    if (supportsSceneBackgroundTexture.call(this)) {
        this.threeScene.background = texture;
        return;
    }

    // Fallback only when current Three.js runtime cannot provide scene background semantics we need.
    await this.syncThreeBackgroundQuadFromState(texture, state);
}
```

### 3. 相機預設

```js
function setCameraPreset(name) {
    const presets = {
        front: { theta: THETA_FRONT, phi: PHI_LEVEL },
        back: { theta: THETA_BACK, phi: PHI_LEVEL },
        left: { theta: THETA_LEFT, phi: PHI_LEVEL },
        right: { theta: THETA_RIGHT, phi: PHI_LEVEL },
        top: { theta: THETA_TOP, phi: PHI_TOP },
    };

    const preset = presets[name];
    if (!preset) return;

    this.threeCameraState = {
        ...this.threeCameraState,
        theta: preset.theta,
        phi: preset.phi,
    };

    this.applyThreeCameraState(this.threeCameraState, this.threeOrbitCenter);
}
```

說明：

- `THETA_FRONT / THETA_BACK` 不在計畫階段硬編碼
- 先完成 `CAMERA_PRESET_CALIBRATION`，再把「哪個 theta 是使用者眼中的 front」固定下來

### 4. 肘 / 膝約束拖曳

```js
function solveMiddleJointConstraint(midObj, targetPosition) {
    const chain = findMidJointConstraintChain(midObj);
    if (!chain) return false;

    const root = getThreePointObjectByIds(chain.root, midObj.userData.poseId);
    const end = getThreePointObjectByIds(chain.end, midObj.userData.poseId);
    if (!root || !end) return false;

    const lenA = root.position.distanceTo(midObj.position);
    const lenB = midObj.position.distanceTo(end.position);

    const polePlane = buildStableBendPlane(root.position, end.position, targetPosition, this.threeCamera);
    const projectedMid = projectTargetToBendSolution(root.position, end.position, targetPosition, lenA, lenB, polePlane);
    const projectedEnd = enforceEndFromMid(root.position, projectedMid, targetPosition, lenA, lenB);

    midObj.position.copy(projectedMid);
    end.position.copy(projectedEnd);
    syncPointData(midObj);
    syncPointData(end);
    return true;
}
```

### 5. 自適應 gizmo 尺寸

```js
function computeAdaptiveGizmoScale() {
    if (!this.threeCamera || !this.threeTransformGizmo) return 1;
    const distance = this.threeCamera.position.distanceTo(this.threeTransformGizmo.position);
    const normalized = Math.max(0.35, distance / 350);
    return normalized * (this.gizmoSizeMultiplier || 1);
}

function applyAdaptiveGizmoScale() {
    const scale = this.computeAdaptiveGizmoScale();
    this.threeTransformGizmo.scale.setScalar(scale);
}
```

### 6. 姿態描述回寫策略

```js
function schedulePoseDescriptionUpdate({ commitToJson = false } = {}) {
    clearTimeout(this._poseDescriptionTimer);
    this._poseDescriptionTimer = setTimeout(() => {
        const description = this.analyzePoseAndGenerateDescription({ writeToJson: false });
        this.updatePoseDescriptionDom(description);

        if (commitToJson) {
            this.commitPostureDescriptionToPoseJson(description);
        }
    }, 80);
}
```

建議觸發點：

- `mousemove` / drag 中：`commitToJson = false`
- `mouseup` / toolbar 完成動作：`commitToJson = true`
- `save()` / panel close 前：保證最後一次 commit

## 分階段實作順序

### Phase 0：建立 baseline 與驗證清單

操作：

- 保留現狀程式碼
- 列出所有與背景、相機、IK、gizmo 相關入口
- 建立人工測試清單

輸出：

- baseline issue list
- baseline GUI 截圖或行為記錄

### Phase 1：背景圖修正

操作：

- 先做 `backgroundImage` state 正規化
- 先改 `nodes.py` backend parser，再改前端寫入格式
- 實作 2D / 3D 共用背景狀態
- 優先用 `THREE.Scene.background = texture` 修復 3D 背景
- 若執行期 Three.js 不支援或透明需求不符，再退回 orthographic quad
- 先決定 3D 背景是否必須支援 opacity
- 修正 `subfolder` round-trip
- 先審計 `nodes.py` 中 `folder_paths.get_annotated_filepath(backgroundImage)` 的相容性，再改 backend
- 修正 `inputPose` 目前傳絕對路徑的既有 bug，避免它污染新的背景 round-trip

完成標準：

- 3D 模式能看到背景圖
- 重開 panel 仍能看到背景圖
- pause/resume 後背景圖仍正確
- 執行 workflow 後背景圖仍正確

Phase 1 開工前 checklist：

- 確認 `web/vendor/three.min.txt` 與 shared runtime 是否都支援 `THREE.Scene.background = texture`
- 決定 3D 背景是否需要 opacity
- 確認 backend parser 先於前端背景格式升級上線
- 確認 `inputPose` 改成 filename / descriptor，而非絕對路徑

### Phase 2：相機與視角系統

操作：

- 將右鍵拖曳改為 orbit camera
- 先校準預設骨架座標系與 `Front / Back` 命名
- 加入 front / side / top presets
- 視需要加入 orthographic
- 加入 `Frame All` / `Focus Selection`
- 驗證 `camera_state` 與 `model_rotation` 的 save/load 相容性

完成標準：

- 正視圖 / 側視圖 / 俯視圖都可一鍵到位
- 垂直旋轉相機穩定，無極點翻轉
- `Reset View` 行為一致

### Phase 3：關節約束、鏡像與 gizmo 優化

操作：

- 補 mirror pose
- 補 elbow / knee constrained drag
- 調整 gizmo 自適應縮放
- 視需要補 point size / background opacity UI
- 為 discrete 3D 動作補 undo snapshot

完成標準：

- 鏡像後左右關節對應正確
- 移動肘 / 膝不拉長骨頭
- gizmo 可調小，且縮放時不失控

### Phase 4：邏輯清理與 legacy 移除

操作：

- 修 `Add` / `rotate3DSelection` / orbit center drift / clamp 問題
- 改善每幀姿態描述分析
- 將 `posture_description` 的 JSON 回寫時機改為 interaction end / save / close
- 移除無用途殘留 state
- 在驗證通過後逐步移除 `js/`

完成標準：

- 編輯手感一致
- 沒有明顯 state drift
- 與 `ComfyUI-OpenPose-Studio` 共存正常

### Phase 5：文件更新

操作：

- 更新 README
- 更新 technical report
- 補 migration note

## 驗證計畫

### 靜態檢查

- Python syntax check
- 前端檔案搜尋確認沒有遺留 `js/` runtime path
- 檢查新增 helper 是否都走單一 state flow
- 確認 `web/vendor/three.min.txt` 與 shared Three.js runtime 是否支援 `THREE.Scene.background = texture`
- 確認 `nodes.py` 的 `folder_paths.get_annotated_filepath(backgroundImage)` 在新背景格式下不會收到未解析 JSON string
- 確認 `inputPose` 不再把本機絕對路徑傳回前端背景流程

### GUI 手動驗證

1. 開 panel 後切換 2D / 3D，背景圖應正確保留。
2. 上傳背景圖後，3D 中立即可見。
3. 關閉 panel 再打開，背景圖仍在。
4. pause for edit 後恢復，背景圖仍在。
5. 執行 workflow 後，node 預覽與 editor 背景都正確。
6. `Front / Left / Right / Top / Reset` 都可用。
7. 鏡像 pose 後，左右手腳對應正確。
8. 拖動 elbow / knee 不會改變骨長。
9. gizmo 調小後仍可操作，縮放遠近時大小合理。
10. 3D 的 mirror / elbow-knee constraint / preset view 在結束動作後可被 undo。
11. 與 `ComfyUI-OpenPose-Studio` 同時存在時，兩邊 panel 都能開啟且可互動。

### 回歸重點

- Save / Load JSON
- Apply Pose
- Auto Complete
- Select All
- Delete Points
- Reset
- 3D screenshot / 2D screenshot route

## 風險與對策

### 1. 背景格式升級破壞舊 workflow

對策：

- parser 同時接受純字串與 JSON string
- backend 與 frontend 都做 backward compatible

### 2. 相機重構造成既有使用者操作習慣改變

對策：

- 保留模型旋轉作為次要工具
- `Reset View` 與預設視角要清楚
- 必要時提供簡單切換模式
- 在正式綁定 `Front / Back` 前先做 preset calibration，避免命名與實際朝向相反

### 3. 相機序列化與舊 JSON 相容失敗

對策：

- 不更動 `_3d_pose_data.camera_state` 與 `_3d_pose_data.model_rotation` 的 key 名稱
- 將 orbit 與 model rotate 的責任切開後，再逐一驗證 save/load
- 針對舊 JSON 建立回歸測試，確認原本存過的 pose 能原樣開啟

### 4. 肘 / 膝約束求解不穩定

對策：

- 以 two-segment constrained solve 為主
- plane degeneracy 時加入 camera / world-up fallback
- target 不可達時做 clamp
- 先把 solver 的數學定義寫死在實作文件，再開始寫程式，避免 AI 臨場發揮導致不穩定
- 將 solver 輸出限定為 discrete interaction commit，避免每幀大量誤差累積

### 5. `posture_description` 在操作中持續回寫 JSON 造成狀態污染

對策：

- DOM 預覽與 JSON 寫回分離
- drag 中只更新 UI，不回寫 `poses_datas`
- 只在 `mouseup`、save、close 時 commit

### 6. legacy `js/` 刪除後重現歷史衝突

對策：

- 只在完整 GUI 驗證後逐步刪除
- 每次刪除後都做 mixed-editor 回歸

## 驗收標準

- 3D 模式背景圖完整可用，且支援重開、重跑、pause/resume。
- 相機具有正視圖、側視圖、俯視圖與穩定垂直旋轉。
- 支援 pose 鏡像。
- 拖動肘 / 膝時可維持骨長。
- gizmo 大小可控且不再過大擋視野。
- 修掉已知邏輯錯誤與明顯數學不一致。
- 確認 `js/` 是否可移除，並以低風險方式完成清理。

## 建議開工順序

若直接開始實作，建議依下列優先順序進行：

1. 背景狀態正規化與 3D 背景同步
2. 相機 orbit 與視角預設
3. 肘 / 膝約束拖曳
4. 鏡像功能
5. gizmo 自適應縮放
6. 邏輯清理與 legacy `js/` 移除

以上排序的理由是：

- 先解決使用者已明確指出的壞功能
- 再補足 3D pose 軟體應有的核心操作能力
- 最後做清理與文件收尾，降低回歸風險
