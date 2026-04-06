# ComfyUI-3D-OpenPose-Editor2026

[繁體中文 README](./README.zh-TW.md)

A customized 2D/3D OpenPose editor node for ComfyUI, built for practical pose editing inside real workflows.

This version keeps the original 2D editing flow, adds a full 3D editing mode, and includes a number of quality-of-life improvements such as reset view, FK/IK workflow, JSON naming on export, background image support, and frontend conflict fixes for mixed-editor setups.

The current UI in this custom build is English, including toolbar buttons, panel labels, prompts, and runtime status messages.

## Screenshots

### Node

![Node Screenshot](./node.png)

### 3D Editor

![3D Editor Screenshot](./3dEditor.png)

## Features

- 2D and 3D pose editing in a single node
- Reset View button to restore the initial camera angle and zoom
- FK-style joint editing for controlled axis-based adjustments
- IK support for arms and legs while preserving limb lengths
- Built-in gizmo for X/Y/Z movement and rotation
- Save pose JSON with a custom filename dialog
- Load and restore saved 3D pose data, camera state, and model rotation
- Background image loading for pose matching
- Pose auto-completion for missing limbs and mirrored joints
- Posture text output for downstream prompt or workflow usage
- Better coexistence with other OpenPose editors in the same ComfyUI frontend

## Installation

Clone or copy this repository into your ComfyUI `custom_nodes` folder:

```bash
cd ComfyUI/custom_nodes
git clone <your-repo-url> ComfyUI-3D-OpenPose-Editor2026
```

Then restart ComfyUI.

If you are updating from an older local copy, a full browser hard refresh is recommended after restart.

## Quick Start

1. Add the `Nui.OpenPoseEditor` node to your workflow.
2. Open the editor panel from the node.
3. Edit the pose in 2D or switch to 3D mode.
4. Use the built-in buttons such as `Open Pose Editor`, `Match Size`, and `Apply Pose` as needed.
5. Save or load pose JSON files as needed.
6. Use the node output in your downstream pose-driven workflow.

## Toolbar Overview

| Button | Description |
| --- | --- |
| `Add` | Add a new pose |
| `Delete Points` | Delete selected joints |
| `Clear` | Clear the current pose |
| `Reset` | Reset to the original loaded pose |
| `Save` | Export pose JSON with a custom filename(compatible with andreszs/ComfyUI-OpenPose-Studio's json format) |
| `Load` | Import a saved pose JSON(compatible with andreszs/ComfyUI-OpenPose-Studio's json format) |
| `Select All` | Select all available joints |
| `Auto Complete` | Auto-complete missing joints and limb connections |
| `Background` | Load a background image |
| `Clear Background` | Remove the background image |
| `3D Mode: On / Off` | Toggle 2D / 3D editing mode |
| `Gizmo: On / Off` | Toggle the 3D gizmo |
| `Reset View` | Reset the 3D camera to the initial view |
| `Mode: FK / IK` | Switch between FK and IK editing |

## 3D Controls

| Action | Description |
| --- | --- |
| Left click | Select a joint or gizmo handle |
| Left drag | Move the selected joint or drag in free space |
| Right drag | Rotate the camera |
| Middle drag | Pan the camera |
| Mouse wheel | Zoom in or out |

## Shortcuts

| Shortcut | Description |
| --- | --- |
| `Ctrl + A` | Select all joints |
| `Delete` / `Backspace` | Delete selected joints in 3D mode |
| `Esc` | Clear selection |
| `R` | Reset 3D view |
| `F` | Switch to FK mode |
| `I` | Switch to IK mode |
| `Ctrl + Z` | Undo |
| `Ctrl + Y` | Redo |

## Node Widgets

The node-level widgets shown in the ComfyUI graph are also in English:

- `Open Pose Editor`
- `Match Size`
- `Apply Pose`

## FK and IK Workflow

### FK

Use FK mode when you want to rotate or move a joint while keeping downstream joints following the chain. This is useful for shaping arms, legs, and overall motion arcs from a stable parent joint.

### IK

Use IK mode when you want to drag an end effector such as a wrist or ankle while keeping limb lengths stable. The current implementation focuses on two-bone chains:

- Left arm
- Right arm
- Left leg
- Right leg

## Save Format

Exported JSON includes:

- 2D projected pose data
- 3D point data
- 3D connection data
- camera state
- model rotation
- orbit center

This makes it possible to reopen a pose and continue editing from the same 3D state.

## Notes

- This project is based on the DocKr OpenPose Editor and extends it with additional 3D editing features and workflow fixes.
- If you use another OpenPose editor plugin in the same ComfyUI session, make sure your browser cache is refreshed after updating.
- The current IK implementation is focused on common limb editing, not a full character rig system.

## Credits

- Original 2D editor base: DocKr OpenPose Editor
- Extended and customized for mixed 2D/3D workflow editing in ComfyUI

## License

Please update this section to match the license you intend to publish with your GitHub version.
