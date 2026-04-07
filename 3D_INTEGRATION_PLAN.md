# OpenPose Studio 3D Integration Plan

## Status

Draft architecture and implementation plan for integrating a native 3D editor into OpenPose Studio.

## Document Purpose

This document describes how to turn the current standalone 3D OpenPose editor experience into a first-class OpenPose Studio feature, ideally exposed as a `3D` tab inside the existing Studio window.

The goal is not only to "make 3D editing appear inside Studio", but to do so in a way that:

- preserves existing OpenPose Studio behavior
- keeps 2D export and backend rendering stable
- stores enough 3D state to restore the editor exactly
- supports future extension without another rewrite

## Executive Summary

The recommended solution is:

1. Keep OpenPose Studio as the single editing shell.
2. Introduce a shared document model that owns both 2D and 3D state.
3. Add a dedicated `OpenPoseCanvas3D` renderer instead of embedding the old standalone panel wholesale.
4. Store 3D metadata in a versioned `_3d_pose_data` JSON block alongside the existing OpenPose `people` payload.
5. Keep `people` as the canonical 2D export for the backend and preview.
6. Treat 2D and 3D as two views over one document, not two separate editors.

This approach is more work up front than "iframe-style embedding" or "mount the old 3D panel inside Studio", but it is the only approach that scales cleanly for:

- undo/redo across both modes
- apply/cancel correctness
- preview stability
- future face/hand/depth extensions
- module interoperability inside Studio

## Goals

- Add a native `3D` tab inside OpenPose Studio.
- Allow a user to switch between `2D` and `3D` within the same modal window.
- Persist enough 3D state to reopen the editor and continue editing without information loss.
- Keep existing Studio features working:
  - presets
  - gallery
  - merger
  - background image workflow
  - preview generation
  - apply/cancel
  - save/load
  - undo/redo
- Maintain backward compatibility with current 2D-only JSON payloads.
- Support migration from the existing standalone 3D editor JSON structure.

## Non-Goals for V1

- Full-body production-grade character rigging
- Face and hand 3D rig editing
- Replacing the existing 2D renderer
- Changing Python backend render behavior
- Multiple simultaneous 3D viewports

## Current Codebase Observations

### OpenPose Studio strengths

OpenPose Studio already has a good foundation for this integration:

- A modular shell with tab and overlay slots
- A central `OpenPosePanel`
- A renderer abstraction via `OpenPoseCanvas2D`
- A clean save/load path using JSON
- A node property persistence path through `savedPose`
- An internal history mechanism

This means the Studio architecture is already close to supporting a second renderer.

### Current Studio limitation

The current implementation assumes that:

- renderer state is 2D-only
- history snapshots are renderer snapshots
- save/load is based on 2D keypoints and optional face/hands extras
- preview comes from 2D JSON only

That is the main architectural gap.

### Standalone 3D editor strengths

The standalone 3D editor already demonstrates that the following can be saved and restored:

- 3D joint positions
- 3D connections
- camera orbit state
- model rotation
- orbit center

This is enough to build a stable 3D restoration flow.

### Main integration challenge

The integration challenge is not rendering 3D itself. The real challenge is preserving the integrity of:

- shared data
- history
- save/load
- cancel/apply
- preview
- compatibility with existing Studio modules

## Architectural Decision

### Recommended Architecture

Use a shared document model plus two renderers:

- `PoseDocument`
- `OpenPoseCanvas2D`
- `OpenPoseCanvas3D`

The Studio shell owns the document and tells each renderer when to read from it or write to it.

### Why this is the best choice

This architecture:

- keeps Studio as the single source of UI truth
- avoids nested editor logic
- allows 2D and 3D to share persistence and history
- supports future data expansion cleanly
- prevents mode-specific hacks from leaking into the rest of Studio

## Solution Options Compared

### Option A: Embed the old standalone 3D panel inside Studio

Description:
Mount the current 3D editor UI as a child panel or hidden container inside Studio.

Pros:

- fastest proof of concept
- reuses the most existing 3D code

Cons:

- duplicated editor state
- difficult apply/cancel semantics
- difficult undo/redo integration
- duplicated save/load logic
- duplicated event handling and overlays
- higher risk of pointer and DOM conflicts
- poor long-term maintainability

Verdict:
Not recommended except for a very short-lived prototype.

### Option B: Add a 3D tab, but keep 2D and 3D state separate

Description:
Add a native 3D tab, but let the 3D tab maintain its own private state and only sync to 2D on demand.

Pros:

- simpler initial renderer port
- less refactoring than a shared document model

Cons:

- fragile sync rules
- easy to lose edits
- hard to reason about which mode is authoritative
- history becomes inconsistent
- apply/cancel becomes mode-sensitive

Verdict:
Better than Option A, but still fragile.

### Option C: Shared document model with two renderers

Description:
Introduce a central document model that stores 2D, 3D, and editor metadata, and let 2D/3D renderers operate on it.

Pros:

- clean ownership model
- robust persistence
- stable undo/redo
- easier migration and testing
- best long-term extensibility

Cons:

- requires the most upfront architectural work

Verdict:
Recommended.

## Target Architecture

### High-level responsibilities

- `OpenPosePanel`
  - owns modal lifecycle
  - owns active tab
  - owns apply/cancel behavior
  - owns document snapshots

- `PoseDocument`
  - stores canonical editor state
  - stores both 2D and 3D metadata
  - exposes serialization and migration helpers

- `OpenPoseCanvas2D`
  - edits 2D body/face/hand keypoints
  - renders the current 2D view

- `OpenPoseCanvas3D`
  - edits 3D body joints
  - manages orbit camera and gizmos
  - projects the document back to canonical 2D body data

- `pose-sync.js`
  - bootstraps 3D from 2D
  - projects 3D to canonical 2D
  - maintains rules about authoritative fields

- `pose-history.js`
  - stores full document snapshots

## Proposed Directory Layout

Recommended new or changed files:

```text
ComfyUI-OpenPose-Studio/
  js/
    main.js
    canvas2d.js
    canvas3d.js                    # new
    utils.js
    formats/
      index.js
      coco17.js
      coco18.js
    modules/
      index.js
      editor.js
      editor-3d-tab.js             # optional, new
      gallery.js
      merger.js
      render.js
      guide.js
      about.js
    state/
      pose-document.js             # new
      pose-document-schema.js      # new
      pose-document-migrate.js     # new
      pose-history.js              # new
      pose-sync.js                 # new
    vendor/
      three.module.js              # only if Studio chooses to vendor Three.js
      OrbitControls.js             # or internal equivalent wrapper
  docs/
    3D_INTEGRATION_PLAN.md
```

### Minimal-file alternative

If the project wants fewer files for V1:

```text
js/
  canvas3d.js
  state/
    pose-document.js
    pose-sync.js
```

The migration helpers and schema constants can live in `pose-document.js` initially and be split later.

## Data Model Design

### Design principle

Keep `people` as the canonical backend-facing export.

Store 3D restoration data under `_3d_pose_data`.

This ensures:

- Python nodes continue to work
- preview generation still works
- unknown metadata is ignored safely by the backend

### Root JSON structure

Recommended V2 payload:

```json
{
  "canvas_width": 768,
  "canvas_height": 512,
  "people": [
    {
      "pose_keypoints_2d": [0, 0, 0]
    }
  ],
  "_3d_pose_data": {
    "version": 2,
    "coordinate_space": "studio-front",
    "projection": {
      "type": "orthographic_front"
    },
    "poses": [
      {
        "poseId": 0,
        "formatId": "coco18",
        "joints": [
          [0, 120, 0],
          [0, 80, 0],
          null
        ]
      }
    ],
    "camera": {
      "theta": 0,
      "phi": 1.57079632679,
      "radius": 500
    },
    "orbit_center": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "model_rotation": {
      "x": 0,
      "y": 0,
      "z": 0,
      "w": 1
    },
    "ui": {
      "rigMode": "fk",
      "gizmoVisible": true
    }
  }
}
```

### Why this schema is preferred over the current standalone schema

The current standalone schema stores each point as an object:

```json
{ "id": 3, "poseId": 0, "x": 10, "y": 20, "z": 30, "color": [255,0,0] }
```

That works, but it is verbose and duplicates structure that is already implied by:

- the pose index
- the keypoint index
- the current format

The recommended schema stores:

- one array per pose
- one fixed slot per joint
- `null` for missing joints

This is:

- smaller
- easier to validate
- easier to migrate
- easier to project

### Canonical rules

- `people` is the exported 2D pose used by backend renderers.
- `_3d_pose_data` is restoration metadata.
- The active orbit camera is not the source of truth for 2D export.
- The canonical 2D export must come from a fixed front projection.

This rule prevents accidental corruption of the user-facing pose when the user is merely rotating the camera to inspect the model.

## PoseDocument Design

### Document responsibilities

`PoseDocument` should encapsulate:

- canvas size
- 2D body poses
- optional face and hand data
- optional 3D pose data
- editor metadata
- schema version and migration

### Example Type Shape

```js
export class PoseDocument {
  constructor(initial = {}) {
    this.canvasWidth = initial.canvasWidth ?? 512;
    this.canvasHeight = initial.canvasHeight ?? 512;
    this.poses = initial.poses ?? [];
    this.pose3D = initial.pose3D ?? null;
    this.meta = initial.meta ?? {};
  }

  clone() {
    return PoseDocument.fromJSON(this.toJSON());
  }

  toJSON() {
    return writePoseDocument(this);
  }

  static fromJSON(payload) {
    return readPoseDocument(payload);
  }
}
```

### Proposed normalized internal shape

```js
{
  canvasWidth: 768,
  canvasHeight: 512,
  poses: [
    {
      poseId: 0,
      formatId: "coco18",
      keypoints2D: [{ x, y } | null, ...],
      faceKeypoints: [{ x, y } | null, ...] | null,
      handLeftKeypoints: [{ x, y } | null, ...] | null,
      handRightKeypoints: [{ x, y } | null, ...] | null,
      joints3D: [{ x, y, z } | null, ...] | null
    }
  ],
  scene3D: {
    version: 2,
    camera: { theta, phi, radius },
    orbitCenter: { x, y, z },
    modelRotation: { x, y, z, w },
    ui: { rigMode, gizmoVisible }
  }
}
```

## Serialization Strategy

### Read path

`readPoseDocument(payload)` should:

1. parse 2D payload from current Studio-compatible JSON
2. detect `_3d_pose_data`
3. if legacy standalone 3D format is present, migrate it
4. attach 3D state to normalized poses

### Write path

`writePoseDocument(document)` should:

1. write the existing OpenPose `people` structure
2. preserve face/hands if present
3. write `_3d_pose_data.version = 2`
4. never depend on the current orbit camera for the canonical 2D output

### Suggested helper API

```js
export function readPoseDocument(raw) {}
export function writePoseDocument(doc) {}
export function migrateLegacy3DState(raw3D, normalized2D) {}
export function extractCanonical2DPeople(doc) {}
```

## Migration Strategy

### Supported input types

The system should support:

1. existing Studio 2D JSON
2. standalone 3D editor JSON with `_3d_pose_data.points`
3. future Studio V2 3D JSON

### Legacy migration rules

When reading legacy 3D data:

- group points by `poseId`
- map each point into `joints[jointIndex]`
- derive pose order from sorted `poseId`
- preserve camera/orbit/model rotation
- ignore `connections` if the Studio renderer can infer them from format

### Example migration skeleton

```js
export function migrateLegacy3DState(raw3D, normalizedPoses) {
  const poseMap = new Map();

  for (const point of raw3D.points || []) {
    const poseId = Number(point.poseId) || 0;
    if (!poseMap.has(poseId)) {
      poseMap.set(poseId, {
        poseId,
        formatId: "coco18",
        joints: new Array(18).fill(null)
      });
    }
    poseMap.get(poseId).joints[point.id] = [
      Number(point.x) || 0,
      Number(point.y) || 0,
      Number(point.z) || 0
    ];
  }

  return {
    version: 2,
    coordinate_space: "studio-front",
    poses: Array.from(poseMap.values()).sort((a, b) => a.poseId - b.poseId),
    camera: raw3D.camera_state || null,
    orbit_center: raw3D.orbit_center || null,
    model_rotation: raw3D.model_rotation || null
  };
}
```

## 2D / 3D Sync Rules

### Rule 1: 2D-only documents can be upgraded to 3D

If a document has no 3D data:

- create `joints3D` from `keypoints2D`
- center around Studio coordinate space
- initialize `z = 0`

### Rule 2: 3D edits must update canonical 2D body keypoints

After a 3D edit:

- project 3D joints to a fixed front view
- update `keypoints2D`
- do not project face or hands from 3D in V1

### Rule 3: camera movement alone should not count as geometry changes

If the user only:

- rotates the camera
- pans the camera
- zooms

then:

- do not mark pose geometry dirty
- do not rewrite canonical 2D pose
- camera state should still be restorable

### Rule 4: 2D edits invalidate only body-joint 3D alignment

If the user edits body keypoints in 2D:

- update the corresponding 3D joints if a simple mapping exists
- or mark 3D state as needing reprojection if exact preservation is not possible

Recommended V1 behavior:

- when 2D body keypoints are edited, update `x/y` of matching 3D joints and preserve existing `z`

## OpenPoseCanvas3D Design

### Responsibilities

- render joints and skeleton lines
- manage camera orbit
- support selection
- support transform gizmo
- support reset view
- support FK and IK modes
- emit Studio-compatible change events

### Required public API

```js
export class OpenPoseCanvas3D {
  constructor(hostElement, options = {}) {}
  loadDocument(doc) {}
  applyDocumentChanges(doc) {}
  getSceneState() {}
  setVisible(visible) {}
  resize(width, height) {}
  dispose() {}

  onChange(callback) {}
  onSelectionChange(callback) {}
}
```

### Change event contract

Suggested change reasons:

- `geometry`
- `select`
- `camera`
- `mode`
- `clear`

Studio should treat these differently:

- `geometry`, `clear` -> record history and save document
- `select` -> UI refresh only
- `camera` -> save document but do not mark pose geometry dirty
- `mode` -> UI refresh only

## Studio Shell Integration

### UI recommendation

Add a new native tab:

- `Editor`
- `3D`
- existing module tabs remain unchanged

The `3D` tab should reuse the central canvas area, not open a new modal.

### Recommended behavior

- left and right sidebars remain available
- center stage switches between 2D canvas and 3D canvas host
- background controls remain 2D-only in V1
- save/load/apply/cancel remain global to the document

### Suggested shell methods

```js
setActiveView(view) {
  this.activeView = view; // "2d" | "3d"
  this.updateViewVisibility();
}

updateViewVisibility() {
  this.canvasElem.style.display = this.activeView === "2d" ? "block" : "none";
  this.canvas3DHost.style.display = this.activeView === "3d" ? "block" : "none";
}
```

## History Design

### Current limitation

Studio currently stores history as serialized 2D renderer state.

That is insufficient once 3D exists.

### Recommended solution

History should store document snapshots:

```js
{
  document: writePoseDocument(doc),
  selection2D: renderer2D.getSelectedPoseIndex(),
  selection3D: renderer3D.getSelectedJointSelection(),
  keypointEdits: renderer2D.hasKeypointEdits()
}
```

### Important distinction

Camera-only changes should be restorable, but they should not necessarily be treated as geometry edits.

Recommended V1:

- include camera state in history snapshots
- only push a new history snapshot when:
  - geometry changes
  - clear/add/delete
  - explicit mode-level operations that affect document state

## Save / Load / Apply / Cancel Behavior

### Save

Save the full document:

- `people`
- face/hands if present
- `_3d_pose_data`

### Load

Load into the full document model:

- parse 2D
- migrate legacy 3D if present
- hydrate 2D renderer
- hydrate 3D renderer

### Apply

Commit the current document JSON to:

- `node.properties.savedPose`
- `jsonWidget.value`

### Cancel

Revert to the original document snapshot captured when the modal opened.

This is one major reason a shared document model is preferred.

## Preview Strategy

Preview should remain 2D-based.

Do not generate preview from the active orbit camera.

Instead:

- always derive preview from canonical `people`
- if the user edits in 3D, update canonical 2D body keypoints via fixed front projection
- preview remains deterministic

## Background Image Strategy

### V1 recommendation

Treat background image as a 2D alignment aid only.

In 3D view:

- either hide the background image
- or optionally show it as a viewport-aligned overlay, but do not let it define 3D depth

This avoids mixing camera-space image logic with model-space pose logic too early.

## FK / IK Roadmap

### V1

- selection
- free move
- axis-constrained move
- reset view
- simple model rotation

### V2

- FK chain rotation from selected joint
- basic IK for:
  - left arm
  - right arm
  - left leg
  - right leg

### V3

- pole vector hints
- mirrored editing
- local/world axis toggle
- constraints

## File-by-File Implementation Plan

### Phase 1: Data foundation

Files:

- `js/state/pose-document.js`
- `js/state/pose-document-migrate.js`
- `js/state/pose-sync.js`

Deliverables:

- read/write document helpers
- legacy 3D migration
- 2D <-> 3D sync helpers

### Phase 2: 3D renderer

Files:

- `js/canvas3d.js`

Deliverables:

- Three.js scene setup
- orbit camera
- selection
- transform gizmo
- reset view

### Phase 3: Studio shell integration

Files:

- `js/main.js`
- `js/modules/editor.js`
- optionally `js/modules/editor-3d-tab.js`

Deliverables:

- new `3D` tab
- 2D/3D stage switching
- shared document ownership

### Phase 4: Persistence and history

Files:

- `js/modules/editor.js`
- `js/state/pose-history.js`

Deliverables:

- document snapshots
- cross-mode undo/redo
- apply/cancel integrity

### Phase 5: Advanced editing

Files:

- `js/canvas3d.js`
- `js/state/pose-sync.js`

Deliverables:

- FK
- IK
- improved selection and transform controls

## Key Code Skeletons

### Reading a document

```js
export function readPoseDocument(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const normalized2D = normalizePoseJson(parsed);
  if (!normalized2D) {
    throw new Error("Invalid pose document");
  }

  const doc = {
    canvasWidth: normalized2D.width,
    canvasHeight: normalized2D.height,
    poses: normalized2D.poses.map((pose, poseId) => ({
      poseId,
      formatId: "coco18",
      keypoints2D: pose.keypoints,
      faceKeypoints: pose.faceKeypoints || null,
      handLeftKeypoints: pose.handLeftKeypoints || null,
      handRightKeypoints: pose.handRightKeypoints || null,
      joints3D: null
    })),
    scene3D: null
  };

  const raw3D = parsed?._3d_pose_data || null;
  if (raw3D) {
    const migrated = raw3D.version === 2
      ? raw3D
      : migrateLegacy3DState(raw3D, doc.poses);
    attach3DStateToDocument(doc, migrated);
  }

  return doc;
}
```

### Writing a document

```js
export function writePoseDocument(doc) {
  const people = doc.poses.map((pose) => ({
    pose_keypoints_2d: flattenBodyKeypoints(pose.keypoints2D),
    ...(pose.faceKeypoints ? { face_keypoints_2d: flattenExtraKeypoints(pose.faceKeypoints) } : {}),
    ...(pose.handLeftKeypoints ? { hand_left_keypoints_2d: flattenExtraKeypoints(pose.handLeftKeypoints) } : {}),
    ...(pose.handRightKeypoints ? { hand_right_keypoints_2d: flattenExtraKeypoints(pose.handRightKeypoints) } : {})
  }));

  const payload = {
    canvas_width: doc.canvasWidth,
    canvas_height: doc.canvasHeight,
    people
  };

  if (doc.scene3D) {
    payload._3d_pose_data = build3DMetadata(doc);
  }

  return payload;
}
```

### Bootstrapping 3D from 2D

```js
export function bootstrap3DFrom2D(doc) {
  const centerX = doc.canvasWidth / 2;
  const centerY = doc.canvasHeight / 2;

  for (const pose of doc.poses) {
    pose.joints3D = pose.keypoints2D.map((kp) => {
      if (!kp) return null;
      return {
        x: kp.x - centerX,
        y: -(kp.y - centerY),
        z: 0
      };
    });
  }

  doc.scene3D = doc.scene3D || createDefault3DSceneState();
}
```

### Projecting 3D back to canonical 2D

```js
export function project3DToCanonical2D(doc) {
  const centerX = doc.canvasWidth / 2;
  const centerY = doc.canvasHeight / 2;

  for (const pose of doc.poses) {
    if (!Array.isArray(pose.joints3D)) continue;
    pose.keypoints2D = pose.joints3D.map((joint) => {
      if (!joint) return null;
      return {
        x: centerX + joint.x,
        y: centerY - joint.y
      };
    });
  }
}
```

## Validation Rules

### Document validation

Validate on read and before write:

- canvas width/height > 0
- pose count >= 0
- each joint array length matches the expected format
- quaternion fields are finite
- camera fields are finite

### Defensive fallback behavior

If `_3d_pose_data` is malformed:

- keep 2D data
- discard 3D state
- show a warning toast
- do not fail the entire load unless the 2D payload is also invalid

## Performance Notes

### Expected constraints

The scene size is small:

- usually a few poses
- 18 body joints per pose
- limited number of connections

This means V1 performance is likely dominated by UI/event logic, not geometry size.

### Recommendations

- keep one Three.js scene per Studio panel
- reuse geometry/materials where practical
- avoid rebuilding the entire scene during camera-only updates
- debounce expensive sync paths if needed

## Risk Register

### Risk: 2D and 3D drift apart

Mitigation:

- centralize sync logic in `pose-sync.js`
- never let each renderer invent its own serialization

### Risk: undo/redo becomes inconsistent

Mitigation:

- move history to document snapshots early
- do not try to patch this later

### Risk: old JSON files stop loading

Mitigation:

- preserve current 2D load path
- treat `_3d_pose_data` as optional metadata

### Risk: preview changes unexpectedly when rotating camera

Mitigation:

- preview must use canonical front projection only

### Risk: tab integration breaks existing modules

Mitigation:

- keep module manager unchanged
- add only one new tab and one central canvas host

## Testing Strategy

### Unit-level targets

- load 2D-only Studio JSON
- load legacy standalone 3D JSON
- write V2 JSON and reload it
- migrate malformed `_3d_pose_data` safely

### Manual regression checklist

- open Studio and switch between 2D and 3D
- load a 2D-only file and enter 3D
- load a 3D file and confirm full restoration
- rotate camera, close, reopen, confirm camera restore
- edit in 3D, switch to 2D, confirm body projection is stable
- save JSON, reload, compare scene restoration
- test apply/cancel
- test undo/redo in both modes
- test presets, merger, gallery, background controls

## Scalability and Future Extensibility

This architecture keeps future options open:

- add depth presets
- add rig constraints
- add mirrored editing
- add more pose formats
- add 3D face/hands
- add import/export converters
- add multiple camera presets
- add scene annotations or helper planes

The key is that all of these features can be built on top of `PoseDocument` instead of inventing new editor-global state each time.

## Recommended Delivery Phases

### Milestone 1: Schema and document model

Scope:

- `PoseDocument`
- `_3d_pose_data` V2
- legacy migration

Done when:

- Studio can load/write mixed 2D/3D JSON safely

### Milestone 2: 3D tab scaffold

Scope:

- add 3D tab
- mount 3D canvas host
- initialize empty 3D scene

Done when:

- user can switch views in one Studio modal

### Milestone 3: Basic 3D editing

Scope:

- selection
- orbit
- pan/zoom
- reset view
- move joints

Done when:

- user can edit in 3D and see stable 2D projection

### Milestone 4: Persistence and history

Scope:

- save/load
- apply/cancel
- undo/redo

Done when:

- user can reopen and fully restore a 3D session

### Milestone 5: FK / IK

Scope:

- FK chain rotation
- two-bone IK for arms/legs

Done when:

- user can perform practical limb posing without losing document integrity

## Recommended First Shipping Scope

For the first production-safe merge, ship:

- shared document model
- `_3d_pose_data` V2
- 3D tab
- reset view
- camera restore
- basic 3D point movement
- 2D canonical projection
- cross-mode save/load/apply/cancel/undo/redo

Delay FK and IK if needed until the document model is proven stable.

## Final Recommendation

Build the 3D editor as a native OpenPose Studio subsystem, not as a nested standalone editor.

The most important investment is not the Three.js viewport itself. The most important investment is establishing a shared, versioned, migration-safe document model that lets Studio remain the authoritative editor shell for both 2D and 3D workflows.

If this is done first, the rest of the 3D integration becomes incremental rather than fragile.
