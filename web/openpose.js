import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ComfyWidgets } from "../../scripts/widgets.js";
import "./fabric.min.js";

const OPENPOSE_EDITOR_EXTENSION_NAME = "DocKr.OpenPoseEditor3D";
const OPENPOSE_EDITOR_NODE_NAME = "Nui.OpenPoseEditor";
const OPENPOSE_EDITOR_BOOTSTRAP_KEY = "__COMFYUI_3D_OPENPOSE_EDITOR2026_BOOTSTRAPPED__";
const OPENPOSE_EDITOR_THREE_LOADER_KEY = "__COMFYUI_3D_OPENPOSE_EDITOR2026_THREE_LOADER__";

function resolveThreeModule(mod) {
    if (mod?.default?.WebGLRenderer) {
        return mod.default;
    }
    if (mod?.THREE?.WebGLRenderer) {
        return mod.THREE;
    }
    if (mod?.WebGLRenderer) {
        return mod;
    }
    return null;
}

async function loadSharedThreeModule(url) {
    const mod = await import(/* @vite-ignore */ url);
    const THREE = resolveThreeModule(mod) || globalThis.THREE;
    if (!THREE?.WebGLRenderer) {
        throw new Error(`Three.js module did not expose WebGLRenderer: ${url}`);
    }
    globalThis.THREE = THREE;
    return THREE;
}

async function loadBundledThreeFallback() {
    const fallbackUrl = new URL("./vendor/three.min.txt", import.meta.url);
    const response = await fetch(fallbackUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch bundled Three.js fallback: ${response.status}`);
    }

    const source = await response.text();
    const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try {
        await import(/* @vite-ignore */ blobUrl);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }

    if (!globalThis.THREE?.WebGLRenderer) {
        throw new Error("Bundled Three.js fallback did not initialize window.THREE");
    }

    return globalThis.THREE;
}

async function ensureThreeJsLoaded() {
    if (globalThis.THREE?.WebGLRenderer) {
        return globalThis.THREE;
    }

    if (globalThis[OPENPOSE_EDITOR_THREE_LOADER_KEY]) {
        return await globalThis[OPENPOSE_EDITOR_THREE_LOADER_KEY];
    }

    globalThis[OPENPOSE_EDITOR_THREE_LOADER_KEY] = (async () => {
        const sharedModuleCandidates = [
            new URL("../vnccs-utils/three.module.js", import.meta.url).href,
            new URL("../vnccs-utils/web/three.module.js", import.meta.url).href,
            "/extensions/vnccs-utils/three.module.js",
            "/extensions/vnccs-utils/web/three.module.js",
        ];

        for (const candidate of sharedModuleCandidates) {
            try {
                return await loadSharedThreeModule(candidate);
            } catch (error) {
                console.debug(`[OpenPose3D] Shared Three.js candidate failed: ${candidate}`, error);
            }
        }

        return await loadBundledThreeFallback();
    })();

    try {
        return await globalThis[OPENPOSE_EDITOR_THREE_LOADER_KEY];
    } catch (error) {
        delete globalThis[OPENPOSE_EDITOR_THREE_LOADER_KEY];
        throw error;
    }
}

function dataURLToBlob(dataurl) {
    var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

const connect_keypoints = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [1, 5], [5, 6], [6, 7], [1, 8],
    [8, 9], [9, 10], [1, 11], [11, 12],
    [12, 13], [14, 0], [14, 16], [15, 0],
    [15, 17]
];

const connect_color = [
    [0, 0, 255], [255, 0, 0], [255, 170, 0], [255, 255, 0],
    [255, 85, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0],
    [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255],
    [0, 85, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255],
    [255, 0, 170], [255, 0, 85]
];

const DEFAULT_KEYPOINTS = [
    [241, 77], [241, 120], [191, 118], [177, 183],
    [163, 252], [298, 118], [317, 182], [332, 245],
    [225, 241], [213, 359], [215, 454], [270, 240],
    [282, 360], [286, 456], [232, 59], [253, 60],
    [225, 70], [260, 72]
]

const DEFAULT_THREE_CAMERA_STATE = { theta: 0, phi: Math.PI / 2, radius: 500 };
const DEFAULT_THREE_CAMERA_FOV = 75;
const DEFAULT_THREE_CAMERA_PROJECTION = "perspective";
const THREE_CAMERA_PHI_EPSILON = 0.05;
const THREE_CAMERA_ORBIT_SPEED = 0.01;
const THREE_FOCUS_PADDING = 1.35;
const THREE_POSE_ANALYSIS_DEBOUNCE_MS = 120;
const DEFAULT_BACKGROUND_TYPE = "input";
const DEFAULT_BACKGROUND_OPACITY = 0.6;
const DEFAULT_THREE_SCENE_BACKGROUND = 0x000000;
const THREE_CAMERA_VIEW_PRESETS = {
    front: { label: "Front", direction: [0, 0, 1] },
    back: { label: "Back", direction: [0, 0, -1] },
    left: { label: "Left", direction: [-1, 0, 0] },
    right: { label: "Right", direction: [1, 0, 0] },
    top: { label: "Top", direction: [0, 1, 0] },
    bottom: { label: "Bottom", direction: [0, -1, 0] },
};
const OPENPOSE_LEFT_RIGHT_PAIRS = [
    [2, 5], [3, 6], [4, 7],
    [8, 11], [9, 12], [10, 13],
    [14, 15], [16, 17],
];
const OPENPOSE_CENTERLINE_IDS = [0, 1];

const POSE_PARENT_MAP = {
    0: 1,
    2: 1,
    3: 2,
    4: 3,
    5: 1,
    6: 5,
    7: 6,
    8: 1,
    9: 8,
    10: 9,
    11: 1,
    12: 11,
    13: 12,
    14: 0,
    15: 0,
    16: 14,
    17: 15,
};

const TWO_BONE_IK_CHAINS = {
    4: { root: 2, mid: 3, end: 4, name: "Left Arm" },
    7: { root: 5, mid: 6, end: 7, name: "Right Arm" },
    10: { root: 8, mid: 9, end: 10, name: "Left Leg" },
    13: { root: 11, mid: 12, end: 13, name: "Right Leg" },
};

const JOINT_NAMES = {
    0: "Nose",
    1: "Neck",
    2: "Left Shoulder",
    3: "Left Elbow",
    4: "Left Wrist",
    5: "Right Shoulder",
    6: "Right Elbow",
    7: "Right Wrist",
    8: "Left Hip",
    9: "Left Knee",
    10: "Left Ankle",
    11: "Right Hip",
    12: "Right Knee",
    13: "Right Ankle",
    14: "Left Eye",
    15: "Right Eye",
    16: "Left Ear",
    17: "Right Ear",
};

function normalizeBackgroundState(state) {
    if (!state || typeof state !== "object") {
        return null;
    }

    const rawFilename = typeof state.filename === "string" ? state.filename.trim() : "";
    if (!rawFilename) {
        return null;
    }

    const { filename: annotatedFilename, type: annotatedType } = extractAnnotatedBackgroundFilename(rawFilename);
    let subfolder = typeof state.subfolder === "string" ? state.subfolder.trim() : "";
    let filename = annotatedFilename;

    if (!subfolder) {
        const split = splitLegacyBackgroundPath(annotatedFilename);
        filename = split.filename;
        subfolder = split.subfolder;
    }

    if (!filename) {
        return null;
    }

    const opacityValue = Number(state.opacity);

    return {
        filename,
        subfolder,
        type: typeof state.type === "string" && state.type.trim() ? state.type.trim() : annotatedType,
        opacity: Number.isFinite(opacityValue) ? Math.min(1, Math.max(0, opacityValue)) : DEFAULT_BACKGROUND_OPACITY,
    };
}

function extractAnnotatedBackgroundFilename(filename) {
    const normalized = typeof filename === "string" ? filename.trim() : "";
    if (!normalized) {
        return { filename: "", type: DEFAULT_BACKGROUND_TYPE };
    }

    const suffixes = [
        { suffix: "[output]", type: "output" },
        { suffix: "[input]", type: "input" },
        { suffix: "[temp]", type: "temp" },
    ];

    for (const { suffix, type } of suffixes) {
        if (normalized.endsWith(suffix)) {
            return {
                filename: normalized.slice(0, -suffix.length).trim(),
                type,
            };
        }
    }

    return { filename: normalized, type: DEFAULT_BACKGROUND_TYPE };
}

function splitLegacyBackgroundPath(filename) {
    const normalized = typeof filename === "string" ? filename.trim() : "";
    if (!normalized) {
        return { filename: "", subfolder: "" };
    }

    if (/^[a-zA-Z]:[\\/]/.test(normalized) || normalized.startsWith("/") || normalized.startsWith("\\\\")) {
        return { filename: normalized, subfolder: "" };
    }

    const slashNormalized = normalized.replace(/\\/g, "/");
    const separatorIndex = slashNormalized.lastIndexOf("/");
    if (separatorIndex <= 0) {
        return { filename: slashNormalized, subfolder: "" };
    }

    return {
        filename: slashNormalized.slice(separatorIndex + 1),
        subfolder: slashNormalized.slice(0, separatorIndex),
    };
}

function parseBackgroundState(rawValue) {
    if (!rawValue) {
        return null;
    }

    if (typeof rawValue === "object") {
        return normalizeBackgroundState(rawValue);
    }

    if (typeof rawValue !== "string") {
        return null;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
            return normalizeBackgroundState(parsed);
        }
    } catch (_) {
    }

    return normalizeBackgroundState({
        filename: trimmed,
        subfolder: "",
        type: DEFAULT_BACKGROUND_TYPE,
        opacity: DEFAULT_BACKGROUND_OPACITY,
    });
}

function serializeBackgroundState(rawValueOrState) {
    const normalized = normalizeBackgroundState(
        typeof rawValueOrState === "string" ? parseBackgroundState(rawValueOrState) : rawValueOrState
    );

    if (!normalized) {
        return "";
    }

    return JSON.stringify({
        filename: normalized.filename,
        subfolder: normalized.subfolder,
        type: normalized.type,
        opacity: normalized.opacity,
    });
}

function buildBackgroundViewUrl(rawValueOrState, { cacheBust = true } = {}) {
    const state = typeof rawValueOrState === "string"
        ? parseBackgroundState(rawValueOrState)
        : normalizeBackgroundState(rawValueOrState);

    if (!state) {
        return "";
    }

    const params = new URLSearchParams();
    params.set("filename", state.filename);
    params.set("type", state.type || DEFAULT_BACKGROUND_TYPE);
    if (state.subfolder) {
        params.set("subfolder", state.subfolder);
    }
    if (cacheBust) {
        params.set("t", Date.now().toString());
    }

    return `/view?${params.toString()}`;
}

function setNodeBackgroundProperty(node, rawValueOrState) {
    const serialized = typeof rawValueOrState === "string"
        ? rawValueOrState
        : serializeBackgroundState(rawValueOrState);

    node.setProperty("backgroundImage", serialized);
    if (node.bgImageWidget) {
        node.bgImageWidget.value = serialized;
    }

    return serialized;
}

async function applyFabricBackgroundToCanvas(canvas, rawValueOrState) {
    const state = typeof rawValueOrState === "string"
        ? parseBackgroundState(rawValueOrState)
        : normalizeBackgroundState(rawValueOrState);

    if (!canvas) {
        return null;
    }

    if (!state) {
        return await new Promise((resolve) => {
            canvas.setBackgroundImage(null, () => {
                canvas.renderAll();
                resolve(null);
            });
        });
    }

    const imageUrl = buildBackgroundViewUrl(state);
    return await new Promise((resolve) => {
        fabric.Image.fromURL(imageUrl, (img) => {
            if (!img || !img.width || !img.height) {
                canvas.setBackgroundImage(null, () => {
                    canvas.renderAll();
                    resolve(null);
                });
                return;
            }

            img.set({
                scaleX: canvas.width / img.width,
                scaleY: canvas.height / img.height,
                opacity: state.opacity,
                selectable: false,
                evented: false,
            });

            canvas.setBackgroundImage(img, () => {
                canvas.renderAll();
                resolve(img);
            });
        }, { crossOrigin: 'anonymous' });
    });
}

function clonePlainVector(vec, fallback = { x: 0, y: 0, z: 0 }) {
    if (!vec) {
        return { ...fallback };
    }
    return { x: vec.x, y: vec.y, z: vec.z };
}

function clonePlainQuaternion(quat, fallback = { x: 0, y: 0, z: 0, w: 1 }) {
    if (!quat) {
        return { ...fallback };
    }
    return { x: quat.x, y: quat.y, z: quat.z, w: quat.w };
}

function sanitizePoseFilename(name, fallback) {
    const normalized = (name || "").trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "_");
    const withNoTrailingDots = normalized.replace(/[. ]+$/g, "");
    if (!withNoTrailingDots) {
        return fallback;
    }
    return withNoTrailingDots.toLowerCase().endsWith(".json") ? withNoTrailingDots : `${withNoTrailingDots}.json`;
}

async function readFileToText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => resolve(reader.result);
        reader.onerror = async () => reject(reader.error);
        reader.readAsText(file);
    });
}

async function loadImageAsync(imageURL) {
    return new Promise((resolve) => {
        const e = new Image();
        e.setAttribute('crossorigin', 'anonymous');
        e.addEventListener("load", () => { resolve(e); });
        e.addEventListener("error", () => { resolve(null); });
        e.src = imageURL;
        return e;
    });
}

async function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
        canvas.toBlob(resolve);
    });
}


function updatePoseJsonDimensions(node, newWidth, newHeight) {
    console.log(`[OpenPose] Updated dimensions: width=${newWidth}, height=${newHeight}`);
    try {
        let poseData = node.properties?.poses_datas;
        let poseJson = null;

        if (poseData && poseData.trim() !== "") {
            if (typeof poseData === "string") {
                poseJson = JSON.parse(poseData);
            } else if (typeof poseData === "object") {
                poseJson = poseData;
            }
        }


        if (!poseJson) {
            poseJson = {
                "width": newWidth,
                "height": newHeight,
                "people": []
            };
        } else {

            poseJson.width = newWidth;
            poseJson.height = newHeight;
        }


        const newPoseJson = JSON.stringify(poseJson, null, 4);
        console.log(`[OpenPose] Updated JSON:`, newPoseJson.substring(0, 200));


        if (node.jsonWidget) {
            node.jsonWidget.value = newPoseJson;
        }


        node.properties.poses_datas = newPoseJson;


        node.setDirtyCanvas(true, true);
        if (app.graph) app.graph.setDirtyCanvas(true, true);
        if (app.canvas) app.canvas.draw(true);

    } catch (error) {
        console.error("[OpenPose] Failed to update JSON dimensions:", error);
    }
}

class OpenPosePanel {
    node = null;
    canvas = null;
    canvasElem = null;
    canvasWrapperEl = null;
    canvasHostElem = null;
    panel = null;

    undo_history = [];
    redo_history = [];

    visibleEyes = true;
    flipped = false;
    lockMode = false;


    lastPoseData = null;


    rotationX = 0;
    rotationY = 0;
    isRotating = false;
    lastMouseX = 0;
    lastMouseY = 0;
    originalPoints = null;


    is3DMode = false;
    threeScene = null;
    threeCamera = null;
    threeRenderer = null;
    threeControls = null;
    threeObjects = new Map();
    threeContainer = null;
    threePoseData = null;
    threeSelectedObjects = new Set();
    is3DDragging = false;
    threeDragPlane = null;
    threeLastMouse = { x: 0, y: 0 };
    threeCameraState = { theta: 0, phi: Math.PI / 2, radius: 500 };
    threeTransformMode = 'translate';
    threeTransformCenter = null;
    threeComputedModelCenter = null;
    threeComputedSelectionCenter = null;
    threeIsTransforming = false;
    threeSelectionBox = null;
    threeControlPoints = null;
    threeActiveControlPoint = null;
    threeOrbitCenter = null;
    threeDragBox = null;
    isTranslatingSelection = false;
    threeTransformGizmo = null;
    threeTransformGizmoDragging = false;
    threeTransformGizmoAxis = null;
    threeTransformGizmoIsRotating = false;
    threeHoveredObject = null;
    threeModelQuaternion = null;
    initial3DViewState = null;
    threeRigMode = "fk";
    threeCameraNavigationMode = "camera_orbit";
    threeCameraSpaceMode = "world";
    threeCameraPivotMode = "model_center";
    threeTransformSpaceMode = "local";
    threeCameraProjectionMode = DEFAULT_THREE_CAMERA_PROJECTION;
    threeAnimationFrameHandle = null;
    showGizmo = true;
    showGizmoButton = null;
    resetViewButton = null;
    frameSelectionButton = null;
    cameraSpaceModeButton = null;
    transformSpaceModeButton = null;
    navigationModeButton = null;
    pivotModeButton = null;
    projectionModeButton = null;
    rigModeButton = null;
    statusTextEl = null;
    saveFilenameDialog = null;
    poseDescriptionText = null;
    copyDescriptionBtn = null;
    poseDescriptionContainer = null;
    poseDescriptionDirty = false;
    poseDescriptionTimer = null;


    analyzePoseAndGenerateDescription() {
        if (!this.is3DMode || !this.threeCamera || !this.threePoseData) {
            if (this.poseDescriptionText) {
                this.poseDescriptionText.innerText = "Available in 3D mode";
            }
            return;
        }

        const THREE = window.THREE;


        let modelFacing = "";
        if (this.threeModelQuaternion && this.threeCamera) {

            const modelForward = new THREE.Vector3(0, 0, -1);
            modelForward.applyQuaternion(this.threeModelQuaternion);


            const cameraPos = this.threeCamera.position.clone();
            const targetPos = this.threeOrbitCenter || new THREE.Vector3(0, 0, 0);
            const cameraToModel = targetPos.clone().sub(cameraPos).normalize();





            const dot = modelForward.dot(cameraToModel);


            const modelRight = new THREE.Vector3(1, 0, 0);
            modelRight.applyQuaternion(this.threeModelQuaternion);
            const dotRight = modelRight.dot(cameraToModel);






            const forwardX = modelForward.x;
            const forwardZ = modelForward.z;


            let faceAngle = Math.atan2(forwardZ, forwardX) * 180 / Math.PI;
            if (faceAngle < 0) faceAngle += 360;







            if (faceAngle >= 315 || faceAngle < 45) {
                modelFacing = "Facing left";
            } else if (faceAngle >= 45 && faceAngle < 135) {
                modelFacing = "Facing back";
            } else if (faceAngle >= 135 && faceAngle < 225) {
                modelFacing = "Facing right";
            } else if (faceAngle >= 225 && faceAngle < 315) {
                modelFacing = "Facing front";
            }
        }


        const points = this.threePoseData.points;
        if (!points || points.length === 0) {
            if (this.poseDescriptionText) {
                this.poseDescriptionText.innerText = modelFacing ? `${modelFacing} - No pose data` : "No pose data";
            }
            return;
        }




        const pointMapAbs = {};
        const pointMapLocal = {};


        let inverseQuat = null;
        if (this.threeModelQuaternion) {
            inverseQuat = this.threeModelQuaternion.clone().invert();
        }

        points.forEach(p => {

            pointMapAbs[p.id] = p;


            let localP = { ...p };
            if (inverseQuat) {
                const THREE = window.THREE;
                const vec = new THREE.Vector3(p.x, p.y, p.z);
                vec.applyQuaternion(inverseQuat);
                localP.x = vec.x;
                localP.y = vec.y;
                localP.z = vec.z;
            }
            pointMapLocal[p.id] = localP;
        });


        const getPointAbs = (id) => pointMapAbs[id];
        const getPointLocal = (id) => pointMapLocal[id];


        const descriptions = [];




        const neck = getPointAbs(1);
        const leftShoulder = getPointAbs(2);
        const leftElbow = getPointAbs(3);
        const leftWrist = getPointAbs(4);
        const rightShoulder = getPointAbs(5);
        const rightElbow = getPointAbs(6);
        const rightWrist = getPointAbs(7);
        const leftHip = getPointAbs(8);
        const leftKnee = getPointAbs(9);
        const leftAnkle = getPointAbs(10);
        const rightHip = getPointAbs(11);
        const rightKnee = getPointAbs(12);
        const rightAnkle = getPointAbs(13);


        const getCenter = (p1, p2) => p1 && p2 ? {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2,
            z: (p1.z + p2.z) / 2
        } : null;

        const shoulderCenter = getCenter(leftShoulder, rightShoulder);
        const hipCenter = getCenter(leftHip, rightHip);


        let basePosture = "";
        if (shoulderCenter && hipCenter && neck) {

            const spineVector = {
                x: neck.x - hipCenter.x,
                y: neck.y - hipCenter.y,
                z: neck.z - hipCenter.z
            };
            const spineLen = Math.sqrt(spineVector.x * spineVector.x + spineVector.y * spineVector.y + spineVector.z * spineVector.z);

            if (spineLen > 0) {

                const spineDir = {
                    x: spineVector.x / spineLen,
                    y: spineVector.y / spineLen,
                    z: spineVector.z / spineLen
                };


                const verticalAngle = Math.acos(Math.abs(spineDir.y)) * 180 / Math.PI;


                if (verticalAngle < 45) {



                    const leftAnkleY = leftAnkle ? leftAnkle.y : 0;
                    const rightAnkleY = rightAnkle ? rightAnkle.y : 0;
                    const avgAnkleY = (leftAnkleY + rightAnkleY) / 2;
                    const hipHeight = hipCenter.y - avgAnkleY;
                    const bodyHeight = spineLen;



                    if (spineDir.z < -0.6) {

                        basePosture = "leaning back";
                    } else if (spineDir.z > 0.6) {

                        if (hipHeight < bodyHeight * 0.3) {
                            basePosture = "seated and leaning forward";
                        } else {
                            basePosture = "standing and leaning forward";
                        }
                    } else if (spineDir.z < -0.3) {

                        basePosture = "slightly leaning back";
                    } else if (spineDir.z > 0.3) {

                        basePosture = "slightly leaning forward";
                    } else {

                        if (hipHeight < bodyHeight * 0.3) {

                            const leftKneeY = leftKnee ? leftKnee.y : 0;
                            const rightKneeY = rightKnee ? rightKnee.y : 0;
                            const avgKneeY = (leftKneeY + rightKneeY) / 2;

                            if (avgKneeY > hipCenter.y + 20) {

                                const leftAnkleX = leftAnkle ? leftAnkle.x : 0;
                                const rightAnkleX = rightAnkle ? rightAnkle.x : 0;
                                const leftKneeX = leftKnee ? leftKnee.x : 0;
                                const rightKneeX = rightKnee ? rightKnee.x : 0;

                                const legsCrossed = (leftAnkleX > rightKneeX && rightAnkleX < leftKneeX) ||
                                                   (rightAnkleX > leftKneeX && leftAnkleX < rightKneeX);

                                if (legsCrossed) {
                                    basePosture = "cross-legged sitting";
                                } else {
                                    basePosture = "kneeling";
                                }
                            } else {
                                basePosture = "sitting";
                            }
                        } else if (hipHeight < bodyHeight * 0.6) {
                            basePosture = "squatting";
                        } else {
                            basePosture = "standing";
                        }
                    }
                } else if (verticalAngle > 75) {





                    const shoulderHipDiff = shoulderCenter.y - hipCenter.y;

                    if (shoulderHipDiff > 20) {
                        basePosture = "lying on back";
                    } else if (shoulderHipDiff < -20) {
                        basePosture = "lying face down";
                    } else {
                        basePosture = "lying on side";
                    }
                } else {

                    if (spineDir.z < -0.5) {
                        basePosture = "strong backward lean";
                    } else if (spineDir.z > 0.5) {
                        basePosture = "strong forward lean";
                    } else if (spineDir.z < -0.2) {
                        basePosture = "leaning back";
                    } else if (spineDir.z > 0.2) {
                        basePosture = "leaning forward";
                    } else {
                        basePosture = "tilted posture";
                    }
                }
            }
        }

        if (basePosture) {
            descriptions.push(basePosture);
        }




        const bodyCenter = hipCenter || (leftHip && rightHip ? {
            x: (leftHip.x + rightHip.x) / 2,
            y: (leftHip.y + rightHip.y) / 2,
            z: (leftHip.z + rightHip.z) / 2
        } : null);


        const analyzeArmDetailed = (shoulder, elbow, wrist, side) => {
            if (!shoulder || !elbow || !wrist) return;


            const wristRel = { x: wrist.x - shoulder.x, y: wrist.y - shoulder.y, z: wrist.z - shoulder.z };


            const wristLen = Math.sqrt(wristRel.x * wristRel.x + wristRel.y * wristRel.y + wristRel.z * wristRel.z);

            if (wristLen > 0) {
                const wristDir = {
                    x: wristRel.x / wristLen,
                    y: wristRel.y / wristLen,
                    z: wristRel.z / wristLen
                };


                if (wristDir.y > 0.3) {
                    descriptions.push(`${side} arm raised`);
                } else if (wristDir.y < -0.3) {
                    descriptions.push(`${side} arm lowered`);
                }


                if (wristDir.z > 0.2) {
                    descriptions.push(`${side} arm in front of body`);
                } else if (wristDir.z < -0.1) {
                    descriptions.push(`${side} arm behind body`);
                }
            }
        };


        const leftShoulderLocal = getPointLocal(2);
        const leftElbowLocal = getPointLocal(3);
        const leftWristLocal = getPointLocal(4);
        const rightShoulderLocal = getPointLocal(5);
        const rightElbowLocal = getPointLocal(6);
        const rightWristLocal = getPointLocal(7);
        const leftHipLocal = getPointLocal(8);
        const leftKneeLocal = getPointLocal(9);
        const leftAnkleLocal = getPointLocal(10);
        const rightHipLocal = getPointLocal(11);
        const rightKneeLocal = getPointLocal(12);
        const rightAnkleLocal = getPointLocal(13);

        analyzeArmDetailed(leftShoulderLocal, leftElbowLocal, leftWristLocal, "Left");
        analyzeArmDetailed(rightShoulderLocal, rightElbowLocal, rightWristLocal, "Right");


        const analyzeLegDetailed = (hip, knee, ankle, side) => {
            if (!hip || !knee || !ankle) return;


            const kneeLocal = { x: knee.x - hip.x, y: knee.y - hip.y, z: knee.z - hip.z };
            const ankleLocal = { x: ankle.x - knee.x, y: ankle.y - knee.y, z: ankle.z - knee.z };


            const kneeLen = Math.sqrt(kneeLocal.x * kneeLocal.x + kneeLocal.y * kneeLocal.y + kneeLocal.z * kneeLocal.z);

            if (kneeLen > 0) {

                const kneeDir = {
                    x: kneeLocal.x / kneeLen,
                    y: kneeLocal.y / kneeLen,
                    z: kneeLocal.z / kneeLen
                };



                if (kneeDir.z > 0.7) {
                    descriptions.push(`${side} knee lifted high`);
                } else if (kneeDir.z > 0.4) {
                    descriptions.push(`${side} knee raised`);
                } else if (kneeDir.z > 0.2) {
                    descriptions.push(`${side} knee slightly raised`);
                }
            }


            const footLen = Math.sqrt(ankleLocal.y * ankleLocal.y + ankleLocal.z * ankleLocal.z);

            if (footLen > 0) {
                const footDirY = ankleLocal.y / footLen;
                if (footDirY > 0.7) {
                    descriptions.push(`${side} foot lifted high`);
                } else if (footDirY > 0.4) {
                    descriptions.push(`${side} foot raised`);
                }
            }
        };

        analyzeLegDetailed(leftHipLocal, leftKneeLocal, leftAnkleLocal, "Left");
        analyzeLegDetailed(rightHipLocal, rightKneeLocal, rightAnkleLocal, "Right");


        if (leftKneeLocal && rightKneeLocal && leftHipLocal && rightHipLocal) {

            const leftKneeRel = { x: leftKneeLocal.x - leftHipLocal.x, y: leftKneeLocal.y - leftHipLocal.y, z: leftKneeLocal.z - leftHipLocal.z };
            const rightKneeRel = { x: rightKneeLocal.x - rightHipLocal.x, y: rightKneeLocal.y - rightHipLocal.y, z: rightKneeLocal.z - rightHipLocal.z };


            const kneeDistanceX = Math.abs(leftKneeRel.x - rightKneeRel.x);


            if (kneeDistanceX > 120) {
                descriptions.push("legs spread wide");
            } else if (kneeDistanceX > 80) {
                descriptions.push("legs apart");
            } else if (kneeDistanceX > 40) {
                descriptions.push("legs slightly apart");
            } else if (kneeDistanceX < 15) {
                descriptions.push("legs together");
            }
        }


        let poseDesc = descriptions.join(", ");
        if (poseDesc === "") {
            poseDesc = "neutral standing pose";
        }


        const finalDescription = modelFacing ? `${modelFacing} - ${poseDesc}` : poseDesc;

        if (this.poseDescriptionText) {
            this.poseDescriptionText.innerText = finalDescription;
            this.poseDescriptionText.title = finalDescription;
        }


        if (this.node && this.node.properties) {
            let poseData = {};
            if (this.node.properties.poses_datas) {
                try {
                    poseData = JSON.parse(this.node.properties.poses_datas);
                } catch (e) {
                    poseData = {};
                }
            }
            poseData.posture_description = finalDescription;
            const newJson = JSON.stringify(poseData);
            this.node.properties.poses_datas = newJson;
            if (this.node.jsonWidget) {
                this.node.jsonWidget.value = newJson;
            }
            console.log("[OpenPose] Saved posture description to poses_datas:", finalDescription.substring(0, 30));
        }
    }


    calculateArmAngle(p1, p2, p3) {
        const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
        const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };

        const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
        const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
        const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);

        if (mag1 === 0 || mag2 === 0) return 180;

        const cosAngle = dot / (mag1 * mag2);
        const clampedCos = Math.max(-1, Math.min(1, cosAngle));
        return Math.acos(clampedCos) * 180 / Math.PI;
    }

    deleteSelectedPoints() {
        const activeObjects = this.canvas.getActiveObjects();
        if (!activeObjects || activeObjects.length === 0) return;

        const objectsToDelete = new Set();
        const allPolygons = this.canvas.getObjects('polygon');

        activeObjects.forEach(obj => {
            if (obj.type !== 'circle') return;

            let connectionCount = 0;
            allPolygons.forEach(line => {
                if (line._poseId === obj._poseId && (line._startCircle === obj || line._endCircle === obj)) {
                    connectionCount++;
                }
            });

            if (connectionCount <= 1) {
                objectsToDelete.add(obj);
            }
        });

        if (objectsToDelete.size === 0) return;

        allPolygons.forEach(line => {
            if (objectsToDelete.has(line._startCircle) || objectsToDelete.has(line._endCircle)) {
                objectsToDelete.add(line);
            }
        });

        objectsToDelete.forEach(obj => this.canvas.remove(obj));

        this.canvas.discardActiveObject();
        this.canvas.renderAll();

        this.syncDimensionsToNode();
    }

    removeFilteredPose() {
        const filterIndex = parseInt(this.poseFilterInput.value, 10);

        const allCircles = this.canvas.getObjects('circle');
        const poseIds = [...new Set(allCircles.map(c => c._poseId))];
        poseIds.sort((a, b) => a - b);

        const objectsToRemove = new Set();

        if (filterIndex === -1) {
            this.canvas.getObjects().forEach(obj => objectsToRemove.add(obj));
            this.nextPoseId = 0;
        } else if (filterIndex >= 0 && filterIndex < poseIds.length) {
            const targetPoseId = poseIds[filterIndex];
            this.canvas.getObjects().forEach(obj => {
                if (obj._poseId === targetPoseId) {
                    objectsToRemove.add(obj);
                }
            });
        }

        if (objectsToRemove.size === 0) return;

        objectsToRemove.forEach(obj => this.canvas.remove(obj));
        this.poseFilterInput.value = "-1";
        this.applyPoseFilter(-1);
        this.canvas.renderAll();

        this.syncDimensionsToNode();
    }

    applyPoseFilter(filterIndex) {
        if (this.lockMode) return;

        const allCircles = this.canvas.getObjects('circle');
        const poseIds = [...new Set(allCircles.map(c => c._poseId))];
        poseIds.sort((a, b) => a - b);

        let targetPoseId = -1;
        if (filterIndex >= 0 && filterIndex < poseIds.length) {
            targetPoseId = poseIds[filterIndex];
        }

        this.canvas.getObjects().forEach(obj => {
            if (filterIndex === -1) {
                obj.set({
                    selectable: true,
                    evented: true
                });
            } else {
                if (obj._poseId === targetPoseId) {
                    obj.set({
                        selectable: true,
                        evented: true
                    });
                } else {
                    obj.set({
                        selectable: false,
                        evented: false
                    });
                }
            }
        });

        this.canvas.discardActiveObject();
        this.canvas.renderAll();
    }

    selectAll() {
        this.canvas.discardActiveObject();
        if (this.activeSelection) {
            this.activeSelection.forEach(obj => obj.set('stroke', obj.originalStroke));
        }

        const allCircles = this.canvas.getObjects('circle');
        if (allCircles.length > 0) {
            this.activeSelection = [...allCircles];
            this.activeSelection.forEach(obj => {
                obj.originalStroke = obj.stroke;
                obj.set('stroke', '#FFFF00');
            });
            this.canvas.renderAll();
        }
    }

    syncDimensionsToNode() {
        if (!this.node) return;

        const newWidth = Math.round(this.canvas.width);
        const newHeight = Math.round(this.canvas.height);

        this.node.setProperty("output_width_for_dwpose", newWidth);
        this.node.setProperty("output_height_for_dwpose", newHeight);

        const widthWidget = this.node.widgets?.find(w => w.name === "output_width_for_dwpose");
        if (widthWidget) {
            widthWidget.value = newWidth;
            if (widthWidget.callback) {
                widthWidget.callback(newWidth);
            }
            if (widthWidget.inputEl) {
                widthWidget.inputEl.value = newWidth;
            }
        }

        const heightWidget = this.node.widgets?.find(w => w.name === "output_height_for_dwpose");
        if (heightWidget) {
            heightWidget.value = newHeight;
            if (heightWidget.callback) {
                heightWidget.callback(newHeight);
            }
            if (heightWidget.inputEl) {
                heightWidget.inputEl.value = newHeight;
            }
        }

        this.node.setDirtyCanvas(true, true);
        if (app.graph) {
            app.graph.setDirtyCanvas(true, true);
        }
        if (app.canvas) {
            app.canvas.draw(true);
        }

        if (this.node.onPropertyChanged) {
            this.node.onPropertyChanged("output_width_for_dwpose", newWidth, this.node.properties.output_width_for_dwpose);
            this.node.onPropertyChanged("output_height_for_dwpose", newHeight, this.node.properties.output_height_for_dwpose);
        }
    }


    async loadFromPoseKeypoint() {
        try {

            let poseData = this.node.properties?.poses_datas;

            if (!poseData || poseData.trim() === "") {
                alert("No valid poses_datas data was detected. Please make sure this property has a value.");
                return;
            }


            let poseJson = null;
            if (typeof poseData === "string") {
                poseJson = JSON.parse(poseData);
            } else if (Array.isArray(poseData) || typeof poseData === "object") {
                poseJson = poseData;
            }

            if (!poseJson) {
                alert("poses_datas data format is invalid.");
                return;
            }


            const dataFingerprint = JSON.stringify(poseJson);
            if (this.lastPoseData === dataFingerprint) {
                alert("Pose data has not changed. No update is needed.");
                return;
            }
            this.lastPoseData = dataFingerprint;




            let canvasWidth = 512;
            let canvasHeight = 512;
            if (Array.isArray(poseJson) && poseJson[0]) {
                canvasWidth = poseJson[0].canvas_width || poseJson[0].width || 512;
                canvasHeight = poseJson[0].canvas_height || poseJson[0].height || 512;
            } else if (poseJson.width && poseJson.height) {
                canvasWidth = poseJson.width;
                canvasHeight = poseJson.height;
            }


            this.resizeCanvas(canvasWidth, canvasHeight);


            let people = [];
            if (Array.isArray(poseJson) && poseJson[0]?.people) {
                people = poseJson[0].people;
            } else if (poseJson.people) {
                people = poseJson.people;
            }

            if (people.length > 0) {
                await this.setPose(people);
                this.syncDimensionsToNode();
            } else {
                alert("No valid human keypoint data was found in poses_datas.");
            }

        } catch (error) {
            alert(`Failed to load pose data: ${error.message}`);
        }
    }

    fixLimbs() {
        if (this.lockMode) return;
        if (this.is3DMode) {
            this.fixLimbs3D();
            return;
        }

        const allCircles = this.canvas.getObjects('circle');
        const poses = {};
        allCircles.forEach(circle => {
            const poseId = circle._poseId;
            if (!poses[poseId]) poses[poseId] = [];
            poses[poseId].push(circle);
        });







        const symmetryPairs = [
            [2, 5], [3, 6], [4, 7],
            [8, 11], [9, 12], [10, 13],
            [14, 15], [16, 17]
        ];




        const limbExtensions = [
            [4, 3, 2], [7, 6, 5],
            [10, 9, 8], [13, 12, 11]
        ];

        Object.keys(poses).forEach(poseId => {
            const poseCircles = poses[poseId];
            const keypoints = new Array(18).fill(null);


            poseCircles.forEach(c => {
                keypoints[c._id] = c;
            });



            const addMissingPoint = (id, x, y) => {
                if (keypoints[id]) return;

                const circle = new fabric.Circle({
                    left: x, top: y, radius: 5,
                    fill: `rgb(${connect_color[id] ? connect_color[id].join(", ") : '255,255,255'})`,
                    stroke: `rgb(${connect_color[id] ? connect_color[id].join(", ") : '255,255,255'})`,
                    originX: 'center', originY: 'center',
                    hasControls: false, hasBorders: false,
                    _id: id,
                    _poseId: parseInt(poseId)
                });

                this.canvas.add(circle);
                keypoints[id] = circle;
            };


            const neck = keypoints[1];
            if (neck) {
                symmetryPairs.forEach(pair => {
                    const leftId = pair[1];
                    const rightId = pair[0];

                    const L = keypoints[leftId];
                    const R = keypoints[rightId];

                    if (L && !R) {

                        addMissingPoint(rightId, neck.left + (neck.left - L.left), L.top);
                    } else if (!L && R) {

                        addMissingPoint(leftId, neck.left + (neck.left - R.left), R.top);
                    }
                });
            }



            limbExtensions.forEach(rule => {
                const [target, p1, p2] = rule;
                if (!keypoints[target] && keypoints[p1] && keypoints[p2]) {
                    const P1 = keypoints[p1];
                    const P2 = keypoints[p2];
                    const vX = P1.left - P2.left;
                    const vY = P1.top - P2.top;
                    addMissingPoint(target, P1.left + vX, P1.top + vY);
                }
            });
        });


        const existingPolygons = this.canvas.getObjects('polygon');

        Object.keys(poses).forEach(poseIdStr => {
            const poseId = parseInt(poseIdStr);
            const posePoints = this.canvas.getObjects('circle').filter(c => c._poseId === poseId);
            const pointMap = {};
            posePoints.forEach(p => pointMap[p._id] = p);

            connect_keypoints.forEach(pair => {
                const start = pointMap[pair[0]];
                const end = pointMap[pair[1]];

                if (start && end) {

                    const hasLine = existingPolygons.some(l =>
                        l._poseId === poseId &&
                        ((l._startCircle === start && l._endCircle === end) ||
                         (l._startCircle === end && l._endCircle === start))
                    );

                    if (!hasLine) {

                        const points = this.getFusiformPoints(
                            { x: start.left, y: start.top },
                            { x: end.left, y: end.top }
                        );

                        const polygon = new fabric.Polygon(points, {
                            fill: `rgba(${connect_color[pair[0]] ? connect_color[pair[0]].join(", ") : '255,255,255'}, 0.7)`,
                            strokeWidth: 0,
                            selectable: false,
                            evented: false,
                            lockMovementX: true,
                            lockMovementY: true,
                            lockRotation: true,
                            lockScalingX: true,
                            lockScalingY: true,
                            lockSkewingX: true,
                            lockSkewingY: true,
                            hasControls: false,
                            hasBorders: false,
                            originX: 'center',
                            originY: 'center',
                            _startCircle: start,
                            _endCircle: end,
                            _poseId: poseId
                        });
                        this.canvas.add(polygon);
                        this.canvas.sendToBack(polygon);
                    }
                }
            });
        });

        this.canvas.requestRenderAll();
    }

    fixLimbs3D() {
        if (!this.threePoseData?.points?.length) {
            return;
        }

        const poses = new Map();
        this.threePoseData.points.forEach(point => {
            if (!poses.has(point.poseId)) {
                poses.set(point.poseId, new Map());
            }
            poses.get(point.poseId).set(point.id, point);
        });

        const symmetryPairs = [
            [2, 5], [3, 6], [4, 7],
            [8, 11], [9, 12], [10, 13],
            [14, 15], [16, 17],
        ];

        const limbExtensions = [
            [4, 3, 2], [7, 6, 5],
            [10, 9, 8], [13, 12, 11],
        ];

        let addedPoints = 0;
        poses.forEach((pointMap, poseId) => {
            const addMissingPoint = (id, x, y, z) => {
                if (pointMap.has(id)) {
                    return;
                }
                const point = {
                    id,
                    poseId,
                    x,
                    y,
                    z,
                    color: connect_color[id] || [255, 255, 255],
                };
                this.threePoseData.points.push(point);
                pointMap.set(id, point);
                addedPoints += 1;
            };

            const neck = pointMap.get(1);
            if (neck) {
                symmetryPairs.forEach(([rightId, leftId]) => {
                    const left = pointMap.get(leftId);
                    const right = pointMap.get(rightId);

                    if (left && !right) {
                        addMissingPoint(rightId, neck.x + (neck.x - left.x), left.y, left.z);
                    } else if (!left && right) {
                        addMissingPoint(leftId, neck.x + (neck.x - right.x), right.y, right.z);
                    }
                });
            }

            limbExtensions.forEach(([target, p1, p2]) => {
                const point1 = pointMap.get(p1);
                const point2 = pointMap.get(p2);
                if (!pointMap.get(target) && point1 && point2) {
                    addMissingPoint(
                        target,
                        point1.x + (point1.x - point2.x),
                        point1.y + (point1.y - point2.y),
                        point1.z + (point1.z - point2.z)
                    );
                }
            });
        });

        const connectionKeys = new Set(
            this.threePoseData.connections.map(conn => `${conn.startId}_${conn.endId}_${conn.startPoseId}_${conn.endPoseId}`)
        );
        poses.forEach((pointMap, poseId) => {
            connect_keypoints.forEach(([startId, endId]) => {
                if (!pointMap.has(startId) || !pointMap.has(endId)) {
                    return;
                }
                const key = `${startId}_${endId}_${poseId}_${poseId}`;
                if (connectionKeys.has(key)) {
                    return;
                }
                connectionKeys.add(key);
                this.threePoseData.connections.push({
                    startId,
                    endId,
                    startPoseId: poseId,
                    endPoseId: poseId,
                });
            });
        });

        if (addedPoints > 0) {
            this.nextPoseId = Math.max(this.nextPoseId, ...this.threePoseData.points.map(point => point.poseId + 1));
        }

        this.render3DPose();
        this.update3DStatus();
    }

    showPauseControls() {
        const pauseToolbar = this.pauseToolbar;
        if (!pauseToolbar) return;

        pauseToolbar.innerHTML = "";
        pauseToolbar.style.display = "flex";


        const statusText = document.createElement("span");
        statusText.innerText = "Workflow paused...";
        statusText.style.cssText = "color: #ffcc00; font-weight: bold; font-size: 12px; margin-right: 15px;";
        pauseToolbar.appendChild(statusText);


        const btnContinue = document.createElement("button");
        btnContinue.innerText = "Resume";
        btnContinue.title = "Submit the current edit and continue the workflow";
        btnContinue.style.cssText = "background: #228be6; color: white; border: none; padding: 5px 15px; border-radius: 4px; cursor: pointer; font-weight: bold;";

        btnContinue.onclick = async () => {
            try {
                btnContinue.innerText = "Submitting...";
                btnContinue.disabled = true;


                let imageData = null;
                if (this.is3DMode && this.threeRenderer) {
                    try {

                        imageData = this.threeRenderer.domElement.toDataURL('image/png');


                        await api.fetchApi("/openpose/save_3d_pose_image", {
                            method: "POST",
                            body: JSON.stringify({
                                node_id: this.node.id,
                                image_data: imageData
                            })
                        });
                    } catch (e) {
                        console.log('[OpenPose] Failed to capture 3D pose image:', e);
                    }
                }


                const poseData = this.serializeJSON();


                await api.fetchApi("/openpose/update_pose", {
                    method: "POST",
                    body: JSON.stringify({ node_id: this.node.id, pose_data: poseData })
                });


                pauseToolbar.style.display = "none";
                this.node.is_paused = false;


                if (this.panel) {
                    this.panel.close();
                }
            } catch (e) {
                alert("Submit failed: " + e.message);
                btnContinue.innerText = "Retry";
                btnContinue.disabled = false;
            }
        };


        const btnCancel = document.createElement("button");
        btnCancel.innerText = "Cancel";
        btnCancel.title = "Cancel the current workflow";
        btnCancel.style.cssText = "background: #fa5252; color: white; border: none; padding: 5px 15px; border-radius: 4px; cursor: pointer; font-weight: bold;";

        btnCancel.onclick = async () => {
            if(!confirm("Are you sure you want to cancel the current workflow?")) return;

            try {
                await api.fetchApi("/openpose/cancel", {
                    method: "POST",
                    body: JSON.stringify({ node_id: this.node.id })
                });

                pauseToolbar.style.display = "none";
                this.node.is_paused = false;


                if (this.panel) {
                    this.panel.close();
                }
            } catch (e) {
                alert("Cancel failed: " + e.message);
            }
        };

        pauseToolbar.appendChild(btnContinue);
        pauseToolbar.appendChild(btnCancel);
    }

    constructor(panel, node, initialData = {}) {
        this.panel = panel;
        this.node = node;
        this.nextPoseId = 0;


        this.initialPoseData = null;
        this.initialBackgroundImage = null;
        this.threeBackgroundTexture = null;
        this.threeBackgroundCanvas = null;
        this.threeBackgroundSyncToken = 0;

        this.panel.style.overflow = 'hidden';
        this.setPanelStyle();

        const rootHtml = `
                <canvas class="openpose-editor-canvas" />
                <div class="canvas-drag-overlay" />
                <input bind:this={fileInput} class="openpose-file-input" type="file" accept=".json" />
                <input class="openpose-bg-file-input" type="file" accept="image/jpeg,image/png,image/webp" />
        `;

        const container = this.panel.addHTML(rootHtml, "openpose-container");


        container.style.cssText = "position: absolute; top: 40px; bottom: 160px; left: 10px; right: 10px; overflow: hidden; display: flex; align-items: center; justify-content: center;";


        this.panel.footer.style.position = "absolute";
        this.panel.footer.style.bottom = "0";
        this.panel.footer.style.left = "0";
        this.panel.footer.style.right = "0";
        this.panel.footer.style.height = "160px";
        this.panel.footer.style.padding = "5px 10px";
        this.panel.footer.style.boxSizing = "border-box";
        this.panel.footer.style.overflow = "hidden";
        this.panel.footer.style.display = "flex";
        this.panel.footer.style.flexDirection = "column";
        this.panel.footer.style.justifyContent = "flex-end";
        this.panel.footer.style.gap = "5px";
        this.panel.footer.style.zIndex = "100";
        this.panel.footer.style.pointerEvents = "auto";


        this.poseDescriptionContainer = document.createElement("div");
        this.poseDescriptionContainer.className = "pose-description-container";
        this.poseDescriptionContainer.style.cssText = "width: 100%; min-height: 30px; display: flex; align-items: center; gap: 10px; background: rgba(30, 30, 30, 0.8); border: none; border-radius: 4px; padding: 5px 10px; box-sizing: border-box; margin-bottom: 5px;";
        this.poseDescriptionContainer.style.pointerEvents = "auto";


        this.poseDescriptionText = document.createElement("div");
        this.poseDescriptionText.className = "pose-description-text";
        this.poseDescriptionText.style.cssText = "flex: 1; color: #fff; font-size: 12px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
        this.poseDescriptionText.innerText = "Waiting for pose analysis...";


        this.copyDescriptionBtn = document.createElement("button");
        this.copyDescriptionBtn.innerText = "Copy";
        this.copyDescriptionBtn.style.cssText = "background: #228be6; color: white; border: none; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 11px; white-space: nowrap;";
        this.copyDescriptionBtn.onclick = () => {
            const text = this.poseDescriptionText.innerText;
            if (text && text !== "Waiting for pose analysis...") {
                navigator.clipboard.writeText(text).then(() => {
                    this.copyDescriptionBtn.innerText = "Copied!";
                    setTimeout(() => {
                        this.copyDescriptionBtn.innerText = "Copy";
                    }, 1500);
                });
            }
        };

        this.poseDescriptionContainer.appendChild(this.poseDescriptionText);
        this.poseDescriptionContainer.appendChild(this.copyDescriptionBtn);


        this.pauseToolbar = document.createElement("div");
        this.pauseToolbar.className = "pause-toolbar";
        this.pauseToolbar.style.cssText = "width: 100%; height: 40px; display: none; align-items: center; justify-content: center; gap: 10px; background: rgba(50, 50, 50, 0.5); border: none; border-radius: 4px;";
        this.pauseToolbar.style.pointerEvents = "auto";

        this.mainToolbar = document.createElement("div");
        this.mainToolbar.className = "main-toolbar";
        this.mainToolbar.style.cssText = "width: 100%; min-height: 40px; display: flex; align-items: center; justify-content: flex-start; flex-wrap: wrap; gap: 6px; border: none;";
        this.mainToolbar.style.pointerEvents = "auto";

        this.panel.footer.appendChild(this.poseDescriptionContainer);
        this.panel.footer.appendChild(this.pauseToolbar);
        this.panel.footer.appendChild(this.mainToolbar);

        container.style.pointerEvents = 'none';

        this.canvasWidth = this.node.properties.output_width_for_dwpose || 512;
        this.canvasHeight = this.node.properties.output_height_for_dwpose || 512;

        this.canvasElem = container.querySelector(".openpose-editor-canvas");
        this.canvasElem.width = this.canvasWidth;
        this.canvasElem.height = this.canvasHeight;
        this.canvasElem.style.cssText = "margin: 0.25rem; border-radius: 0.25rem; border: 0.5px solid #666;";

        this.canvas = this.initCanvas(this.canvasElem);
        this.canvas.wrapperEl.style.pointerEvents = 'auto';
        this.canvasWrapperEl = this.canvas.wrapperEl || this.canvasElem.parentElement;
        this.canvasHostElem = this.canvasWrapperEl?.parentElement || container;
        if (this.canvasHostElem && !this.canvasHostElem.style.position) {
            this.canvasHostElem.style.position = "relative";
        }


        container.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            return false;
        });

        this.fileInput = container.querySelector(".openpose-file-input");
        this.fileInput.style.display = "none";
        this.fileInput.addEventListener("change", this.onLoad.bind(this));


        this.panel.addButton = (name, callback) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.innerText = name;
            btn.onclick = callback;
            btn.style.cssText = "background: #222; color: #ddd; border: 1px solid #444; padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 12px;";
            this.mainToolbar.appendChild(btn);
            return btn;
        };

        this.panel.addButton("Add", () => {
            if (this.is3DMode) {

                this.add3DPose();
            } else {

                const default_pose_keypoints_2d = [];
                DEFAULT_KEYPOINTS.forEach(pt => {
                    default_pose_keypoints_2d.push(pt[0], pt[1], 1.0);
                });
                this.addPose(default_pose_keypoints_2d);
            }
            this.syncDimensionsToNode();
        });

        this.panel.addButton("Delete Points", () => {
            if (this.is3DMode) {
                this.delete3DSelectedPoints();
            } else {
                this.deleteSelectedPoints();
            }
        });
        this.panel.addButton("Clear", () => {
            if (this.is3DMode) {
                this.clear3DPose();
            } else {
                this.removeFilteredPose();
            }
        });
        this.panel.addButton("Reset", () => {
            if (this.initialPoseData) {
                void this.loadJSON(this.initialPoseData).then(() => {
                    if (this.is3DMode) {
                        this.reset3DView();
                    }
                });

                if (this.initialBackgroundImage) {
                    void this.applyBackgroundState(this.initialBackgroundImage);
                } else {
                    void this.clearBackgroundState();
                }

                this.syncDimensionsToNode();
            } else {

                this.resetCanvas();
                void this.clearBackgroundState();

                const default_pose_keypoints_2d = [];
                DEFAULT_KEYPOINTS.forEach(pt => {
                    default_pose_keypoints_2d.push(pt[0], pt[1], 1.0);
                });
                const defaultPeople = [{ "pose_keypoints_2d": default_pose_keypoints_2d }];

                void this.setPose(defaultPeople).then(() => {
                    if (this.is3DMode) {
                        this.recordInitial3DViewState();
                    }
                });

                this.syncDimensionsToNode();
            }
        });

        this.panel.addButton("Save", () => {
            void this.save();
            this.syncDimensionsToNode();
        });
        this.panel.addButton("Load", () => this.load());
        this.panel.addButton("Select All", () => {
            if (this.is3DMode) {
                this.selectAll3D();
                return;
            }

            const selectableCircles = this.canvas.getObjects('circle').filter(obj => obj.selectable);

            if (selectableCircles.length > 0) {
                this.canvas.discardActiveObject();

                const selection = new fabric.ActiveSelection(selectableCircles, {
                    canvas: this.canvas,
                });
                this.canvas.setActiveObject(selection);

                this.canvas.fire('selection:created', { target: selection });

                this.canvas.renderAll();
            }
        });


        this.panel.addButton("Auto Complete", () => {
            this.fixLimbs();
        });

        this.panel.addButton("Mirror", () => {
            if (this.is3DMode) {
                this.mirror3DPose();
            }
        }).title = "Mirror the current 3D pose across the model local X axis";

        this.panel.addButton("L→R", () => {
            if (this.is3DMode) {
                this.copy3DPoseSide("left_to_right");
            }
        }).title = "Copy the left side pose to the right side in 3D";

        this.panel.addButton("R→L", () => {
            if (this.is3DMode) {
                this.copy3DPoseSide("right_to_left");
            }
        }).title = "Copy the right side pose to the left side in 3D";

        this.bgFileInput = container.querySelector(".openpose-bg-file-input");
        this.bgFileInput.style.display = "none";
        this.bgFileInput.addEventListener("change", (e) => this.loadBackgroundImage(e));
        this.panel.addButton("Background", () => this.bgFileInput.click());


        this.panel.addButton("Clear Background", () => {
            void this.clearBackgroundState();
        });


        this.mode3DButton = this.panel.addButton("3D Mode: On", () => {
            this.toggle3DMode();
        });


        this.showGizmoButton = this.panel.addButton("Gizmo: On", () => {
            this.toggleGizmoVisibility();
        });

        this.resetViewButton = this.panel.addButton("Reset View", () => {
            if (this.is3DMode) {
                this.reset3DView();
            }
        });
        this.resetViewButton.title = "Restore the initial camera angle and zoom for the current pose";

        this.frameSelectionButton = this.panel.addButton("Frame", () => {
            if (this.is3DMode) {
                this.focus3DSelection(true);
            }
        });
        this.frameSelectionButton.title = "Frame the current selection, or all points if nothing is selected";

        this.cameraSpaceModeButton = this.panel.addButton("Cam: World", () => {
            this.setThreeCameraSpaceMode(
                this.threeCameraSpaceMode === "world" ? "local" : "world"
            );
        });
        this.cameraSpaceModeButton.title = "Switch camera orbit and view presets between world space and model local space";

        this.transformSpaceModeButton = this.panel.addButton("Axes: Local", () => {
            this.setThreeTransformSpaceMode(
                this.threeTransformSpaceMode === "local" ? "world" : "local"
            );
        });
        this.transformSpaceModeButton.title = "Switch gizmo axes and model-rotation axes between local and world space";

        Object.entries(THREE_CAMERA_VIEW_PRESETS).forEach(([presetName, preset]) => {
            const button = this.panel.addButton(preset.label, () => {
                if (this.is3DMode) {
                    this.apply3DViewPreset(presetName);
                }
            });
            button.title = `Snap the 3D camera to the ${preset.label.toLowerCase()} view around the current pivot target`;
        });

        this.projectionModeButton = this.panel.addButton("Proj: Persp", () => {
            this.setThreeCameraProjectionMode(
                this.threeCameraProjectionMode === "perspective" ? "orthographic" : "perspective"
            );
        });
        this.projectionModeButton.title = "Toggle between perspective and orthographic projection";

        this.navigationModeButton = this.panel.addButton("Nav: Orbit", () => {
            this.threeCameraNavigationMode = this.threeCameraNavigationMode === "camera_orbit"
                ? "model_rotate_legacy"
                : "camera_orbit";
            this.updateNavigationModeButton();
            this.update3DStatus();
        });
        this.navigationModeButton.title = "Switch between orbiting the camera and rotating the model";

        this.pivotModeButton = this.panel.addButton("Pivot: Model", () => {
            if (this.threeCameraPivotMode === "model_center") {
                this.setCameraPivotFromSelectionCenter(true);
            } else {
                this.setCameraPivotFromModelCenter();
            }
        });
        this.pivotModeButton.title = "Set the camera pivot from the model center or the current selection";

        this.rigModeButton = this.panel.addButton("Mode: FK", () => {
            this.threeRigMode = this.threeRigMode === "fk" ? "ik" : "fk";
            this.updateRigModeButton();
            this.update3DStatus();
        });
        this.rigModeButton.title = "Switch between FK and IK editing modes";

        const setupDimensionInput = (label, value, callback) => {
            const lbl = document.createElement("label");
            lbl.innerHTML = label;
            lbl.style.cssText = "font-family: Arial; padding: 0 0.5rem; color: #ccc; display: none;";
            const input = document.createElement("input");
            input.style.cssText = "background: #1c1c1c; color: #aaa; width: 60px; border: 1px solid #444; display: none;";
            input.type = "number";
            input.min = "64";
            input.max = "4096";
            input.step = "64";
            input.value = value;
            input.addEventListener("change", (e) => {
                const newValue = parseInt(e.target.value);
                if (!isNaN(newValue)) {
                    callback(newValue);
                    this.syncDimensionsToNode();
                }
            });
            this.mainToolbar.appendChild(lbl);
            this.mainToolbar.appendChild(input);
            return input;
        };

        this.widthInput = setupDimensionInput("", this.canvasWidth, (value) => {
            this.resizeCanvas(value, this.canvasHeight);
        });
        this.heightInput = setupDimensionInput("", this.canvasHeight, (value) => {
            this.resizeCanvas(this.canvasWidth, value);
        });

        this.widthInput.addEventListener("input", (e) => {
            const val = parseInt(e.target.value);
            if (!isNaN(val) && val > 0) {
                this.canvasWidth = val;
                this.canvas.setWidth(val);
                this.canvas.renderAll();
            }
        });
        this.heightInput.addEventListener("input", (e) => {
            const val = parseInt(e.target.value);
            if (!isNaN(val) && val > 0) {
                this.canvasHeight = val;
                this.canvas.setHeight(val);
                this.canvas.renderAll();
            }
        });

        const lbl = document.createElement("label");
        lbl.innerHTML = "Person";
        lbl.style.cssText = "font-family: Arial; padding: 0 0.5rem; color: #ccc;";

        this.poseFilterInput = document.createElement("input");
        this.poseFilterInput.style.cssText = "background: #1c1c1c; color: #aaa; width: 60px; border: 1px solid #444;";
        this.poseFilterInput.type = "number";
        this.poseFilterInput.min = "-1";
        this.poseFilterInput.step = "1";
        this.poseFilterInput.value = this.node.properties.poseFilterIndex || "-1";

        this.poseFilterInput.addEventListener("input", () => {
            const filterValue = parseInt(this.poseFilterInput.value, 10);
            this.applyPoseFilter(filterValue);
            this.node.setProperty("poseFilterIndex", filterValue);
            this.syncDimensionsToNode();
        });

        this.mainToolbar.appendChild(lbl);
        this.mainToolbar.appendChild(this.poseFilterInput);

        this.statusTextEl = document.createElement("div");
        this.statusTextEl.style.cssText = "min-width: 320px; color: #9ecbff; font-size: 11px; padding-left: 8px; white-space: nowrap;";
        this.mainToolbar.appendChild(this.statusTextEl);
        this.updateCameraSpaceModeButton();
        this.updateTransformSpaceModeButton();
        this.updateNavigationModeButton();
        this.updatePivotModeButton();
        this.updateRigModeButton();
        this.updateProjectionModeButton();
        this.update3DStatus();

        setTimeout(async () => {

            if (this.node.is_paused) {
                this.showPauseControls();
            }

            const savedFilterIndex = this.node.properties.poseFilterIndex;
            if (savedFilterIndex !== undefined && savedFilterIndex !== null) {
                this.poseFilterInput.value = savedFilterIndex;
                this.applyPoseFilter(savedFilterIndex);
            }

            const bgImageFilename = this.node.properties.backgroundImage;
            if (bgImageFilename) {

                this.initialBackgroundImage = bgImageFilename;
                await this.applyBackgroundState(bgImageFilename, { syncNode: false, sync3D: false });
            }

            if (this.node.properties.poses_datas && this.node.properties.poses_datas.trim() !== "") {

                this.initialPoseData = this.node.properties.poses_datas;

                const error = await this.loadJSON(this.node.properties.poses_datas);
                if (error) {
                    this.resizeCanvas(this.canvasWidth, this.canvasHeight);
                    const fallbackPeople = [{
                        pose_keypoints_2d: DEFAULT_KEYPOINTS.flatMap(pt => [pt[0], pt[1], 1.0]),
                    }];
                    await this.setPose(fallbackPeople);
                }
            } else {
                this.resizeCanvas(this.canvasWidth, this.canvasHeight);

                const default_pose_keypoints_2d = [];
                DEFAULT_KEYPOINTS.forEach(pt => {
                    default_pose_keypoints_2d.push(pt[0], pt[1], 1.0);
                });
                const defaultPeople = [{ "pose_keypoints_2d": default_pose_keypoints_2d }];

                await this.setPose(defaultPeople);
                this.syncDimensionsToNode();


                this.initialPoseData = JSON.stringify({
                    width: this.canvasWidth,
                    height: this.canvasHeight,
                    people: defaultPeople
                });
            }



            this.enable3DModeByDefault();
        }, 0);

        const keyHandler = this.onKeyDown.bind(this);
        document.addEventListener("keydown", keyHandler);
        this.panel.onClose = () => {
            document.removeEventListener("keydown", keyHandler);
            this.stop3DAnimationLoop();
            this.cancelPoseDescriptionRefresh();
            this.syncDimensionsToNode();

        };
    }

    getThreePointObjectKey(id, poseId) {
        return `point_${id}_${poseId}`;
    }

    getThreePointDataByIds(id, poseId) {
        return this.threePoseData?.points?.find(point => point.id === id && point.poseId === poseId) || null;
    }

    getThreePointObjectByIds(id, poseId) {
        return this.threeObjects?.get(this.getThreePointObjectKey(id, poseId)) || null;
    }

    get3DSelectedPointObjects() {
        return [...this.threeSelectedObjects].filter(obj => obj?.userData?.pointData);
    }

    getAll3DPointObjects() {
        const allObjects = [];
        this.threeObjects?.forEach((obj, key) => {
            if (key.startsWith("point_")) {
                allObjects.push(obj);
            }
        });
        return allObjects;
    }

    getTransformTargetObjects() {
        const selectedObjects = this.get3DSelectedPointObjects();
        if (selectedObjects.length > 0) {
            return selectedObjects;
        }

        return this.getAll3DPointObjects();
    }

    getTransformPivot() {
        const selectedObjects = this.get3DSelectedPointObjects();
        if (selectedObjects.length > 0 && this.threeTransformCenter) {
            return this.threeTransformCenter.clone();
        }

        const center = this.getModelCenter();
        if (!center) {
            return null;
        }

        const THREE = window.THREE || globalThis.THREE;
        return new THREE.Vector3(center.x, center.y, center.z);
    }

    ensureThreeOrbitCenter() {
        const THREE = window.THREE || globalThis.THREE;
        if (!THREE) {
            return null;
        }

        if (!this.threeOrbitCenter) {
            const center = this.threeComputedModelCenter || this.getModelCenter();
            this.threeOrbitCenter = center
                ? new THREE.Vector3(center.x, center.y, center.z)
                : new THREE.Vector3(0, 0, 0);
        }

        return this.threeOrbitCenter;
    }

    getComputedModelCenterVector() {
        const THREE = window.THREE || globalThis.THREE;
        if (!THREE) {
            return null;
        }

        if (this.threeComputedModelCenter) {
            return this.threeComputedModelCenter.clone();
        }

        const center = this.getModelCenter();
        return center ? new THREE.Vector3(center.x, center.y, center.z) : null;
    }

    getComputedSelectionCenterVector() {
        const THREE = window.THREE || globalThis.THREE;
        if (!THREE) {
            return null;
        }

        if (this.threeComputedSelectionCenter) {
            return this.threeComputedSelectionCenter.clone();
        }

        if (this.threeTransformCenter) {
            return this.threeTransformCenter.clone();
        }

        return null;
    }

    getModelBasisQuaternion() {
        const THREE = window.THREE || globalThis.THREE;
        if (!THREE) {
            return null;
        }

        return this.threeModelQuaternion
            ? this.threeModelQuaternion.clone()
            : new THREE.Quaternion();
    }

    resolveCameraBasis() {
        const THREE = window.THREE || globalThis.THREE;
        if (!THREE) {
            return null;
        }

        const quaternion = this.threeCameraSpaceMode === "local"
            ? this.getModelBasisQuaternion()
            : new THREE.Quaternion();
        return {
            quaternion,
            right: new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion),
            up: new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
            forward: new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion),
        };
    }

    resolveTransformBasis() {
        const THREE = window.THREE || globalThis.THREE;
        if (!THREE) {
            return null;
        }

        const quaternion = this.threeTransformSpaceMode === "local"
            ? this.getModelBasisQuaternion()
            : new THREE.Quaternion();
        return {
            quaternion,
            right: new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion),
            up: new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
            forward: new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion),
        };
    }

    setThreeCameraSpaceMode(mode) {
        if (mode !== "world" && mode !== "local") {
            return false;
        }

        this.threeCameraSpaceMode = mode;
        this.updateCameraSpaceModeButton();
        this.update3DStatus();
        return true;
    }

    setThreeTransformSpaceMode(mode) {
        if (mode !== "world" && mode !== "local") {
            return false;
        }

        this.threeTransformSpaceMode = mode;
        this.updateTransformSpaceModeButton();
        this.updateTransformGizmo();
        this.update3DStatus();
        return true;
    }

    getThreeCameraAspect() {
        const width = Math.max(1, this.threeContainer?.clientWidth || this.threeRenderer?.domElement?.clientWidth || 1);
        const height = Math.max(1, this.threeContainer?.clientHeight || this.threeRenderer?.domElement?.clientHeight || 1);
        return width / height;
    }

    getThreeCameraFocusDistance(focusRadius = 25) {
        const radius = Math.max(focusRadius, 25);
        const aspect = this.getThreeCameraAspect();
        const verticalFov = DEFAULT_THREE_CAMERA_FOV * Math.PI / 180;
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
        return Math.max(
            radius * THREE_FOCUS_PADDING / Math.tan(verticalFov / 2),
            radius * THREE_FOCUS_PADDING / Math.tan(horizontalFov / 2),
            80
        );
    }

    getThreeOrthographicHalfHeight(radius = this.threeCameraState?.radius ?? DEFAULT_THREE_CAMERA_STATE.radius) {
        const safeRadius = Math.max(radius, 40);
        return Math.max(safeRadius * Math.tan((DEFAULT_THREE_CAMERA_FOV * Math.PI / 180) / 2), 25);
    }

    updateThreeCameraProjectionMatrix(radius = this.threeCameraState?.radius ?? DEFAULT_THREE_CAMERA_STATE.radius) {
        if (!this.threeCamera) {
            return;
        }

        const aspect = this.getThreeCameraAspect();
        if (this.threeCamera.isOrthographicCamera) {
            const halfHeight = this.getThreeOrthographicHalfHeight(radius);
            const halfWidth = halfHeight * aspect;
            this.threeCamera.left = -halfWidth;
            this.threeCamera.right = halfWidth;
            this.threeCamera.top = halfHeight;
            this.threeCamera.bottom = -halfHeight;
        } else {
            this.threeCamera.aspect = aspect;
            this.threeCamera.fov = DEFAULT_THREE_CAMERA_FOV;
        }

        this.threeCamera.updateProjectionMatrix();
    }

    createThreeCameraForProjection(mode = this.threeCameraProjectionMode) {
        const THREE = window.THREE || globalThis.THREE;
        if (!THREE) {
            return null;
        }

        const aspect = this.getThreeCameraAspect();
        if (mode === "orthographic") {
            const halfHeight = this.getThreeOrthographicHalfHeight();
            const halfWidth = halfHeight * aspect;
            return new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, -5000, 5000);
        }

        return new THREE.PerspectiveCamera(DEFAULT_THREE_CAMERA_FOV, aspect, 0.1, 10000);
    }

    setThreeCameraProjectionMode(mode) {
        if (mode !== "perspective" && mode !== "orthographic") {
            return false;
        }

        if (mode === this.threeCameraProjectionMode && this.threeCamera) {
            this.updateProjectionModeButton();
            this.updateThreeCameraProjectionMatrix(this.threeCameraState?.radius ?? DEFAULT_THREE_CAMERA_STATE.radius);
            this.update3DStatus();
            return true;
        }

        this.threeCameraProjectionMode = mode;
        this.updateProjectionModeButton();

        const THREE = window.THREE || globalThis.THREE;
        if (!THREE || !this.threeCamera) {
            this.update3DStatus();
            return true;
        }

        this.syncThreeCameraStateFromCamera();
        const orbitCenter = this.ensureThreeOrbitCenter() || new THREE.Vector3(0, 0, 0);
        const nextCamera = this.createThreeCameraForProjection(mode);
        if (!nextCamera) {
            return false;
        }

        nextCamera.position.copy(this.threeCamera.position);
        nextCamera.up.copy(this.threeCamera.up);
        this.threeCamera = nextCamera;
        this.updateThreeCameraProjectionMatrix(this.threeCameraState?.radius ?? DEFAULT_THREE_CAMERA_STATE.radius);
        this.threeCamera.lookAt(orbitCenter);
        this.applyThreeCameraState(this.threeCameraState, orbitCenter);
        this.schedulePoseDescriptionRefresh();
        this.update3DStatus();
        return true;
    }

    getViewPresetObjects() {
        const selectedObjects = this.get3DSelectedPointObjects();
        if (this.threeCameraPivotMode === "selection_center" && selectedObjects.length > 0) {
            return selectedObjects;
        }

        return this.getAll3DPointObjects();
    }

    apply3DViewPreset(presetName) {
        const THREE = window.THREE || globalThis.THREE;
        const preset = THREE_CAMERA_VIEW_PRESETS[presetName];
        if (!THREE || !this.threeCamera || !preset) {
            return false;
        }

        const targetObjects = this.getViewPresetObjects();
        if (targetObjects.length === 0) {
            return false;
        }

        const bounds = new THREE.Box3();
        targetObjects.forEach(obj => bounds.expandByPoint(obj.position));

        const size = bounds.getSize(new THREE.Vector3());
        const focusRadius = Math.max(size.length() * 0.5, 25);
        const distance = this.getThreeCameraFocusDistance(focusRadius);
        const orbitCenter = this.ensureThreeOrbitCenter() || bounds.getCenter(new THREE.Vector3());
        const basis = this.resolveCameraBasis();
        const direction = new THREE.Vector3(...preset.direction)
            .applyQuaternion(basis?.quaternion || new THREE.Quaternion())
            .normalize();

        this.threeOrbitCenter = orbitCenter.clone();
        this.threeCamera.position.copy(orbitCenter.clone().add(direction.multiplyScalar(distance)));
        this.alignThreeCameraUp();
        this.threeCamera.lookAt(orbitCenter);
        this.threeCameraState = {
            ...(this.threeCameraState || DEFAULT_THREE_CAMERA_STATE),
            radius: distance,
        };
        this.syncThreeCameraStateFromCamera();
        this.updateThreeCameraProjectionMatrix(this.threeCameraState.radius);
        this.schedulePoseDescriptionRefresh();
        this.update3DStatus();
        return true;
    }

    schedulePoseDescriptionRefresh({ immediate = false, delay = THREE_POSE_ANALYSIS_DEBOUNCE_MS } = {}) {
        if (!this.poseDescriptionText) {
            return;
        }

        if (!this.is3DMode || !this.threeCamera || !this.threePoseData) {
            this.poseDescriptionDirty = false;
            if (this.poseDescriptionTimer) {
                clearTimeout(this.poseDescriptionTimer);
                this.poseDescriptionTimer = null;
            }
            this.poseDescriptionText.innerText = "Available in 3D mode";
            return;
        }

        this.poseDescriptionDirty = true;

        if (this.poseDescriptionTimer) {
            clearTimeout(this.poseDescriptionTimer);
            this.poseDescriptionTimer = null;
        }

        if (immediate) {
            this.flushPoseDescriptionRefresh();
            return;
        }

        this.poseDescriptionTimer = setTimeout(() => {
            this.poseDescriptionTimer = null;
            this.flushPoseDescriptionRefresh();
        }, delay);
    }

    flushPoseDescriptionRefresh() {
        if (!this.poseDescriptionDirty) {
            return;
        }

        this.poseDescriptionDirty = false;
        this.analyzePoseAndGenerateDescription();
    }

    cancelPoseDescriptionRefresh() {
        this.poseDescriptionDirty = false;
        if (this.poseDescriptionTimer) {
            clearTimeout(this.poseDescriptionTimer);
            this.poseDescriptionTimer = null;
        }
    }

    start3DAnimationLoop() {
        if (this.threeAnimationFrameHandle) {
            return;
        }

        this.animate3D();
    }

    stop3DAnimationLoop() {
        if (this.threeAnimationFrameHandle) {
            cancelAnimationFrame(this.threeAnimationFrameHandle);
            this.threeAnimationFrameHandle = null;
        }
    }

    setCameraPivot(center, pivotMode = this.threeCameraPivotMode) {
        const THREE = window.THREE || globalThis.THREE;
        if (!THREE || !center) {
            return false;
        }

        this.threeOrbitCenter = center.clone ? center.clone() : new THREE.Vector3(center.x, center.y, center.z);
        this.threeCameraPivotMode = pivotMode;
        this.updatePivotModeButton();
        if (this.threeCamera) {
            this.alignThreeCameraUp();
            this.threeCamera.lookAt(this.threeOrbitCenter);
            this.syncThreeCameraStateFromCamera();
            this.schedulePoseDescriptionRefresh();
        }
        this.update3DStatus();
        return true;
    }

    alignThreeCameraUp() {
        if (!this.threeCamera) {
            return;
        }

        const basis = this.resolveCameraBasis();
        if (basis?.up) {
            this.threeCamera.up.copy(basis.up.clone().normalize());
        }
    }

    setCameraPivotFromModelCenter() {
        const center = this.getComputedModelCenterVector();
        return this.setCameraPivot(center, "model_center");
    }

    setCameraPivotFromSelectionCenter(fallbackToModel = false) {
        const selectionCenter = this.getComputedSelectionCenterVector();
        if (selectionCenter) {
            return this.setCameraPivot(selectionCenter, "selection_center");
        }
        if (fallbackToModel) {
            return this.setCameraPivotFromModelCenter();
        }
        return false;
    }

    syncThreeCameraStateFromCamera() {
        if (!this.threeCamera) {
            return;
        }

        const THREE = window.THREE || globalThis.THREE;
        const center = this.threeOrbitCenter || new THREE.Vector3(0, 0, 0);
        const offset = this.threeCamera.position.clone().sub(center);
        const radius = Math.max(offset.length(), 0.001);
        const phi = Math.acos(Math.max(-1, Math.min(1, offset.y / radius)));
        const theta = Math.atan2(offset.x, offset.z);

        this.threeCameraState = {
            theta,
            phi,
            radius,
        };
    }

    applyThreeCameraState(cameraState = this.threeCameraState, orbitCenter = this.threeOrbitCenter) {
        if (!this.threeCamera || !cameraState) {
            return;
        }

        const THREE = window.THREE || globalThis.THREE;
        const center = orbitCenter || new THREE.Vector3(0, 0, 0);
        const { theta, phi, radius } = cameraState;

        this.threeCamera.position.x = center.x + radius * Math.sin(phi) * Math.sin(theta);
        this.threeCamera.position.y = center.y + radius * Math.cos(phi);
        this.threeCamera.position.z = center.z + radius * Math.sin(phi) * Math.cos(theta);
        this.alignThreeCameraUp();
        this.threeCamera.lookAt(center);
        this.updateThreeCameraProjectionMatrix(radius);
        this.syncThreeCameraStateFromCamera();
        this.schedulePoseDescriptionRefresh();
    }

    orbitThreeCamera(deltaX, deltaY, orbitCenter = this.ensureThreeOrbitCenter()) {
        const THREE = window.THREE || globalThis.THREE;
        if (!THREE || !this.threeCamera || !orbitCenter) {
            return false;
        }

        const basis = this.resolveCameraBasis();
        const upAxis = basis?.up?.clone?.().normalize?.() || new THREE.Vector3(0, 1, 0);
        const offset = this.threeCamera.position.clone().sub(orbitCenter);
        if (offset.lengthSq() < 0.000001) {
            offset.set(0, 0, this.threeCameraState?.radius ?? DEFAULT_THREE_CAMERA_STATE.radius);
        }

        const yawAngle = -deltaX * THREE_CAMERA_ORBIT_SPEED;
        const pitchAngle = deltaY * THREE_CAMERA_ORBIT_SPEED;

        if (Math.abs(yawAngle) > 0.000001) {
            const yawQuaternion = new THREE.Quaternion().setFromAxisAngle(upAxis, yawAngle);
            offset.applyQuaternion(yawQuaternion);
        }

        if (Math.abs(pitchAngle) > 0.000001) {
            const rightAxis = new THREE.Vector3().crossVectors(upAxis, offset).normalize();
            if (rightAxis.lengthSq() > 0.000001) {
                const pitchQuaternion = new THREE.Quaternion().setFromAxisAngle(rightAxis, pitchAngle);
                const candidateOffset = offset.clone().applyQuaternion(pitchQuaternion);
                const candidateDirection = candidateOffset.clone().normalize();
                const dotToUp = candidateDirection.dot(upAxis);
                const clamp = Math.cos(THREE_CAMERA_PHI_EPSILON);

                if (Math.abs(dotToUp) < clamp) {
                    offset.copy(candidateOffset);
                }
            }
        }

        this.threeCamera.position.copy(orbitCenter.clone().add(offset));
        this.alignThreeCameraUp();
        this.threeCamera.lookAt(orbitCenter);
        this.syncThreeCameraStateFromCamera();
        this.schedulePoseDescriptionRefresh();
        return true;
    }

    captureCurrent3DViewState() {
        this.syncThreeCameraStateFromCamera();
        return {
            camera_state: { ...(this.threeCameraState || DEFAULT_THREE_CAMERA_STATE) },
            camera_position: this.threeCamera ? clonePlainVector(this.threeCamera.position) : { x: 0, y: 0, z: 500 },
            orbit_center: clonePlainVector(this.threeOrbitCenter),
            camera_space: this.threeCameraSpaceMode,
            camera_projection: this.threeCameraProjectionMode,
            model_rotation: clonePlainQuaternion(this.threeModelQuaternion),
        };
    }

    recordInitial3DViewState() {
        this.initial3DViewState = this.captureCurrent3DViewState();
        this.update3DStatus();
    }

    alignModelQuaternion(targetQuatPlain) {
        if (!this.threePoseData?.points?.length || !globalThis.THREE) {
            return;
        }

        const THREE = globalThis.THREE;
        const currentQuat = this.threeModelQuaternion ? this.threeModelQuaternion.clone() : new THREE.Quaternion();
        const targetQuat = new THREE.Quaternion(
            targetQuatPlain?.x ?? 0,
            targetQuatPlain?.y ?? 0,
            targetQuatPlain?.z ?? 0,
            targetQuatPlain?.w ?? 1
        );

        if (currentQuat.equals(targetQuat)) {
            return;
        }

        const modelCenter = this.getModelCenter();
        const center = modelCenter
            ? new THREE.Vector3(modelCenter.x, modelCenter.y, modelCenter.z)
            : new THREE.Vector3(0, 0, 0);
        const deltaQuat = targetQuat.clone().multiply(currentQuat.clone().invert());

        this.threePoseData.points.forEach(point => {
            const position = new THREE.Vector3(point.x, point.y, point.z);
            position.sub(center).applyQuaternion(deltaQuat).add(center);
            point.x = position.x;
            point.y = position.y;
            point.z = position.z;
        });

        if (!this.threeModelQuaternion) {
            this.threeModelQuaternion = new THREE.Quaternion();
        }
        this.threeModelQuaternion.copy(targetQuat);

        this.render3DPose();
    }

    reset3DView() {
        if (!this.initial3DViewState) {
            this.recordInitial3DViewState();
            return;
        }

        const THREE = globalThis.THREE;
        if (!THREE) {
            return;
        }

        this.alignModelQuaternion(this.initial3DViewState.model_rotation);
        this.threeOrbitCenter = new THREE.Vector3(
            this.initial3DViewState.orbit_center.x,
            this.initial3DViewState.orbit_center.y,
            this.initial3DViewState.orbit_center.z
        );
        this.setThreeCameraSpaceMode(this.initial3DViewState.camera_space || "world");
        this.setThreeCameraProjectionMode(this.initial3DViewState.camera_projection || DEFAULT_THREE_CAMERA_PROJECTION);
        this.applyThreeCameraState(
            { ...this.initial3DViewState.camera_state },
            this.threeOrbitCenter
        );
        this.updateTransformGizmo();
        this.update3DSelectionBox();
        this.update3DStatus();
    }

    updateRigModeButton() {
        if (this.rigModeButton) {
            this.rigModeButton.textContent = `Mode: ${this.threeRigMode.toUpperCase()}`;
        }
    }

    updateNavigationModeButton() {
        if (this.navigationModeButton) {
            this.navigationModeButton.textContent = this.threeCameraNavigationMode === "camera_orbit"
                ? "Nav: Orbit"
                : "Nav: Model";
        }
    }

    updateCameraSpaceModeButton() {
        if (this.cameraSpaceModeButton) {
            this.cameraSpaceModeButton.textContent = this.threeCameraSpaceMode === "local"
                ? "Cam: Local"
                : "Cam: World";
        }
    }

    updateTransformSpaceModeButton() {
        if (this.transformSpaceModeButton) {
            this.transformSpaceModeButton.textContent = this.threeTransformSpaceMode === "world"
                ? "Axes: World"
                : "Axes: Local";
        }
    }

    updatePivotModeButton() {
        if (this.pivotModeButton) {
            this.pivotModeButton.textContent = this.threeCameraPivotMode === "selection_center"
                ? "Pivot: Selection"
                : "Pivot: Model";
        }
    }

    updateProjectionModeButton() {
        if (this.projectionModeButton) {
            this.projectionModeButton.textContent = this.threeCameraProjectionMode === "orthographic"
                ? "Proj: Ortho"
                : "Proj: Persp";
        }
    }

    update3DStatus() {
        if (!this.statusTextEl) {
            return;
        }

        const selectedObjects = this.get3DSelectedPointObjects();
        const selectedLabel = selectedObjects.length === 1
            ? (JOINT_NAMES[selectedObjects[0].userData.id] || `Joint ${selectedObjects[0].userData.id}`)
            : `${selectedObjects.length} selected`;
        const selectionText = selectedObjects.length > 0 ? selectedLabel : "No selection";
        const navText = this.threeCameraNavigationMode === "camera_orbit" ? "Orbit" : "Model";
        const cameraSpaceText = this.threeCameraSpaceMode === "local" ? "Local" : "World";
        const axesText = this.threeTransformSpaceMode === "world" ? "World" : "Local";
        const pivotText = this.threeCameraPivotMode === "selection_center" ? "Selection" : "Model";
        const projectionText = this.threeCameraProjectionMode === "orthographic" ? "Ortho" : "Persp";
        this.statusTextEl.textContent = `Rig: ${this.threeRigMode.toUpperCase()} | Nav: ${navText} | Cam: ${cameraSpaceText} | Axes: ${axesText} | Pivot: ${pivotText} | Proj: ${projectionText} | ${selectionText}`;
    }

    focus3DObjects(objects) {
        const THREE = window.THREE || globalThis.THREE;
        const targetObjects = (objects || []).filter(obj => obj?.position);
        if (!THREE || !this.threeCamera || targetObjects.length === 0) {
            return false;
        }

        const bounds = new THREE.Box3();
        targetObjects.forEach(obj => bounds.expandByPoint(obj.position));

        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const radius = Math.max(size.length() * 0.5, 25);

        const orbitCenter = this.ensureThreeOrbitCenter() || center.clone();
        const viewDirection = this.threeCamera.position.clone().sub(orbitCenter);
        if (viewDirection.lengthSq() < 0.000001) {
            viewDirection.set(0, 0, 1);
        }
        viewDirection.normalize();

        const distance = this.getThreeCameraFocusDistance(radius);

        this.threeOrbitCenter = center.clone();
        this.threeCamera.position.copy(center.clone().add(viewDirection.multiplyScalar(distance)));
        this.alignThreeCameraUp();
        this.threeCamera.lookAt(this.threeOrbitCenter);
        this.syncThreeCameraStateFromCamera();
        this.updateThreeCameraProjectionMatrix(this.threeCameraState?.radius ?? distance);
        this.schedulePoseDescriptionRefresh();
        this.updateTransformGizmo();
        this.update3DSelectionBox();
        this.update3DStatus();
        return true;
    }

    focus3DSelection(fallbackToAll = false) {
        const selectedObjects = this.get3DSelectedPointObjects();
        if (selectedObjects.length > 0) {
            return this.focus3DObjects(selectedObjects);
        }
        if (fallbackToAll) {
            return this.focus3DAll();
        }
        return false;
    }

    focus3DAll() {
        return this.focus3DObjects(this.getAll3DPointObjects());
    }

    get3DCommandPoseIds() {
        if (!this.threePoseData?.points?.length) {
            return [];
        }

        const selectedPoseIds = new Set(
            this.get3DSelectedPointObjects()
                .map(obj => obj?.userData?.poseId)
                .filter(poseId => poseId != null)
        );
        if (selectedPoseIds.size > 0) {
            return [...selectedPoseIds];
        }

        return [...new Set(this.threePoseData.points.map(point => point.poseId))];
    }

    get3DModelLocalContext() {
        const THREE = window.THREE || globalThis.THREE;
        if (!THREE) {
            return null;
        }

        const modelCenter = this.getComputedModelCenterVector() || new THREE.Vector3(0, 0, 0);
        const modelQuaternion = this.getModelBasisQuaternion() || new THREE.Quaternion();
        const inverseQuaternion = modelQuaternion.clone().invert();
        return {
            modelCenter,
            modelQuaternion,
            inverseQuaternion,
        };
    }

    worldPointToModelLocal(position, context = this.get3DModelLocalContext()) {
        const THREE = window.THREE || globalThis.THREE;
        if (!THREE || !context || !position) {
            return null;
        }

        return position.clone()
            .sub(context.modelCenter)
            .applyQuaternion(context.inverseQuaternion)
            .add(context.modelCenter);
    }

    modelLocalPointToWorld(position, context = this.get3DModelLocalContext()) {
        const THREE = window.THREE || globalThis.THREE;
        if (!THREE || !context || !position) {
            return null;
        }

        return position.clone()
            .sub(context.modelCenter)
            .applyQuaternion(context.modelQuaternion)
            .add(context.modelCenter);
    }

    getOrCreate3DPosePoint(pointMap, poseId, jointId) {
        let point = pointMap.get(jointId);
        if (point) {
            return point;
        }

        point = {
            id: jointId,
            poseId,
            x: 0,
            y: 0,
            z: 0,
            color: connect_color[jointId] || [255, 255, 255],
        };
        this.threePoseData.points.push(point);
        pointMap.set(jointId, point);
        return point;
    }

    ensure3DPoseConnections() {
        if (!this.threePoseData) {
            return;
        }

        const pointMapByPose = new Map();
        this.threePoseData.points.forEach(point => {
            if (!pointMapByPose.has(point.poseId)) {
                pointMapByPose.set(point.poseId, new Set());
            }
            pointMapByPose.get(point.poseId).add(point.id);
        });

        const connectionKeys = new Set(
            this.threePoseData.connections.map(conn => `${conn.startId}_${conn.endId}_${conn.startPoseId}_${conn.endPoseId}`)
        );

        pointMapByPose.forEach((ids, poseId) => {
            connect_keypoints.forEach(([startId, endId]) => {
                if (!ids.has(startId) || !ids.has(endId)) {
                    return;
                }
                const key = `${startId}_${endId}_${poseId}_${poseId}`;
                if (connectionKeys.has(key)) {
                    return;
                }
                connectionKeys.add(key);
                this.threePoseData.connections.push({
                    startId,
                    endId,
                    startPoseId: poseId,
                    endPoseId: poseId,
                });
            });
        });
    }

    commit3DPoseCommand() {
        this.ensure3DPoseConnections();
        this.render3DPose();
        this.update3DStatus();
        this.schedulePoseDescriptionRefresh({ immediate: true });
    }

    mirror3DPose() {
        if (!this.threePoseData?.points?.length) {
            return false;
        }

        const THREE = window.THREE || globalThis.THREE;
        const context = this.get3DModelLocalContext();
        if (!THREE || !context) {
            return false;
        }

        const targetPoseIds = new Set(this.get3DCommandPoseIds());
        if (targetPoseIds.size === 0) {
            return false;
        }

        const pairJointIds = new Set(OPENPOSE_LEFT_RIGHT_PAIRS.flat());
        targetPoseIds.forEach(poseId => {
            const posePoints = this.threePoseData.points.filter(point => point.poseId === poseId);
            if (posePoints.length === 0) {
                return;
            }

            const pointMap = new Map(posePoints.map(point => [point.id, point]));
            const localSnapshot = new Map();
            posePoints.forEach(point => {
                const world = new THREE.Vector3(point.x, point.y, point.z);
                localSnapshot.set(point.id, this.worldPointToModelLocal(world, context));
            });

            const poseCenter = new THREE.Vector3();
            posePoints.forEach(point => poseCenter.add(localSnapshot.get(point.id)));
            poseCenter.multiplyScalar(1 / posePoints.length);

            const reflectLocalPoint = (localPoint) => new THREE.Vector3(
                (poseCenter.x * 2) - localPoint.x,
                localPoint.y,
                localPoint.z
            );

            OPENPOSE_LEFT_RIGHT_PAIRS.forEach(([leftId, rightId]) => {
                const leftLocal = localSnapshot.get(leftId);
                const rightLocal = localSnapshot.get(rightId);
                if (!leftLocal && !rightLocal) {
                    return;
                }

                if (rightLocal) {
                    const leftPoint = this.getOrCreate3DPosePoint(pointMap, poseId, leftId);
                    const mirrored = this.modelLocalPointToWorld(reflectLocalPoint(rightLocal), context);
                    leftPoint.x = mirrored.x;
                    leftPoint.y = mirrored.y;
                    leftPoint.z = mirrored.z;
                }

                if (leftLocal) {
                    const rightPoint = this.getOrCreate3DPosePoint(pointMap, poseId, rightId);
                    const mirrored = this.modelLocalPointToWorld(reflectLocalPoint(leftLocal), context);
                    rightPoint.x = mirrored.x;
                    rightPoint.y = mirrored.y;
                    rightPoint.z = mirrored.z;
                }
            });

            OPENPOSE_CENTERLINE_IDS.forEach(jointId => {
                const localPoint = localSnapshot.get(jointId);
                if (!localPoint) {
                    return;
                }
                const point = pointMap.get(jointId);
                const mirrored = this.modelLocalPointToWorld(reflectLocalPoint(localPoint), context);
                point.x = mirrored.x;
                point.y = mirrored.y;
                point.z = mirrored.z;
            });

            posePoints.forEach(point => {
                if (pairJointIds.has(point.id) || OPENPOSE_CENTERLINE_IDS.includes(point.id)) {
                    return;
                }
                const localPoint = localSnapshot.get(point.id);
                if (!localPoint) {
                    return;
                }
                const mirrored = this.modelLocalPointToWorld(reflectLocalPoint(localPoint), context);
                point.x = mirrored.x;
                point.y = mirrored.y;
                point.z = mirrored.z;
            });
        });

        this.commit3DPoseCommand();
        return true;
    }

    copy3DPoseSide(direction = "left_to_right") {
        if (!this.threePoseData?.points?.length) {
            return false;
        }

        const THREE = window.THREE || globalThis.THREE;
        const context = this.get3DModelLocalContext();
        if (!THREE || !context) {
            return false;
        }

        const targetPoseIds = new Set(this.get3DCommandPoseIds());
        if (targetPoseIds.size === 0) {
            return false;
        }

        const isLeftToRight = direction === "left_to_right";
        targetPoseIds.forEach(poseId => {
            const posePoints = this.threePoseData.points.filter(point => point.poseId === poseId);
            if (posePoints.length === 0) {
                return;
            }

            const pointMap = new Map(posePoints.map(point => [point.id, point]));
            const localSnapshot = new Map();
            posePoints.forEach(point => {
                const world = new THREE.Vector3(point.x, point.y, point.z);
                localSnapshot.set(point.id, this.worldPointToModelLocal(world, context));
            });

            const poseCenter = new THREE.Vector3();
            posePoints.forEach(point => poseCenter.add(localSnapshot.get(point.id)));
            poseCenter.multiplyScalar(1 / posePoints.length);

            const reflectLocalPoint = (localPoint) => new THREE.Vector3(
                (poseCenter.x * 2) - localPoint.x,
                localPoint.y,
                localPoint.z
            );

            OPENPOSE_LEFT_RIGHT_PAIRS.forEach(([leftId, rightId]) => {
                const sourceId = isLeftToRight ? leftId : rightId;
                const targetId = isLeftToRight ? rightId : leftId;
                const sourceLocal = localSnapshot.get(sourceId);
                if (!sourceLocal) {
                    return;
                }

                const targetPoint = this.getOrCreate3DPosePoint(pointMap, poseId, targetId);
                const mirrored = this.modelLocalPointToWorld(reflectLocalPoint(sourceLocal), context);
                targetPoint.x = mirrored.x;
                targetPoint.y = mirrored.y;
                targetPoint.z = mirrored.z;
            });
        });

        this.commit3DPoseCommand();
        return true;
    }

    promptForPoseFilename(defaultFilename) {
        if (!document?.body) {
            return Promise.resolve(window.prompt("Save pose JSON as", defaultFilename));
        }

        if (this.saveFilenameDialog?.isConnected) {
            this.saveFilenameDialog.remove();
            this.saveFilenameDialog = null;
        }

        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.55);";

            const dialog = document.createElement("div");
            dialog.style.cssText = "width: min(420px, calc(100vw - 32px)); background: #1f2329; color: #f1f3f5; border: 1px solid #3f4650; border-radius: 10px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35); padding: 16px; display: flex; flex-direction: column; gap: 12px;";

            const title = document.createElement("div");
            title.textContent = "Save Pose JSON";
            title.style.cssText = "font-size: 16px; font-weight: 600;";

            const hint = document.createElement("div");
            hint.textContent = "Enter a filename before saving. The .json extension will be added automatically.";
            hint.style.cssText = "font-size: 12px; color: #adb5bd; line-height: 1.5;";

            const input = document.createElement("input");
            input.type = "text";
            input.value = defaultFilename;
            input.placeholder = defaultFilename;
            input.style.cssText = "width: 100%; box-sizing: border-box; background: #111418; color: #f8f9fa; border: 1px solid #495057; border-radius: 6px; padding: 10px 12px; font-size: 13px;";

            const actions = document.createElement("div");
            actions.style.cssText = "display: flex; justify-content: flex-end; gap: 8px;";

            const cancelButton = document.createElement("button");
            cancelButton.type = "button";
            cancelButton.textContent = "Cancel";
            cancelButton.style.cssText = "background: transparent; color: #ced4da; border: 1px solid #495057; padding: 6px 12px; border-radius: 6px; cursor: pointer;";

            const confirmButton = document.createElement("button");
            confirmButton.type = "button";
            confirmButton.textContent = "Save";
            confirmButton.style.cssText = "background: #2f9e44; color: white; border: 1px solid #2b8a3e; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-weight: 600;";

            const cleanup = (value) => {
                document.removeEventListener("keydown", onKeyDown, true);
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
                if (this.saveFilenameDialog === overlay) {
                    this.saveFilenameDialog = null;
                }
                resolve(value);
            };

            const onKeyDown = (event) => {
                if (!overlay.isConnected) {
                    return;
                }
                if (event.key === "Escape") {
                    event.preventDefault();
                    cleanup(null);
                } else if (event.key === "Enter") {
                    event.preventDefault();
                    cleanup(input.value);
                }
            };

            cancelButton.onclick = () => cleanup(null);
            confirmButton.onclick = () => cleanup(input.value);
            overlay.addEventListener("mousedown", (event) => {
                if (event.target === overlay) {
                    cleanup(null);
                }
            });
            dialog.addEventListener("mousedown", (event) => event.stopPropagation());

            actions.appendChild(cancelButton);
            actions.appendChild(confirmButton);
            dialog.appendChild(title);
            dialog.appendChild(hint);
            dialog.appendChild(input);
            dialog.appendChild(actions);
            overlay.appendChild(dialog);

            this.saveFilenameDialog = overlay;
            document.body.appendChild(overlay);
            document.addEventListener("keydown", onKeyDown, true);

            input.focus();
            input.select();
        });
    }

    selectAll3D() {
        this.clear3DSelection();
        this.threeObjects?.forEach((obj, key) => {
            if (key.startsWith("point_")) {
                this.select3DObject(obj);
            }
        });
        this.updateTransformGizmo();
        this.update3DStatus();
    }

    getFKDescendantObjects(pivotObj) {
        if (!pivotObj?.userData?.pointData) {
            return [];
        }

        const poseId = pivotObj.userData.poseId;
        const descendants = [];
        const queue = [pivotObj.userData.id];
        const visited = new Set(queue);

        while (queue.length > 0) {
            const parentId = queue.shift();
            Object.entries(POSE_PARENT_MAP).forEach(([childId, mappedParentId]) => {
                const numericChildId = Number(childId);
                if (mappedParentId !== parentId || visited.has(numericChildId)) {
                    return;
                }

                visited.add(numericChildId);
                queue.push(numericChildId);

                const childObj = this.getThreePointObjectByIds(numericChildId, poseId);
                if (childObj) {
                    descendants.push(childObj);
                }
            });
        }

        return descendants;
    }

    rotate3DChainFromJoint(pivotObj, axisVector, angle) {
        const THREE = window.THREE || globalThis.THREE;
        if (!pivotObj || !axisVector || Math.abs(angle) < 0.0001 || !THREE) {
            return false;
        }

        const descendants = this.getFKDescendantObjects(pivotObj);
        if (descendants.length === 0) {
            return false;
        }

        const pivot = pivotObj.position.clone();
        const deltaQuaternion = new THREE.Quaternion().setFromAxisAngle(axisVector.clone().normalize(), angle);

        descendants.forEach(obj => {
            const relativePos = obj.position.clone().sub(pivot).applyQuaternion(deltaQuaternion);
            obj.position.copy(pivot.clone().add(relativePos));

            if (obj.userData.pointData) {
                obj.userData.pointData.x = obj.position.x;
                obj.userData.pointData.y = obj.position.y;
                obj.userData.pointData.z = obj.position.z;
            }
        });

        this.updateAll3DLines();
        this.updateTransformGizmo();
        this.update3DSelectionBox();
        this.update3DOrbitCenter();
        return true;
    }

    findIKChainForObject(obj) {
        const jointId = obj?.userData?.id;
        return jointId != null ? TWO_BONE_IK_CHAINS[jointId] || null : null;
    }

    findIKChainForMidObject(obj) {
        const jointId = obj?.userData?.id;
        if (jointId == null) {
            return null;
        }

        return Object.values(TWO_BONE_IK_CHAINS).find(chain => chain.mid === jointId) || null;
    }

    solveTwoBoneIKForTarget(obj, targetPosition) {
        const chain = this.findIKChainForObject(obj);
        const poseId = obj?.userData?.poseId;
        const THREE = window.THREE || globalThis.THREE;
        if (!chain || poseId == null || !targetPosition || !THREE) {
            return false;
        }

        const rootData = this.getThreePointDataByIds(chain.root, poseId);
        const midData = this.getThreePointDataByIds(chain.mid, poseId);
        const endData = this.getThreePointDataByIds(chain.end, poseId);
        const rootObj = this.getThreePointObjectByIds(chain.root, poseId);
        const midObj = this.getThreePointObjectByIds(chain.mid, poseId);
        const endObj = this.getThreePointObjectByIds(chain.end, poseId);

        if (!rootData || !midData || !endData || !rootObj || !midObj || !endObj) {
            return false;
        }

        const rootPos = rootObj.position.clone();
        const midPos = midObj.position.clone();
        const endPos = endObj.position.clone();

        const lengthA = rootPos.distanceTo(midPos);
        const lengthB = midPos.distanceTo(endPos);
        if (lengthA < 0.001 || lengthB < 0.001) {
            return false;
        }

        const rootToTarget = targetPosition.clone().sub(rootPos);
        if (rootToTarget.lengthSq() < 0.000001) {
            return false;
        }

        const direction = rootToTarget.clone().normalize();
        const minReach = Math.abs(lengthA - lengthB) + 0.001;
        const maxReach = lengthA + lengthB - 0.001;
        const clampedDistance = Math.max(minReach, Math.min(maxReach, rootToTarget.length()));
        const endTarget = rootPos.clone().addScaledVector(direction, clampedDistance);

        let planeNormal = midPos.clone().sub(rootPos).cross(endPos.clone().sub(midPos));
        if (planeNormal.lengthSq() < 0.000001) {
            planeNormal = new THREE.Vector3().crossVectors(direction, this.threeCamera?.getWorldDirection(new THREE.Vector3()) || new THREE.Vector3(0, 1, 0));
        }
        if (planeNormal.lengthSq() < 0.000001) {
            planeNormal = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));
        }
        planeNormal.normalize();

        let bendDirection = new THREE.Vector3().crossVectors(planeNormal, direction).normalize();
        const currentMidDirection = midPos.clone().sub(rootPos);
        if (currentMidDirection.dot(bendDirection) < 0) {
            bendDirection.multiplyScalar(-1);
        }

        const projectedLength = ((clampedDistance * clampedDistance) + (lengthA * lengthA) - (lengthB * lengthB)) / (2 * clampedDistance);
        const perpendicularLength = Math.sqrt(Math.max(0, (lengthA * lengthA) - (projectedLength * projectedLength)));
        const midTarget = rootPos
            .clone()
            .addScaledVector(direction, projectedLength)
            .addScaledVector(bendDirection, perpendicularLength);

        midObj.position.copy(midTarget);
        endObj.position.copy(endTarget);

        midData.x = midTarget.x;
        midData.y = midTarget.y;
        midData.z = midTarget.z;
        endData.x = endTarget.x;
        endData.y = endTarget.y;
        endData.z = endTarget.z;

        this.updateAll3DLines();
        this.update3DTransformCenter();
        this.updateTransformGizmo();
        this.update3DSelectionBox();
        this.update3DOrbitCenter();
        this.update3DStatus();
        return true;
    }

    solveTwoBoneIKForMidTarget(obj, targetPosition) {
        const chain = this.findIKChainForMidObject(obj);
        const poseId = obj?.userData?.poseId;
        const THREE = window.THREE || globalThis.THREE;
        if (!chain || poseId == null || !targetPosition || !THREE) {
            return false;
        }

        const rootData = this.getThreePointDataByIds(chain.root, poseId);
        const midData = this.getThreePointDataByIds(chain.mid, poseId);
        const endData = this.getThreePointDataByIds(chain.end, poseId);
        const rootObj = this.getThreePointObjectByIds(chain.root, poseId);
        const midObj = this.getThreePointObjectByIds(chain.mid, poseId);
        const endObj = this.getThreePointObjectByIds(chain.end, poseId);

        if (!rootData || !midData || !endData || !rootObj || !midObj || !endObj) {
            return false;
        }

        const rootPos = rootObj.position.clone();
        const midPos = midObj.position.clone();
        const endPos = endObj.position.clone();

        const lengthA = rootPos.distanceTo(midPos);
        const lengthB = midPos.distanceTo(endPos);
        if (lengthA < 0.001 || lengthB < 0.001) {
            return false;
        }

        let rootToMid = targetPosition.clone().sub(rootPos);
        if (rootToMid.lengthSq() < 0.000001) {
            rootToMid = midPos.clone().sub(rootPos);
        }
        if (rootToMid.lengthSq() < 0.000001) {
            rootToMid = new THREE.Vector3(1, 0, 0);
        }
        rootToMid.normalize();

        const newMid = rootPos.clone().addScaledVector(rootToMid, lengthA);
        let newEndDirection = endPos.clone().sub(newMid);
        if (newEndDirection.lengthSq() < 0.000001) {
            newEndDirection = endPos.clone().sub(midPos);
        }
        if (newEndDirection.lengthSq() < 0.000001) {
            newEndDirection = this.threeCamera?.getWorldDirection(new THREE.Vector3()) || new THREE.Vector3(0, 0, 1);
        }
        newEndDirection.normalize();

        const newEnd = newMid.clone().addScaledVector(newEndDirection, lengthB);

        midObj.position.copy(newMid);
        endObj.position.copy(newEnd);

        midData.x = newMid.x;
        midData.y = newMid.y;
        midData.z = newMid.z;
        endData.x = newEnd.x;
        endData.y = newEnd.y;
        endData.z = newEnd.z;

        this.updateAll3DLines();
        this.update3DTransformCenter();
        this.updateTransformGizmo();
        this.update3DSelectionBox();
        this.update3DOrbitCenter();
        this.update3DStatus();
        return true;
    }


    setPanelStyle() {
        this.panel.style.transform = `translate(-50%,-50%)`;
        this.panel.style.margin = `0px 0px`;

        this.panel.style.zIndex = "2147483647";
        this.panel.style.position = "fixed";
    }

    onKeyDown(e) {
        const targetTag = e.target?.tagName?.toLowerCase?.() || "";
        const isTypingTarget = ["input", "textarea", "select"].includes(targetTag) || !!e.target?.isContentEditable;
        if (isTypingTarget) {
            return;
        }

        const key = typeof e.key === "string" ? e.key.toLowerCase() : "";
        if (key === "z" && e.ctrlKey) {
            this.undo()
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        else if (key === "y" && e.ctrlKey) {
            this.redo()
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        else if (key === "a" && e.ctrlKey) {
            if (this.is3DMode) {
                this.selectAll3D();
            } else {
                const selectableCircles = this.canvas?.getObjects?.('circle')?.filter(obj => obj.selectable) || [];
                if (selectableCircles.length > 0) {
                    const selection = new fabric.ActiveSelection(selectableCircles, { canvas: this.canvas });
                    this.canvas.discardActiveObject();
                    this.canvas.setActiveObject(selection);
                    this.canvas.fire('selection:created', { target: selection });
                    this.canvas.renderAll();
                }
            }
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        else if ((e.key === "Delete" || e.key === "Backspace") && this.is3DMode) {
            this.delete3DSelectedPoints();
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        else if (e.key === "Escape") {
            if (this.is3DMode) {
                this.clear3DSelection();
            } else if (this.canvas) {
                this.canvas.discardActiveObject();
                this.canvas.renderAll();
            }
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        else if (this.is3DMode && key === "r") {
            this.reset3DView();
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        else if (this.is3DMode && e.shiftKey && e.code === "Period") {
            if (this.setCameraPivotFromSelectionCenter(true)) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }
        else if (this.is3DMode && e.shiftKey && key === "home") {
            if (this.setCameraPivotFromModelCenter()) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }
        else if (this.is3DMode && (key === "." || e.code === "NumpadDecimal")) {
            if (this.focus3DSelection(true)) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }
        else if (this.is3DMode && key === "home") {
            if (this.focus3DAll()) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }
        else if (this.is3DMode && key === "tab") {
            this.threeCameraNavigationMode = this.threeCameraNavigationMode === "camera_orbit"
                ? "model_rotate_legacy"
                : "camera_orbit";
            this.updateNavigationModeButton();
            this.update3DStatus();
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        else if (this.is3DMode && key === "f") {
            this.threeRigMode = "fk";
            this.updateRigModeButton();
            this.update3DStatus();
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        else if (this.is3DMode && key === "i") {
            this.threeRigMode = "ik";
            this.updateRigModeButton();
            this.update3DStatus();
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }

    getFusiformPoints(start, end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        let length = Math.sqrt(dx * dx + dy * dy);
        if (length === 0) length = 1;


        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;


        const nx = -dy / length;
        const ny = dx / length;



        const maxWidth = 14;

        const halfWidth = maxWidth / 2;


        return [
            { x: start.x, y: start.y },
            { x: midX + nx * halfWidth, y: midY + ny * halfWidth },
            { x: end.x, y: end.y },
            { x: midX - nx * halfWidth, y: midY - ny * halfWidth }
        ];
    }

    addPose(pose_keypoints_2d = []) {
        const poseId = this.nextPoseId;
        const circles = {};
        const lines = [];

        for (let i = 0; i < 18; i++) {
            const x = pose_keypoints_2d[i * 3];
            const y = pose_keypoints_2d[i * 3 + 1];
            const confidence = pose_keypoints_2d[i * 3 + 2];

            if (confidence === 0) {
                continue;
            }

            const circle = new fabric.Circle({
                left: x, top: y, radius: 5,
                fill: `rgb(${connect_color[i] ? connect_color[i].join(", ") : '255,255,255'})`,
                stroke: `rgb(${connect_color[i] ? connect_color[i].join(", ") : '255,255,255'})`,
                originX: 'center', originY: 'center',
                hasControls: false, hasBorders: false,
                _id: i,
                _poseId: poseId
            });
            circles[i] = circle;
        }

        connect_keypoints.forEach((pair, i) => {
            const startCircle = circles[pair[0]];
            const endCircle = circles[pair[1]];
            if (!startCircle || !endCircle) return;


            const points = this.getFusiformPoints(
                { x: startCircle.left, y: startCircle.top },
                { x: endCircle.left, y: endCircle.top }
            );


            const line = new fabric.Polygon(points, {
                fill: `rgba(${connect_color[pair[0]] ? connect_color[pair[0]].join(", ") : '255,255,255'}, 0.7)`,
                strokeWidth: 0,
                selectable: false,
                evented: false,
				lockMovementX: true,
				lockMovementY: true,
				lockRotation: true,
				lockScalingX: true,
				lockScalingY: true,
				lockSkewingX: true,
				lockSkewingY: true,

				hasControls: false,
				hasBorders: false,

                originX: 'center',
                originY: 'center',
                _startCircle: startCircle,
                _endCircle: endCircle,
                _poseId: poseId
            });

            lines.push(line);
        });

        this.nextPoseId++;
        this.canvas.add(...lines, ...Object.values(circles));


        this.saveOriginalPoints();


        return new Promise(resolve => {
            setTimeout(() => {


                this.canvas.requestRenderAll();
                resolve();
            }, 0);
        });
    }


    async setPose(people) {


        const tempBackgroundImage = this.canvas.backgroundImage;
        this.canvas.clear();
        this.canvas.backgroundImage = tempBackgroundImage;
        this.canvas.backgroundColor = "#000";
        this.nextPoseId = 0;

        const posePromises = people.map(person => this.addPose(person.pose_keypoints_2d || []));

        await Promise.all(posePromises);


		this.canvas.getObjects('polygon').forEach(line => {
			line.set({
				selectable: false,
				evented: false,
				lockMovementX: true,
				lockMovementY: true,
				lockRotation: true,
				lockScalingX: true,
				lockScalingY: true,
				lockSkewingX: true,
				lockSkewingY: true,
				hasControls: false,
				hasBorders: false
			});
		});

        this.canvas.getObjects().forEach(obj => obj.setCoords());
        this.canvas.renderAll();

    }

    calcResolution(width, height) {
        const viewportWidth = window.innerWidth / 2.25;
        const viewportHeight = window.innerHeight * 0.75;
        const ratio = Math.min(viewportWidth / width, viewportHeight / height);
        return { width: width * ratio, height: height * ratio }
    }

    resizeCanvas(width, height) {

        if (width != null && height != null) {
            this.canvasWidth = width;
            this.canvasHeight = height;

            this.widthInput.value = `${width}`
            this.heightInput.value = `${height}`

            this.canvas.setWidth(width);
            this.canvas.setHeight(height);
        }

        const rectPanel = this.canvasElem.closest('.openpose-container').getBoundingClientRect();

        if (rectPanel.width == 0 && rectPanel.height == 0) {
            setTimeout(() => {
                this.resizeCanvas();
            }, 100)
            return;
        }


        const availableWidth = rectPanel.width;
        const availableHeight = rectPanel.height;


        const padding = 20;
        const scaleX = (availableWidth - padding) / this.canvasWidth;
        const scaleY = (availableHeight - padding) / this.canvasHeight;


        const scale = Math.min(scaleX, scaleY);



        const wrapperEl = this.canvas.wrapperEl || this.canvasElem.parentElement;

        if (wrapperEl) {




            wrapperEl.style.position = "absolute";
            wrapperEl.style.left = "50%";
            wrapperEl.style.top = "50%";
            wrapperEl.style.width = `${this.canvasWidth}px`;
            wrapperEl.style.height = `${this.canvasHeight}px`;

            wrapperEl.style.transform = `translate(-50%, -50%) scale(${scale})`;
            wrapperEl.style.transformOrigin = "center center";


            this.canvasElem.style.width = "100%";
            this.canvasElem.style.height = "100%";

            if (this.canvas.upperCanvasEl) {
                this.canvas.upperCanvasEl.style.width = "100%";
                this.canvas.upperCanvasEl.style.height = "100%";
            }
        }

        if (this.node?.properties?.backgroundImage) {
            void applyFabricBackgroundToCanvas(this.canvas, this.node.properties.backgroundImage);
        }

        if (this.threeContainer && this.threeRenderer) {
            const threeRect = this.threeContainer.getBoundingClientRect();
            if (threeRect.width > 0 && threeRect.height > 0) {
                this.threeRenderer.setSize(threeRect.width, threeRect.height);
                if (this.threeCamera) {
                    this.updateThreeCameraProjectionMatrix(this.threeCameraState?.radius ?? DEFAULT_THREE_CAMERA_STATE.radius);
                }
                void this.syncThreeSceneBackgroundFromNode();
            }
        }
    }

    getBackgroundState(rawValue = this.node?.properties?.backgroundImage) {
        return parseBackgroundState(rawValue);
    }

    async applyBackgroundState(rawValueOrState, { syncNode = true, sync2D = true, sync3D = true } = {}) {
        const serialized = typeof rawValueOrState === "string"
            ? rawValueOrState
            : serializeBackgroundState(rawValueOrState);

        if (syncNode) {
            setNodeBackgroundProperty(this.node, serialized);
        }

        if (sync2D) {
            await applyFabricBackgroundToCanvas(this.canvas, serialized);
        }

        if (sync3D) {
            await this.syncThreeSceneBackground(serialized);
        }

        return serialized;
    }

    async clearBackgroundState({ syncNode = true } = {}) {
        return await this.applyBackgroundState("", { syncNode, sync2D: true, sync3D: true });
    }

    supportsSceneBackgroundTexture() {
        return !!(this.threeScene && globalThis.THREE && globalThis.THREE.CanvasTexture);
    }

    clearThreeBackgroundFallback() {
        if (this.threeContainer) {
            this.threeContainer.style.backgroundImage = "";
            this.threeContainer.style.backgroundSize = "";
            this.threeContainer.style.backgroundRepeat = "";
            this.threeContainer.style.backgroundPosition = "";
            this.threeContainer.style.backgroundColor = "";
            this.threeContainer.style.backgroundBlendMode = "";
        }
    }

    syncThreeBackgroundFallback(state) {
        if (!this.threeContainer) {
            return;
        }

        this.disposeThreeBackgroundTexture();
        if (this.threeScene) {
            this.threeScene.background = null;
        }
        if (this.threeRenderer) {
            this.threeRenderer.setClearColor(DEFAULT_THREE_SCENE_BACKGROUND, 0);
        }

        this.threeContainer.style.backgroundColor = "#000";
        this.threeContainer.style.backgroundBlendMode = "normal";
        this.threeContainer.style.backgroundImage = `url("${buildBackgroundViewUrl(state)}")`;
        this.threeContainer.style.backgroundSize = "contain";
        this.threeContainer.style.backgroundRepeat = "no-repeat";
        this.threeContainer.style.backgroundPosition = "center";
    }

    disposeThreeBackgroundTexture() {
        if (this.threeBackgroundTexture) {
            this.threeBackgroundTexture.dispose();
            this.threeBackgroundTexture = null;
        }
        this.threeBackgroundCanvas = null;
    }

    clearThreeSceneBackground() {
        this.threeBackgroundSyncToken += 1;
        this.disposeThreeBackgroundTexture();
        this.clearThreeBackgroundFallback();

        if (this.threeScene && globalThis.THREE) {
            this.threeScene.background = new globalThis.THREE.Color(DEFAULT_THREE_SCENE_BACKGROUND);
        }
        if (this.threeRenderer) {
            this.threeRenderer.setClearColor(DEFAULT_THREE_SCENE_BACKGROUND, 1);
        }
    }

    composeThreeBackgroundCanvas(image, width, height, opacity = DEFAULT_BACKGROUND_OPACITY) {
        if (!image || width <= 0 || height <= 0) {
            return null;
        }

        const canvas = this.threeBackgroundCanvas || document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return null;
        }

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);

        const scale = Math.min(width / image.width, height / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        const offsetX = (width - drawWidth) / 2;
        const offsetY = (height - drawHeight) / 2;

        ctx.save();
        ctx.globalAlpha = Number.isFinite(opacity) ? opacity : DEFAULT_BACKGROUND_OPACITY;
        ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
        ctx.restore();

        this.threeBackgroundCanvas = canvas;
        return canvas;
    }

    async syncThreeSceneBackground(rawValueOrState = this.node?.properties?.backgroundImage) {
        if (!this.threeScene) {
            return;
        }

        const state = typeof rawValueOrState === "string"
            ? parseBackgroundState(rawValueOrState)
            : normalizeBackgroundState(rawValueOrState);

        if (!state) {
            this.clearThreeSceneBackground();
            return;
        }

        if (!this.supportsSceneBackgroundTexture()) {
            this.syncThreeBackgroundFallback(state);
            return;
        }

        const targetWidth = Math.max(1, Math.round(this.threeContainer?.clientWidth || this.threeRenderer?.domElement?.width || this.canvasWidth || 1));
        const targetHeight = Math.max(1, Math.round(this.threeContainer?.clientHeight || this.threeRenderer?.domElement?.height || this.canvasHeight || 1));
        const syncToken = ++this.threeBackgroundSyncToken;
        const image = await loadImageAsync(buildBackgroundViewUrl(state));

        if (syncToken !== this.threeBackgroundSyncToken) {
            return;
        }

        if (!image) {
            this.clearThreeSceneBackground();
            return;
        }

        const composedCanvas = this.composeThreeBackgroundCanvas(image, targetWidth, targetHeight, state.opacity);
        if (!composedCanvas) {
            this.syncThreeBackgroundFallback(state);
            return;
        }

        this.disposeThreeBackgroundTexture();

        const THREE = globalThis.THREE;
        const texture = new THREE.CanvasTexture(composedCanvas);
        if ("colorSpace" in texture && THREE.SRGBColorSpace) {
            texture.colorSpace = THREE.SRGBColorSpace;
        } else if ("encoding" in texture && THREE.sRGBEncoding) {
            texture.encoding = THREE.sRGBEncoding;
        }
        texture.needsUpdate = true;

        this.threeBackgroundTexture = texture;
        this.threeBackgroundCanvas = composedCanvas;
        this.clearThreeBackgroundFallback();
        if (this.threeRenderer) {
            this.threeRenderer.setClearColor(DEFAULT_THREE_SCENE_BACKGROUND, 1);
        }
        this.threeScene.background = texture;
    }

    async syncThreeSceneBackgroundFromNode() {
        await this.syncThreeSceneBackground(this.node?.properties?.backgroundImage);
    }

    set2DCanvasInteractive(isInteractive) {
        const wrapperEl = this.canvasWrapperEl || this.canvas?.wrapperEl || this.canvasElem?.parentElement;
        if (wrapperEl) {
            wrapperEl.style.visibility = isInteractive ? "visible" : "hidden";
            wrapperEl.style.pointerEvents = isInteractive ? "auto" : "none";
        } else if (this.canvasElem) {
            this.canvasElem.style.visibility = isInteractive ? "visible" : "hidden";
            this.canvasElem.style.pointerEvents = isInteractive ? "auto" : "none";
        }

        if (this.canvas?.upperCanvasEl) {
            this.canvas.upperCanvasEl.style.pointerEvents = isInteractive ? "auto" : "none";
        }
        if (this.canvasElem) {
            this.canvasElem.style.pointerEvents = isInteractive ? "auto" : "none";
        }
    }

    undo() {
        if (this.undo_history.length > 0) {
            this.lockMode = true;
            if (this.undo_history.length > 1)
                this.redo_history.push(this.undo_history.pop());
            const content = this.undo_history[this.undo_history.length - 1];
            this.canvas.loadFromJSON(content, () => {
                this.canvas.renderAll();
                this.lockMode = false;
            });
        }
    }

    redo() {
        if (this.redo_history.length > 0) {
            this.lockMode = true;
            const content = this.redo_history.pop();
            this.undo_history.push(content);
            this.canvas.loadFromJSON(content, () => {
                this.canvas.renderAll();
                this.lockMode = false;
            });
        }
    }

    initCanvas(elem) {
        const canvas = new fabric.Canvas(elem, {
            backgroundColor: '#000',
            preserveObjectStacking: true,
            selection: true,
            fireRightClick: true,
            stopContextMenu: true
        });



        if (canvas.wrapperEl) {
            canvas.wrapperEl.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                return false;
            });
        }


        canvas.on('mouse:wheel', function(opt) {
            var delta = opt.e.deltaY;
            var zoom = canvas.getZoom();
            zoom *= 0.999 ** delta;
            if (zoom > 20) zoom = 20;
            if (zoom < 0.1) zoom = 0.1;



            const rect = canvas.getElement().getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {


                const x = (opt.e.clientX - rect.left) * (canvas.width / rect.width);
                const y = (opt.e.clientY - rect.top) * (canvas.height / rect.height);
                canvas.zoomToPoint({ x: x, y: y }, zoom);
            } else {
                 canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
            }

            opt.e.preventDefault();
            opt.e.stopPropagation();
        });



        const panel = this;


        canvas.on('mouse:down', function(opt) {
            var evt = opt.e;

            if (evt.button === 2 && !opt.target && !evt.altKey) {
                panel.isRotating = true;
                panel.lastMouseX = evt.clientX;
                panel.lastMouseY = evt.clientY;


                if (!panel.originalPoints) {
                    panel.saveOriginalPoints();
                }

                canvas.defaultCursor = 'move';
                canvas.setCursor('move');

                evt.preventDefault();
                evt.stopPropagation();
            }
        });

        canvas.on('mouse:move', function(opt) {
            if (panel.isRotating) {
                var e = opt.e;
                var deltaX = e.clientX - panel.lastMouseX;
                var deltaY = e.clientY - panel.lastMouseY;



                panel.rotationY -= deltaX * 0.5;
                panel.rotationX += deltaY * 0.5;




                panel.apply3DRotation();


                panel.saveToNode();

                panel.lastMouseX = e.clientX;
                panel.lastMouseY = e.clientY;

                e.preventDefault();
                e.stopPropagation();
            }
        });

        canvas.on('mouse:up', function(opt) {
            if (panel.isRotating) {
                panel.isRotating = false;
                canvas.defaultCursor = 'default';
                canvas.setCursor('default');
            }
        });


        canvas.on('mouse:dblclick', function(opt) {
            if (!opt.target) {
                panel.rotationX = 0;
                panel.rotationY = 0;
                panel.apply3DRotation();
            }
        });


        let isDragging = false;
        let lastPosX, lastPosY;
        let wasSelectionEnabled = true;

        canvas.on('mouse:down', function(opt) {
            var evt = opt.e;

            if (evt.altKey || evt.button === 1) {
                isDragging = true;
                wasSelectionEnabled = canvas.selection;
                canvas.selection = false;
                lastPosX = evt.clientX;
                lastPosY = evt.clientY;
                canvas.defaultCursor = 'grabbing';
                canvas.setCursor('grabbing');


                if (evt.preventDefault) evt.preventDefault();
                if (evt.stopPropagation) evt.stopPropagation();
            }
        });

        canvas.on('mouse:move', function(opt) {
            if (isDragging) {
                var e = opt.e;
                var vpt = canvas.viewportTransform;


                const rect = canvas.getElement().getBoundingClientRect();
                let scaleX = 1;
                let scaleY = 1;

                if (rect.width > 0 && rect.height > 0) {
                     scaleX = canvas.width / rect.width;
                     scaleY = canvas.height / rect.height;
                }

                vpt[4] += (e.clientX - lastPosX) * scaleX;
                vpt[5] += (e.clientY - lastPosY) * scaleY;

                canvas.requestRenderAll();
                lastPosX = e.clientX;
                lastPosY = e.clientY;
            }
        });

        canvas.on('mouse:up', function(opt) {


            if(isDragging) {
                canvas.setViewportTransform(canvas.viewportTransform);
                isDragging = false;
                canvas.selection = wasSelectionEnabled;
                canvas.defaultCursor = 'default';
                canvas.setCursor('default');
            }
        });


        const upperCanvasEl = canvas.upperCanvasEl;
        upperCanvasEl.addEventListener('contextmenu', function(e) {
            e.preventDefault();
        });


        upperCanvasEl.addEventListener('mousedown', function(e) {
            if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();


                isDragging = true;
                wasSelectionEnabled = canvas.selection;
                canvas.selection = false;
                lastPosX = e.clientX;
                lastPosY = e.clientY;
                canvas.defaultCursor = 'grabbing';
                canvas.setCursor('grabbing');

                return false;
            }
        });


        window.addEventListener('mouseup', function(e) {
            if (isDragging && e.button === 1) {
                canvas.setViewportTransform(canvas.viewportTransform);
                isDragging = false;
                canvas.selection = wasSelectionEnabled;
                canvas.defaultCursor = 'default';
                canvas.setCursor('default');
            }
        });

        const updateLines = (target) => {
            if (!target || target.type !== 'circle') return;

            canvas.getObjects('polygon').forEach(polygon => {
                if (polygon._startCircle === target || polygon._endCircle === target) {
                    const start = polygon._startCircle.getCenterPoint();
                    const end = polygon._endCircle.getCenterPoint();


                    const newPoints = this.getFusiformPoints(start, end);
                    polygon.set({ points: newPoints });

                    polygon.setCoords();
                }
            });
        };
        canvas.on('object:moving', (e) => updateLines(e.target));

        canvas.on('selection:created', (e) => {
            const selection = e.target;

            if (selection.type === 'activeSelection') {
                const selectableObjects = selection.getObjects().filter(obj => obj.selectable);

                if (selectableObjects.length < selection.size()) {
                    canvas.discardActiveObject();

                    if (selectableObjects.length > 1) {
                        const correctSelection = new fabric.ActiveSelection(selectableObjects, { canvas: canvas });
                        canvas.setActiveObject(correctSelection);
                    } else if (selectableObjects.length === 1) {
                        canvas.setActiveObject(selectableObjects[0]);
                    }
                }
            }
        });

        canvas.on("object:modified", async (e) => {
            if (this.lockMode || !e.target) return;

            const target = e.target;
            if (target.type === 'activeSelection') {
                const groupMatrix = target.calcTransformMatrix();
                target.forEachObject(obj => {
                    if (obj.type === 'circle') {
                        const point = new fabric.Point(obj.left, obj.top);
                        const finalPos = fabric.util.transformPoint(point, groupMatrix);
                        obj.set({
                            left: finalPos.x,
                            top: finalPos.y
                        });
                        obj.setCoords();
                    }
                });
            }

            const currentStateJson = this.serializeJSON();

            this.undo_history.push(currentStateJson);
            this.redo_history.length = 0;
            await this.loadJSON(currentStateJson);
        });

        return canvas;
    }




    saveOriginalPoints() {
        this.originalPoints = {};
        const circles = this.canvas.getObjects('circle');
        circles.forEach(circle => {
            this.originalPoints[circle._id + '_' + circle._poseId] = {
                x: circle.left,
                y: circle.top,
                z: 0
            };
        });
    }


    apply3DRotation() {
        if (!this.originalPoints) return;

        const radX = this.rotationX * Math.PI / 180;
        const radY = this.rotationY * Math.PI / 180;


        let totalX = 0, totalY = 0, count = 0;
        const circles = this.canvas.getObjects('circle');
        circles.forEach(circle => {
            const key = circle._id + '_' + circle._poseId;
            const orig = this.originalPoints[key];
            if (orig) {
                totalX += orig.x;
                totalY += orig.y;
                count++;
            }
        });


        const centerX = count > 0 ? totalX / count : this.canvas.width / 2;
        const centerY = count > 0 ? totalY / count : this.canvas.height / 2;


        circles.forEach(circle => {
            const key = circle._id + '_' + circle._poseId;
            const orig = this.originalPoints[key];

            if (orig) {

                let x = orig.x - centerX;
                let y = orig.y - centerY;
                let z = orig.z;


                const cosX = Math.cos(radX);
                const sinX = Math.sin(radX);
                const y1 = y * cosX - z * sinX;
                const z1 = y * sinX + z * cosX;
                y = y1;
                z = z1;


                const cosY = Math.cos(radY);
                const sinY = Math.sin(radY);
                const x1 = x * cosY + z * sinY;
                const z2 = -x * sinY + z * cosY;
                x = x1;
                z = z2;


                const perspective = 800;

                const clampedZ = Math.max(-400, Math.min(400, z));
                const scale = perspective / (perspective + clampedZ);


                const newX = centerX + x * scale;
                const newY = centerY + y * scale;


                const margin = 50;
                const clampedX = Math.max(margin, Math.min(this.canvas.width - margin, newX));
                const clampedY = Math.max(margin, Math.min(this.canvas.height - margin, newY));


                const minScale = 0.3;
                const finalScale = Math.max(minScale, scale);

                circle.set({
                    left: clampedX,
                    top: clampedY,
                    scaleX: finalScale,
                    scaleY: finalScale,
                    visible: true,
                    opacity: 1
                });
                circle.setCoords();
            }
        });


        this.updateAllLines();


        const activeObject = this.canvas.getActiveObject();
        if (activeObject && activeObject.type === 'activeSelection') {

            const selectedObjects = activeObject.getObjects();

            this.canvas.discardActiveObject();
            const newSelection = new fabric.ActiveSelection(selectedObjects, {
                canvas: this.canvas
            });
            this.canvas.setActiveObject(newSelection);
        }


        this.canvas.requestRenderAll();
    }


    updateAllLines() {
        const polygons = this.canvas.getObjects('polygon');
        polygons.forEach(polygon => {
            if (polygon._startCircle && polygon._endCircle) {
                const start = polygon._startCircle.getCenterPoint();
                const end = polygon._endCircle.getCenterPoint();
                const newPoints = this.getFusiformPoints(start, end);
                polygon.set({ points: newPoints });
                polygon.setCoords();
            }
        });
    }


    saveToNode() {
        this.flushPoseDescriptionRefresh();
        if (!this.is3DMode) {
            this.analyzePoseAndGenerateDescription();
        }


        let latestDescription = "";
        if (this.poseDescriptionText) {
            latestDescription = this.poseDescriptionText.innerText;
        }

        let newPoseJson;

        if (this.is3DMode && this.threePoseData) {

            newPoseJson = this.serialize3DJSON();
        } else {

            newPoseJson = this.serializeJSON();
        }


        try {
            const poseData = JSON.parse(newPoseJson);
            poseData.posture_description = latestDescription;
            newPoseJson = JSON.stringify(poseData);
        } catch (e) {
            console.error("[OpenPose] Failed to embed posture description:", e);
        }

        this.node.setProperty("poses_datas", newPoseJson);

        if (this.node.jsonWidget) {
            this.node.jsonWidget.value = newPoseJson;
        }


        const finalCheck = this.poseDescriptionText ? this.poseDescriptionText.innerText : latestDescription;
        if (finalCheck !== latestDescription) {

            try {
                const poseData = JSON.parse(newPoseJson);
                poseData.posture_description = finalCheck;
                newPoseJson = JSON.stringify(poseData);
                this.node.setProperty("poses_datas", newPoseJson);
                if (this.node.jsonWidget) {
                    this.node.jsonWidget.value = newPoseJson;
                }
            } catch (e) {}
        }

        this.uploadAndSetImages();
    }


    serialize3DJSON() {
        if (!this.threePoseData) return this.serializeJSON();

        const THREE = window.THREE;
        this.syncThreeCameraStateFromCamera();
        const people = [];


        const poses = new Map();
        this.threePoseData.points.forEach(point => {
            if (!poses.has(point.poseId)) {
                poses.set(point.poseId, []);
            }
            poses.get(point.poseId).push(point);
        });


        const camera = this.threeCamera;
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;

        poses.forEach((points, poseId) => {
            const keypoints_2d = new Array(18 * 3).fill(0);

            points.forEach(point => {

                const vector = new THREE.Vector3(point.x, point.y, point.z);


                vector.project(camera);


                const screenX = (vector.x + 1) / 2 * canvasWidth;
                const screenY = (-vector.y + 1) / 2 * canvasHeight;

                keypoints_2d[point.id * 3] = screenX;
                keypoints_2d[point.id * 3 + 1] = screenY;
                keypoints_2d[point.id * 3 + 2] = 1.0;
            });

            people.push({
                "pose_keypoints_2d": keypoints_2d
            });
        });



        const modelRotation = this.threeModelQuaternion ? {
            x: this.threeModelQuaternion.x,
            y: this.threeModelQuaternion.y,
            z: this.threeModelQuaternion.z,
            w: this.threeModelQuaternion.w
        } : { x: 0, y: 0, z: 0, w: 1 };


        const orbitCenter = this.threeOrbitCenter ? {
            x: this.threeOrbitCenter.x,
            y: this.threeOrbitCenter.y,
            z: this.threeOrbitCenter.z
        } : { x: 0, y: 0, z: 0 };


        let postureDesc = "";
        if (this.poseDescriptionText) {
            postureDesc = this.poseDescriptionText.innerText;
        }

        const result = {
            "width": this.canvas.width,
            "height": this.canvas.height,
            "people": people,
            "posture_description": postureDesc,
            "_3d_pose_data": {
                "points": this.threePoseData.points,
                "connections": this.threePoseData.connections,
                "camera_state": this.threeCameraState,
                "model_rotation": modelRotation,
                "orbit_center": orbitCenter,
                "camera_space": this.threeCameraSpaceMode,
                "camera_projection": this.threeCameraProjectionMode,
                "version": "1.4"
            }
        };

        return JSON.stringify(result, null, 4);
    }

    async captureCanvasClean() {


        if (this.is3DMode && this.threePoseData && this.threePoseData.points.length > 0) {
            this.sync3DTo2DCanvas();
        }


        this.lockMode = true;


        const originalViewportTransform = this.canvas.viewportTransform;

        this.canvas.viewportTransform = [1, 0, 0, 1, 0, 0];

        const backgroundImage = this.canvas.backgroundImage;


        const imageOpacities = new Map();

        try {
            if (backgroundImage) {
                backgroundImage.visible = false;
            }

            this.canvas.getObjects("image").forEach((img) => {
                imageOpacities.set(img, img.opacity);
                img.opacity = 0;
            });

            this.canvas.discardActiveObject();
            this.canvas.renderAll();

            const dataURL = this.canvas.toDataURL({
                multiplier: 1,
                format: 'png'
            });
            const blob = dataURLToBlob(dataURL);
            return blob;
        } catch (e) {
            throw e;
        } finally {
            if (backgroundImage) {
                backgroundImage.visible = true;
            }

            this.canvas.getObjects("image").forEach((img) => {
                if (imageOpacities.has(img)) {
                    img.opacity = imageOpacities.get(img);
                } else {
                    img.opacity = 1;
                }
            });


            this.canvas.viewportTransform = originalViewportTransform;
            this.canvas.renderAll();

            this.lockMode = false;
        }
    }


    sync3DTo2DCanvas() {
        if (!this.threePoseData || !this.threeCamera) return;

        const THREE = window.THREE;


        const backgroundImage = this.canvas.backgroundImage;


        const objectsToRemove = this.canvas.getObjects().filter(obj => obj !== backgroundImage);
        objectsToRemove.forEach(obj => this.canvas.remove(obj));


        const poses = new Map();
        this.threePoseData.points.forEach(point => {
            if (!poses.has(point.poseId)) {
                poses.set(point.poseId, []);
            }
            poses.get(point.poseId).push(point);
        });


        const camera = this.threeCamera;
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;


        poses.forEach((points, poseId) => {
            const circles = {};

            const pointDepths = {};


            points.forEach(point => {

                const vector = new THREE.Vector3(point.x, point.y, point.z);


                vector.project(camera);


                let screenX = (vector.x + 1) / 2 * canvasWidth;
                let screenY = (-vector.y + 1) / 2 * canvasHeight;


                screenX = Math.max(10, Math.min(canvasWidth - 10, screenX));
                screenY = Math.max(10, Math.min(canvasHeight - 10, screenY));

                const circle = new fabric.Circle({
                    left: screenX,
                    top: screenY,
                    radius: 5,
                    fill: `rgb(${point.color.join(',')})`,
                    originX: 'center',
                    originY: 'center',
                    hasControls: false,
                    hasBorders: false,
                    selectable: true,
                    _id: point.id,
                    _poseId: poseId
                });

                circles[point.id] = circle;

                pointDepths[point.id] = vector.z;
                this.canvas.add(circle);
            });


            const linesToAdd = [];
            this.threePoseData.connections.forEach(conn => {
                if (conn.startPoseId === poseId && conn.endPoseId === poseId) {
                    const startCircle = circles[conn.startId];
                    const endCircle = circles[conn.endId];

                    if (startCircle && endCircle) {
                        const start = startCircle.getCenterPoint();
                        const end = endCircle.getCenterPoint();
                        const points = this.getFusiformPoints(start, end);

                        const polygon = new fabric.Polygon(points, {
                            fill: `rgb(${startCircle.fill.replace(/[^0-9,]/g, '').split(',').map(Number).join(',')})`,
                            stroke: `rgb(${startCircle.fill.replace(/[^0-9,]/g, '').split(',').map(Number).join(',')})`,
                            strokeWidth: 1,
                            selectable: false,
                            evented: false,
                            _startCircle: startCircle,
                            _endCircle: endCircle,
                            _poseId: poseId
                        });


                        const avgDepth = (pointDepths[conn.startId] + pointDepths[conn.endId]) / 2;
                        linesToAdd.push({ polygon, depth: avgDepth });
                    }
                }
            });




            linesToAdd.sort((a, b) => b.depth - a.depth);


            linesToAdd.forEach(({ polygon }) => {
                this.canvas.add(polygon);
            });
        });

        this.canvas.renderAll();
    }


    capture3DCanvas() {
        if (!this.threeRenderer || !this.threeScene || !this.threeCamera) {
            return null;
        }


        this.threeRenderer.render(this.threeScene, this.threeCamera);


        const dataURL = this.threeRenderer.domElement.toDataURL('image/png');
        const blob = dataURLToBlob(dataURL);
        return blob;
    }

    async captureCanvasCombined() {
        this.lockMode = true;


        const originalViewportTransform = this.canvas.viewportTransform;

        this.canvas.viewportTransform = [1, 0, 0, 1, 0, 0];

        const backgroundImage = this.canvas.backgroundImage;
        let originalOpacity = 1.0;

        try {
            if (backgroundImage) {
                originalOpacity = backgroundImage.opacity;
                backgroundImage.opacity = 1.0;
            }

            this.canvas.discardActiveObject();
            this.canvas.renderAll();

            const dataURL = this.canvas.toDataURL({
                multiplier: 1,
                format: 'png'
            });
            const blob = dataURLToBlob(dataURL);
            return blob;
        } catch (e) {
            throw e;
        } finally {
            if (backgroundImage) {
                backgroundImage.opacity = originalOpacity;
            }


            this.canvas.viewportTransform = originalViewportTransform;
            this.canvas.renderAll();

            this.lockMode = false;
        }
    }


    async uploadAndSetImages() {
        try {
            const cleanBlob = await this.captureCanvasClean();
            if (!cleanBlob || cleanBlob.size === 0) {
                return;
            }

            const cleanFilename = `ComfyUI_OpenPose_${this.node.id}.png`;

            const bodyClean = new FormData();
            bodyClean.append("image", cleanBlob, cleanFilename);
            bodyClean.append("overwrite", "true");

            const respClean = await fetch("/upload/image", { method: "POST", body: bodyClean });
            if (respClean.status !== 200) {
                throw new Error(`Failed to upload clean pose image: ${respClean.statusText}`);
            }
            const dataClean = await respClean.json();
            await this.node.setImage(dataClean.name);

            if (this.canvas.backgroundImage) {
                const combinedBlob = await this.captureCanvasCombined();
                const combinedFilename = `ComfyUI_OpenPose_${this.node.id}_combined.png`;

                const bodyCombined = new FormData();
                bodyCombined.append("image", combinedBlob, combinedFilename);
                bodyCombined.append("overwrite", "true");

                const respCombined = await fetch("/upload/image", { method: "POST", body: bodyCombined });
            }

        } catch (error) {
            alert(error);
        }
    }


    resetCanvas() {
        this.canvas.clear();
        this.canvas.setBackgroundImage(null, this.canvas.renderAll.bind(this.canvas));
        this.canvas.backgroundColor = "#000";
        this.nextPoseId = 0;

        this.rotationX = 0;
        this.rotationY = 0;
        this.originalPoints = null;
    }

    load() {
        this.fileInput.value = null;
        this.fileInput.click();
    }

    async onLoad(e) {
        const file = this.fileInput.files[0];
        if (!file) {
            return;
        }
        const text = await readFileToText(file);
        const error = await this.loadJSON(text);
        if (error != null) {
            app.ui.dialog.show(error);
        }
        else {
            this.initialPoseData = text;
            this.recordInitial3DViewState();
            this.saveToNode();
        }
    }

    serializeJSON() {

        const originalViewportTransform = this.canvas.viewportTransform;



        this.canvas.viewportTransform = [1, 0, 0, 1, 0, 0];










        const allCircles = this.canvas.getObjects('circle');
        const poses = {};
        allCircles.forEach(circle => {
            const poseId = circle._poseId;
            if (!poses[poseId]) {
                poses[poseId] = [];
            }
            poses[poseId].push(circle);
        });

        const people = [];
        Object.keys(poses).sort((a, b) => a - b).forEach(poseId => {
            const poseCircles = poses[poseId];

            const keypoints_2d = new Array(18 * 3).fill(0);

            poseCircles.forEach(circle => {
                const pointId = circle._id;

                const center = circle.getCenterPoint();
                keypoints_2d[pointId * 3] = center.x;
                keypoints_2d[pointId * 3 + 1] = center.y;
                keypoints_2d[pointId * 3 + 2] = 1.0;
            });

            people.push({
                "pose_keypoints_2d": keypoints_2d
            });
        });


        let postureDesc = "";
        if (this.poseDescriptionText) {
            postureDesc = this.poseDescriptionText.innerText;
        }

        const json = JSON.stringify({
            "width": this.canvas.width,
            "height": this.canvas.height,
            "people": people,
            "posture_description": postureDesc
        }, null, 4);


        this.canvas.viewportTransform = originalViewportTransform;

        return json;
    }

    async loadBackgroundImage(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const body = new FormData();
            body.append("image", file);
            body.append("overwrite", "true");

            const resp = await fetch("/upload/image", { method: "POST", body: body });
            if (resp.status !== 200) {
                throw new Error(`Failed to upload background image: ${resp.statusText}`);
            }
            const data = await resp.json();
            const backgroundState = normalizeBackgroundState({
                filename: data.name,
                subfolder: data.subfolder || "",
                type: data.type || DEFAULT_BACKGROUND_TYPE,
                opacity: DEFAULT_BACKGROUND_OPACITY,
            });

            await this.applyBackgroundState(backgroundState);
            this.uploadAndSetImages();

        } catch (error) {
            alert(error);
        } finally {
            e.target.value = '';
        }
    }

    async save() {
        const json = this.is3DMode && this.threePoseData ? this.serialize3DJSON() : this.serializeJSON();
        const blob = new Blob([json], {
            type: "application/json"
        });
        const defaultFilename = "pose-" + Date.now().toString() + ".json";
        const requestedName = await this.promptForPoseFilename(defaultFilename);
        if (requestedName === null) {
            return;
        }
        const filename = sanitizePoseFilename(requestedName, defaultFilename);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    async loadJSON(text) {
        try {

            const json = JSON.parse(text);

            const canvasWidth = Number(json["width"] ?? json["canvas_width"]);
            const canvasHeight = Number(json["height"] ?? json["canvas_height"]);
            if (!Number.isFinite(canvasWidth) || canvasWidth <= 0 || !Number.isFinite(canvasHeight) || canvasHeight <= 0) {
                return 'JSON is missing valid width/height or canvas_width/canvas_height properties.';
            }
            this.resizeCanvas(canvasWidth, canvasHeight);

            const people = json["people"] || [];

            let allKeypointsForCheck = [];
            people.forEach(person => {
                const keypoints_2d = person.pose_keypoints_2d || [];
                for (let i = 0; i < keypoints_2d.length; i += 3) {
                    if (keypoints_2d[i + 2] > 0) {
                        allKeypointsForCheck.push([keypoints_2d[i], keypoints_2d[i + 1]]);
                    }
                }
            });

            if (allKeypointsForCheck.length > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                allKeypointsForCheck.forEach(pt => {
                    if (pt[0] < minX) minX = pt[0];
                    if (pt[0] > maxX) maxX = pt[0];
                    if (pt[1] < minY) minY = pt[1];
                    if (pt[1] > maxY) maxY = pt[1];
                });

                const canvasWidth = this.canvas.getWidth();
                const canvasHeight = this.canvas.getHeight();
                let offsetX = 0, offsetY = 0;

                if (maxX < 0 || minX > canvasWidth || maxY < 0 || minY > canvasHeight) {
                    const poseWidth = maxX - minX;
                    const poseHeight = maxY - minY;
                    offsetX = -minX + (canvasWidth - poseWidth) / 2;
                    offsetY = -minY + (canvasHeight - poseHeight) / 2;

                    people.forEach(person => {
                        const keypoints_2d = person.pose_keypoints_2d || [];
                        for (let i = 0; i < keypoints_2d.length; i += 3) {
                            if (keypoints_2d[i + 2] > 0) {
                                keypoints_2d[i] += offsetX;
                                keypoints_2d[i + 1] += offsetY;
                            }
                        }
                    });
                }
            }

            await this.setPose(people);


            if (json["_3d_pose_data"] && json["_3d_pose_data"].points) {
                await ensureThreeJsLoaded();
                const THREE = globalThis.THREE;
                console.log('[OpenPose] Restoring 3D data from JSON:', json["_3d_pose_data"].points.length, 'points');
                this.threePoseData = {
                    points: json["_3d_pose_data"].points,
                    connections: json["_3d_pose_data"].connections || []
                };

                if (json["_3d_pose_data"].camera_state) {
                    this.threeCameraState = json["_3d_pose_data"].camera_state;
                    console.log('[OpenPose] Restored camera state:', this.threeCameraState);
                }

                if (json["_3d_pose_data"].camera_space) {
                    this.threeCameraSpaceMode = json["_3d_pose_data"].camera_space === "local"
                        ? "local"
                        : "world";
                } else {
                    this.threeCameraSpaceMode = "world";
                }

                if (json["_3d_pose_data"].camera_projection) {
                    this.threeCameraProjectionMode = json["_3d_pose_data"].camera_projection === "orthographic"
                        ? "orthographic"
                        : DEFAULT_THREE_CAMERA_PROJECTION;
                } else {
                    this.threeCameraProjectionMode = DEFAULT_THREE_CAMERA_PROJECTION;
                }

                if (json["_3d_pose_data"].model_rotation) {
                    const rot = json["_3d_pose_data"].model_rotation;
                    if (!this.threeModelQuaternion) {
                        this.threeModelQuaternion = new THREE.Quaternion();
                    }
                    this.threeModelQuaternion.set(rot.x, rot.y, rot.z, rot.w);
                    console.log('[OpenPose] Restored model rotation:', rot);
                }

                if (json["_3d_pose_data"].orbit_center) {
                    const oc = json["_3d_pose_data"].orbit_center;
                    this.threeOrbitCenter = new THREE.Vector3(oc.x, oc.y, oc.z);
                    console.log('[OpenPose] Restored orbit center:', oc);
                }
            } else {
                this.threePoseData = null;
                this.threeCameraState = { ...DEFAULT_THREE_CAMERA_STATE };
                this.threeCameraSpaceMode = "world";
                this.threeCameraProjectionMode = DEFAULT_THREE_CAMERA_PROJECTION;
                if (globalThis.THREE) {
                    this.threeModelQuaternion = new globalThis.THREE.Quaternion();
                    this.threeOrbitCenter = new globalThis.THREE.Vector3(0, 0, 0);
                } else {
                    this.threeModelQuaternion = null;
                    this.threeOrbitCenter = null;
                }
            }

            this.updateCameraSpaceModeButton();
            this.updateTransformSpaceModeButton();
            this.updateProjectionModeButton();


            this.rotationX = 0;
            this.rotationY = 0;
            this.originalPoints = null;

            if (this.poseFilterInput) {
                const currentFilterIndex = parseInt(this.poseFilterInput.value, 10);
                if (!isNaN(currentFilterIndex)) {
                    this.applyPoseFilter(currentFilterIndex);
                }
            }

            if (this.is3DMode && this.threeRenderer) {
                if (!this.threePoseData || !this.threePoseData.points?.length) {
                    this.init3DPoseData();
                }

                if (!this.threeOrbitCenter && globalThis.THREE) {
                    this.threeOrbitCenter = new globalThis.THREE.Vector3(0, 0, 0);
                }

                this.setThreeCameraSpaceMode(this.threeCameraSpaceMode || "world");
                this.setThreeCameraProjectionMode(this.threeCameraProjectionMode || DEFAULT_THREE_CAMERA_PROJECTION);
                if (this.threeCamera && this.threeCameraState) {
                    this.applyThreeCameraState(this.threeCameraState, this.threeOrbitCenter);
                }

                this.render3DPose();
            }

            if (json["_3d_pose_data"]) {
                this.recordInitial3DViewState();
            } else if (this.is3DMode) {
                this.recordInitial3DViewState();
            }

            return null;
        } catch (e) {
            return `Failed to parse JSON: ${e.message}`;
        }
    }




    toggle3DMode() {
        this.is3DMode = !this.is3DMode;

        if (this.mode3DButton) {
            this.mode3DButton.textContent = this.is3DMode ? "3D Mode: On" : "3D Mode: Off";
        }

        if (this.is3DMode) {
            void this.enter3DMode();
        } else {
            this.exit3DMode();

            if (this.poseDescriptionText) {
                this.poseDescriptionText.innerText = "Available in 3D mode";
            }
        }
    }


    toggleGizmoVisibility() {
        this.showGizmo = !this.showGizmo;

        if (this.showGizmoButton) {
            this.showGizmoButton.textContent = this.showGizmo ? "Gizmo: On" : "Gizmo: Off";
        }


        if (this.threeTransformGizmo) {
            this.threeTransformGizmo.visible = this.showGizmo;
        }


        if (this.threeSelectionBox) {
            this.threeSelectionBox.visible = true;
        }


        if (this.is3DMode && this.threeRenderer) {
            this.render3DPose();
        }
    }


    enable3DModeByDefault() {
        this.is3DMode = true;
        if (this.mode3DButton) {
            this.mode3DButton.textContent = "3D Mode: On";
        }
        void this.enter3DMode();
    }


    async enter3DMode() {
        try {
            await ensureThreeJsLoaded();
        } catch (error) {
            console.error("[OpenPose3D] Failed to load Three.js", error);
            this.is3DMode = false;
            if (this.mode3DButton) {
                this.mode3DButton.textContent = "3D Mode: Off";
            }
            alert("Required 3D resources failed to load. Please refresh the page and try again.");
            return;
        }

        if (!this.is3DMode) {
            return;
        }

        const THREE = globalThis.THREE;
        this.set2DCanvasInteractive(false);

        if (!this.threeContainer) {
            this.threeContainer = document.createElement('div');
            this.threeContainer.style.cssText = 'position: absolute; inset: 0; z-index: 5; pointer-events: auto; overflow: hidden;';
            (this.canvasHostElem || this.canvasElem.parentNode).appendChild(this.threeContainer);
        } else if (this.threeContainer.parentNode !== (this.canvasHostElem || this.canvasElem.parentNode)) {
            (this.canvasHostElem || this.canvasElem.parentNode).appendChild(this.threeContainer);
        }
        this.threeContainer.style.display = 'block';


        if (!this.threeRenderer) {
            this.initThreeJS();
        }

        await this.syncThreeSceneBackgroundFromNode();



        let restoredFromJSON = false;

        if (!this.threePoseData || this.threePoseData.points.length === 0) {

            const poseDataStr = this.node.properties.poses_datas;

            if (poseDataStr && typeof poseDataStr === 'string') {
                try {
                    const poseData = JSON.parse(poseDataStr);
                    if (poseData["_3d_pose_data"] && poseData["_3d_pose_data"].points && poseData["_3d_pose_data"].points.length > 0) {
                        console.log('[OpenPose] Restored 3D pose from JSON with', poseData["_3d_pose_data"].points.length, 'points');
                        this.threePoseData = {
                            points: poseData["_3d_pose_data"].points,
                            connections: poseData["_3d_pose_data"].connections || []
                        };
                        restoredFromJSON = true;
                    }
                } catch (e) {
                    console.log('[OpenPose] Failed to parse 3D data from JSON:', e);
                }
            }


            if (!restoredFromJSON) {
                console.log('[OpenPose] No saved 3D data, initializing from 2D canvas');
                this.init3DPoseData();


                if (!this.threePoseData || this.threePoseData.points.length === 0) {
                    console.log('[OpenPose] No 2D data either, creating default pose');
                    this.threePoseData = { points: [], connections: [] };
                    this.add3DPose();
                }
            }
        }


        const poseDataStr = this.node.properties.poses_datas;
        let restoredCameraSpaceMode = null;
        let restoredProjectionMode = null;
        if (poseDataStr && typeof poseDataStr === 'string') {
            try {
                const poseData = JSON.parse(poseDataStr);
                if (poseData["_3d_pose_data"]) {

                    if (poseData["_3d_pose_data"].camera_state) {
                        this.threeCameraState = poseData["_3d_pose_data"].camera_state;
                        console.log('[OpenPose] Restored camera state:', this.threeCameraState);
                    }

                    if (poseData["_3d_pose_data"].model_rotation) {
                        const rot = poseData["_3d_pose_data"].model_rotation;
                        if (!this.threeModelQuaternion) {
                            this.threeModelQuaternion = new THREE.Quaternion();
                        }
                        this.threeModelQuaternion.set(rot.x, rot.y, rot.z, rot.w);
                        console.log('[OpenPose] Restored model rotation from JSON:', rot);
                    }

                    if (poseData["_3d_pose_data"].orbit_center) {
                        const oc = poseData["_3d_pose_data"].orbit_center;
                        const THREE = window.THREE;
                        this.threeOrbitCenter = new THREE.Vector3(oc.x, oc.y, oc.z);
                        console.log('[OpenPose] Restored orbit center from JSON:', oc);
                    }

                    if (poseData["_3d_pose_data"].camera_space) {
                        restoredCameraSpaceMode = poseData["_3d_pose_data"].camera_space === "local"
                            ? "local"
                            : "world";
                    }

                    if (poseData["_3d_pose_data"].camera_projection) {
                        restoredProjectionMode = poseData["_3d_pose_data"].camera_projection === "orthographic"
                            ? "orthographic"
                            : DEFAULT_THREE_CAMERA_PROJECTION;
                    }
                }
            } catch (e) {
                console.log('[OpenPose] Failed to restore 3D state from JSON:', e);
            }
        }

        this.setThreeCameraSpaceMode(restoredCameraSpaceMode || this.threeCameraSpaceMode || "world");
        this.setThreeCameraProjectionMode(restoredProjectionMode || this.threeCameraProjectionMode || DEFAULT_THREE_CAMERA_PROJECTION);

        if (this.threeCamera && this.threeCameraState) {
            const center = this.threeOrbitCenter || new THREE.Vector3(0, 0, 0);
            this.applyThreeCameraState(this.threeCameraState, center);
            console.log('[OpenPose] Applied camera state:', this.threeCameraState);
        }


        this.render3DPose();


        this.start3DAnimationLoop();
        if (!this.initial3DViewState) {
            this.recordInitial3DViewState();
        } else {
            this.update3DStatus();
        }
    }


    init3DPoseData() {
        const circles = this.canvas.getObjects('circle');
        const polygons = this.canvas.getObjects('polygon');

        this.threePoseData = {
            points: [],
            connections: []
        };


        circles.forEach(circle => {
            this.threePoseData.points.push({
                id: circle._id,
                poseId: circle._poseId,
                x: circle.left - this.canvas.width / 2,
                y: -(circle.top - this.canvas.height / 2),
                z: 0,
                color: connect_color[circle._id] || [255, 255, 255]
            });
        });


        polygons.forEach(polygon => {
            if (polygon._startCircle && polygon._endCircle) {
                this.threePoseData.connections.push({
                    startId: polygon._startCircle._id,
                    endId: polygon._endCircle._id,
                    startPoseId: polygon._startCircle._poseId,
                    endPoseId: polygon._endCircle._poseId
                });
            }
        });
    }


    exit3DMode() {
        this.stop3DAnimationLoop();
        this.cancelPoseDescriptionRefresh();
        this.set2DCanvasInteractive(true);
        if (this.threeContainer) {
            this.threeContainer.style.display = 'none';
        }


        if (this.threePoseData && this.threePoseData.points.length > 0) {
            this.sync3DTo2DCanvas();
        }





        this.canvas.requestRenderAll();
    }


    initThreeJS() {
        if (!window.THREE) {
            console.error('Three.js not loaded');
            return;
        }

        const THREE = window.THREE;


        this.threeScene = new THREE.Scene();
        this.threeScene.background = new THREE.Color(DEFAULT_THREE_SCENE_BACKGROUND);


        const width = this.threeContainer.clientWidth;
        const height = this.threeContainer.clientHeight;
        this.threeCamera = this.createThreeCameraForProjection(this.threeCameraProjectionMode) || new THREE.PerspectiveCamera(DEFAULT_THREE_CAMERA_FOV, width / height, 0.1, 10000);
        this.threeCamera.position.z = DEFAULT_THREE_CAMERA_STATE.radius;
        this.updateThreeCameraProjectionMatrix(this.threeCameraState?.radius ?? DEFAULT_THREE_CAMERA_STATE.radius);


        this.threeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.threeRenderer.setClearColor(DEFAULT_THREE_SCENE_BACKGROUND, 1);

        this.threeRenderer.setSize(width, height);

        this.threeRenderer.domElement.style.cssText = 'width: 100%; height: 100%; margin: 0.25rem; border-radius: 0.25rem; border: 0.5px solid; pointer-events: auto; display: block; box-sizing: border-box;';
        this.threeContainer.appendChild(this.threeRenderer.domElement);


        this.setup3DOrbitControls();


        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.threeScene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4);
        directionalLight.position.set(1, 1, 1);
        this.threeScene.add(directionalLight);


        this.createTransformGizmo();


        this.start3DAnimationLoop();
        this.schedulePoseDescriptionRefresh({ immediate: true });
    }


    animate3D() {
        if (!this.is3DMode) {
            this.threeAnimationFrameHandle = null;
            return;
        }


        this.threeAnimationFrameHandle = requestAnimationFrame(() => this.animate3D());


        if (this.threeRenderer && this.threeScene && this.threeCamera) {
            this.threeRenderer.render(this.threeScene, this.threeCamera);
        }
    }


    setup3DOrbitControls() {
        let isRotating = false;
        let mouseX = 0;
        let mouseY = 0;

        const orbitCamera = (deltaX, deltaY) => {
            const orbitCenter = this.ensureThreeOrbitCenter();
            if (!orbitCenter) {
                return;
            }
            this.orbitThreeCamera(deltaX, deltaY, orbitCenter);
        };

        const rotateModel = (deltaX, deltaY) => {
            const THREE = window.THREE || globalThis.THREE;
            const rotateCenter = this.getComputedModelCenterVector();
            if (!THREE || !rotateCenter) {
                return;
            }

            const angleX = deltaY * THREE_CAMERA_ORBIT_SPEED;
            const angleY = deltaX * THREE_CAMERA_ORBIT_SPEED;
            const deltaQuaternion = new THREE.Quaternion();

            const applyRotation = (axisVector, angle) => {
                if (!axisVector || Math.abs(angle) < 0.0001) {
                    return;
                }

                deltaQuaternion.setFromAxisAngle(axisVector.clone().normalize(), angle);

                this.threeObjects.forEach((obj, key) => {
                    if (!key.startsWith('point_')) {
                        return;
                    }

                    const relativePos = new THREE.Vector3().subVectors(obj.position, rotateCenter);
                    relativePos.applyQuaternion(deltaQuaternion);
                    obj.position.addVectors(rotateCenter, relativePos);

                    if (obj.userData.pointData) {
                        obj.userData.pointData.x = obj.position.x;
                        obj.userData.pointData.y = obj.position.y;
                        obj.userData.pointData.z = obj.position.z;
                    }
                });

                if (!this.threeModelQuaternion) {
                    this.threeModelQuaternion = new THREE.Quaternion();
                }
                this.threeModelQuaternion.premultiply(deltaQuaternion);
            };

            if (Math.abs(deltaY) > 0.1) {
                applyRotation(this.getGizmoWorldAxis('x'), angleX);
            }

            if (Math.abs(deltaX) > 0.1) {
                applyRotation(this.getGizmoWorldAxis('y'), angleY);
            }

            this.updateAll3DLines();
            this.update3DTransformCenter();
            this.update3DOrbitCenter();
            this.updateTransformGizmo();
            this.update3DSelectionBox();
            this.update3DStatus();
        };


        this.threeRenderer.domElement.addEventListener('mousedown', (e) => {
            if (e.button === 2) {
                isRotating = true;
                mouseX = e.clientX;
                mouseY = e.clientY;
                this.ensureThreeOrbitCenter();
                e.preventDefault();
            }
        });


        let isPanning = false;
        let panStartX = 0;
        let panStartY = 0;
        this.threeRenderer.domElement.addEventListener('mousedown', (e) => {
            if (e.button === 1) {
                isPanning = true;
                panStartX = e.clientX;
                panStartY = e.clientY;
                e.preventDefault();
            }
        });


        this.threeRenderer.domElement.addEventListener('mousemove', (e) => {
            if (isRotating) {
                const deltaX = e.clientX - mouseX;
                const deltaY = e.clientY - mouseY;

                if (this.threeCameraNavigationMode === "model_rotate_legacy") {
                    rotateModel(deltaX, deltaY);
                } else {
                    orbitCamera(deltaX, deltaY);
                }

                mouseX = e.clientX;
                mouseY = e.clientY;
            } else if (isPanning) {
                const deltaX = e.clientX - panStartX;
                const deltaY = e.clientY - panStartY;


                const camera = this.threeCamera;
                const orbitCenter = this.ensureThreeOrbitCenter() || new THREE.Vector3(0, 0, 0);
                const cameraDistance = camera.position.distanceTo(orbitCenter);
                const panSpeed = Math.max(cameraDistance * 0.0012, 0.15);


                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
                const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);


                camera.position.addScaledVector(right, -deltaX * panSpeed);
                camera.position.addScaledVector(up, deltaY * panSpeed);


                if (this.threeOrbitCenter) {
                    this.threeOrbitCenter.addScaledVector(right, -deltaX * panSpeed);
                    this.threeOrbitCenter.addScaledVector(up, deltaY * panSpeed);
                }

                this.syncThreeCameraStateFromCamera();
                this.schedulePoseDescriptionRefresh();

                panStartX = e.clientX;
                panStartY = e.clientY;
            }
        });


        this.threeRenderer.domElement.addEventListener('mouseup', (e) => {
            if (e.button === 2) {
                isRotating = false;
            } else if (e.button === 1) {
                isPanning = false;
            }
        });


        this.threeRenderer.domElement.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });


        this.threeRenderer.domElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            const orbitCenter = this.ensureThreeOrbitCenter();
            if (!orbitCenter) {
                return;
            }

            this.syncThreeCameraStateFromCamera();

            const currentRadius = this.threeCameraState?.radius ?? DEFAULT_THREE_CAMERA_STATE.radius;
            const nextRadius = Math.max(40, Math.min(5000, currentRadius * Math.exp(e.deltaY * 0.001)));
            this.threeCameraState = {
                ...(this.threeCameraState || DEFAULT_THREE_CAMERA_STATE),
                radius: nextRadius,
            };
            this.applyThreeCameraState(this.threeCameraState, orbitCenter);
        }, { passive: false });


        this.setup3DInteraction();
    }


    render3DPose() {
        if (!this.threeScene || !window.THREE || !this.threePoseData) return;

        const THREE = window.THREE;
        const selectedKeys = new Set(
            [...this.threeSelectedObjects].map(obj => `${obj.userData?.id}_${obj.userData?.poseId}`)
        );
        this.remove3DSelectionBox();
        this.threeSelectedObjects.clear();


        this.threeObjects.forEach(obj => {
            this.threeScene.remove(obj);
        });
        this.threeObjects.clear();

        const pointsMap = new Map();


        const pointRadius = 7;
        this.threePoseData.points.forEach(point => {
            const geometry = new THREE.SphereGeometry(pointRadius, 16, 16);
            const material = new THREE.MeshPhongMaterial({
                color: new THREE.Color(`rgb(${point.color.join(',')})`),
                shininess: 100
            });
            const sphere = new THREE.Mesh(geometry, material);

            sphere.position.set(point.x, point.y, point.z);


            sphere.userData = {
                pointData: point,
                id: point.id,
                poseId: point.poseId,
                isSelected: false,
                originalColor: new THREE.Color(`rgb(${point.color.join(',')})`),
                originalRadius: pointRadius
            };

            this.threeScene.add(sphere);
            this.threeObjects.set(this.getThreePointObjectKey(point.id, point.poseId), sphere);
            pointsMap.set(`${point.id}_${point.poseId}`, sphere);

            if (selectedKeys.has(`${point.id}_${point.poseId}`)) {
                this.select3DObject(sphere);
            }
        });


        this.threePoseData.connections.forEach(conn => {
            const startSphere = pointsMap.get(`${conn.startId}_${conn.startPoseId}`);
            const endSphere = pointsMap.get(`${conn.endId}_${conn.endPoseId}`);

            if (startSphere && endSphere) {
                this.create3DCylinder(startSphere, endSphere);
            }
        });


        this.updateTransformGizmo();
        this.update3DOrbitCenter();
        if (!this.threeOrbitCenter && this.threeComputedModelCenter) {
            this.threeOrbitCenter = this.threeComputedModelCenter.clone();
            if (this.threeCamera) {
                this.threeCamera.lookAt(this.threeOrbitCenter);
                this.syncThreeCameraStateFromCamera();
            }
        }
        this.schedulePoseDescriptionRefresh();
    }


    create3DLine(startSphere, endSphere) {
        const THREE = window.THREE;

        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(6);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({
            color: startSphere.material.color,
            linewidth: 5
        });

        const line = new THREE.Line(geometry, material);
        line.userData = {
            startSphere: startSphere,
            endSphere: endSphere
        };

        this.update3DLineGeometry(line);
        this.threeScene.add(line);
        this.threeObjects.set(
            `line_${startSphere.userData.id}_${startSphere.userData.poseId}_${endSphere.userData.id}_${endSphere.userData.poseId}`,
            line
        );
    }


    update3DLineGeometry(line) {
        const startPos = line.userData.startSphere.position;
        const endPos = line.userData.endSphere.position;


        const positions = line.geometry.attributes.position.array;
        positions[0] = startPos.x;
        positions[1] = startPos.y;
        positions[2] = startPos.z;
        positions[3] = endPos.x;
        positions[4] = endPos.y;
        positions[5] = endPos.z;

        line.geometry.attributes.position.needsUpdate = true;
    }


    create3DCylinder(startSphere, endSphere) {
        const THREE = window.THREE;

        const startPos = startSphere.position;
        const endPos = endSphere.position;


        const direction = new THREE.Vector3().subVectors(endPos, startPos);
        const length = direction.length();
        const radius = 4;


        const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);


        const startColor = startSphere.material.color.clone();
        const endColor = endSphere.material.color.clone();


        const count = geometry.attributes.position.count;
        const colors = new Float32Array(count * 3);
        const positions = geometry.attributes.position.array;


        for (let i = 0; i < count; i++) {
            const y = positions[i * 3 + 1];

            const t = (y + length / 2) / length;


            const r = startColor.r + (endColor.r - startColor.r) * t;
            const g = startColor.g + (endColor.g - startColor.g) * t;
            const b = startColor.b + (endColor.b - startColor.b) * t;

            colors[i * 3] = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.MeshPhongMaterial({
            vertexColors: true,
            shininess: 100
        });

        const cylinder = new THREE.Mesh(geometry, material);


        const midPoint = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
        cylinder.position.copy(midPoint);


        const axis = new THREE.Vector3(0, 1, 0);
        const target = direction.clone().normalize();
        const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, target);
        cylinder.setRotationFromQuaternion(quaternion);

        cylinder.userData = {
            startSphere: startSphere,
            endSphere: endSphere,
            isCylinder: true
        };

        this.threeScene.add(cylinder);
        this.threeObjects.set(
            `line_${startSphere.userData.id}_${startSphere.userData.poseId}_${endSphere.userData.id}_${endSphere.userData.poseId}`,
            cylinder
        );
    }


    update3DCylinderGeometry(cylinder) {
        const startSphere = cylinder.userData.startSphere;
        const endSphere = cylinder.userData.endSphere;

        if (!startSphere || !endSphere) return;

        const startPos = startSphere.position;
        const endPos = endSphere.position;


        const direction = new THREE.Vector3().subVectors(endPos, startPos);
        const length = direction.length();


        const midPoint = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
        cylinder.position.copy(midPoint);


        const axis = new THREE.Vector3(0, 1, 0);
        const target = direction.clone().normalize();
        const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, target);
        cylinder.setRotationFromQuaternion(quaternion);


        cylinder.scale.set(1, length / cylinder.geometry.parameters.height, 1);
    }


    setup3DInteraction() {
        if (!this.threeRenderer || !this.threeCamera) return;

        const THREE = window.THREE;
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();


        let isBoxSelecting = false;
        let boxStart = { x: 0, y: 0 };
        let selectionBox = null;


        let isDragging = false;
        let dragStartPos = new THREE.Vector3();
        let dragOffset = new THREE.Vector3();


        const createSelectionBox = () => {
            const box = document.createElement('div');
            box.style.cssText = 'position: fixed; border: 2px dashed #00ff00; background: rgba(0, 255, 0, 0.1); pointer-events: none; display: none; z-index: 10000;';
            document.body.appendChild(box);
            return box;
        };


        const create3DDragBox = () => {
            const THREE = window.THREE;
            const geometry = new THREE.BufferGeometry();

            const vertices = new Float32Array([
                0, 0, 0,  0, 0, 0,
                0, 0, 0,  0, 0, 0,
                0, 0, 0,  0, 0, 0,
                0, 0, 0,  0, 0, 0
            ]);
            geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            const material = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
            const line = new THREE.LineSegments(geometry, material);
            line.visible = false;
            this.threeScene.add(line);
            return line;
        };


        const ndcToWorld = (ndcX, ndcY, distance) => {
            const THREE = window.THREE;
            const vector = new THREE.Vector3(ndcX, ndcY, 0.5);
            vector.unproject(this.threeCamera);
            const dir = vector.sub(this.threeCamera.position).normalize();
            return this.threeCamera.position.clone().add(dir.multiplyScalar(distance));
        };


        const update3DDragBox = (startNDC, endNDC) => {
            if (!this.threeDragBox) {
                this.threeDragBox = create3DDragBox();
            }

            const THREE = window.THREE;
            const minX = Math.min(startNDC.x, endNDC.x);
            const maxX = Math.max(startNDC.x, endNDC.x);
            const minY = Math.min(startNDC.y, endNDC.y);
            const maxY = Math.max(startNDC.y, endNDC.y);


            const center = this.threeOrbitCenter || new THREE.Vector3(0, 0, 0);
            const distance = this.threeCamera.position.distanceTo(center) * 0.9;


            const p1 = ndcToWorld(minX, minY, distance);
            const p2 = ndcToWorld(maxX, minY, distance);
            const p3 = ndcToWorld(maxX, maxY, distance);
            const p4 = ndcToWorld(minX, maxY, distance);


            const positions = this.threeDragBox.geometry.attributes.position.array;

            positions[0] = p1.x; positions[1] = p1.y; positions[2] = p1.z;
            positions[3] = p2.x; positions[4] = p2.y; positions[5] = p2.z;

            positions[6] = p2.x; positions[7] = p2.y; positions[8] = p2.z;
            positions[9] = p3.x; positions[10] = p3.y; positions[11] = p3.z;

            positions[12] = p3.x; positions[13] = p3.y; positions[14] = p3.z;
            positions[15] = p4.x; positions[16] = p4.y; positions[17] = p4.z;

            positions[18] = p4.x; positions[19] = p4.y; positions[20] = p4.z;
            positions[21] = p1.x; positions[22] = p1.y; positions[23] = p1.z;

            this.threeDragBox.geometry.attributes.position.needsUpdate = true;
            this.threeDragBox.visible = true;
        };


        this.threeRenderer.domElement.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;


            const mouseX = e.clientX;
            const mouseY = e.clientY;


            const rect = this.threeRenderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, this.threeCamera);


            const spheres = [];
            this.threeObjects.forEach((obj, key) => {
                if (key.startsWith('point_')) {
                    spheres.push(obj);
                }
            });

            const intersects = raycaster.intersectObjects(spheres);


            let controlPointIntersect = null;
            if (this.threeControlPoints && this.threeControlPoints.length > 0) {
                const cpIntersects = raycaster.intersectObjects(this.threeControlPoints);
                if (cpIntersects.length > 0) {
                    controlPointIntersect = cpIntersects[0].object;
                }
            }


            let isInsideSelectionBox = false;
            if (this.threeSelectedObjects.size > 0 && this.threeSelectionBox && this.threeSelectionBox.visible) {

                const boxMin = new THREE.Vector3();
                const boxMax = new THREE.Vector3();
                let hasBox = false;
                this.threeSelectedObjects.forEach(obj => {
                    if (!hasBox) {
                        boxMin.copy(obj.position);
                        boxMax.copy(obj.position);
                        hasBox = true;
                    } else {
                        boxMin.min(obj.position);
                        boxMax.max(obj.position);
                    }
                });
                if (hasBox) {

                    const padding = 20;
                    boxMin.x -= padding; boxMin.y -= padding; boxMin.z -= padding;
                    boxMax.x += padding; boxMax.y += padding; boxMax.z += padding;



                    const box = new THREE.Box3(boxMin, boxMax);
                    const ray = raycaster.ray;
                    const intersection = new THREE.Vector3();
                    if (ray.intersectBox(box, intersection)) {

                        if (intersects.length === 0 && !controlPointIntersect) {
                            isInsideSelectionBox = true;
                        }
                    }
                }
            }

            if (controlPointIntersect) {

                this.threeActiveControlPoint = controlPointIntersect;
                isDragging = true;
                dragStartPos.copy(controlPointIntersect.position);


                const normal = new THREE.Vector3();
                this.threeCamera.getWorldDirection(normal);
                this.threeDragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, controlPointIntersect.position);


                const target = new THREE.Vector3();
                raycaster.ray.intersectPlane(this.threeDragPlane, target);
                dragOffset.subVectors(target, controlPointIntersect.position);

                e.preventDefault();
                e.stopPropagation();
            } else if (intersects.length > 0) {

                const clickedObj = intersects[0].object;


                if (!e.shiftKey) {
                    this.clear3DSelection();
                }


                this.select3DObject(clickedObj);

                isDragging = true;
                dragStartPos.copy(clickedObj.position);


                const normal = new THREE.Vector3();
                this.threeCamera.getWorldDirection(normal);
                this.threeDragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, clickedObj.position);


                const target = new THREE.Vector3();
                raycaster.ray.intersectPlane(this.threeDragPlane, target);
                dragOffset.subVectors(target, clickedObj.position);

                e.preventDefault();
                e.stopPropagation();
            } else if (isInsideSelectionBox) {

                isDragging = true;
                this.isTranslatingSelection = true;


                const normal = new THREE.Vector3();
                this.threeCamera.getWorldDirection(normal);
                const center = this.threeTransformCenter || new THREE.Vector3(0, 0, 0);
                this.threeDragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);


                const target = new THREE.Vector3();
                raycaster.ray.intersectPlane(this.threeDragPlane, target);
                dragStartPos.copy(target);
                dragOffset.set(0, 0, 0);

                e.preventDefault();
                e.stopPropagation();
            } else {

                let gizmoIntersect = null;
                if (this.threeTransformGizmo && this.threeTransformGizmo.visible) {
                    const gizmoObjects = [];
                    this.threeTransformGizmo.traverse(child => {
                        if (child.userData && child.userData.isGizmo) {
                            gizmoObjects.push(child);
                        }
                    });
                    const gizmoIntersects = raycaster.intersectObjects(gizmoObjects);
                    if (gizmoIntersects.length > 0) {
                        gizmoIntersect = gizmoIntersects[0].object;
                    }
                }


                if (gizmoIntersect) {
                    return;
                }


                isBoxSelecting = true;
                boxStart.x = mouseX;
                boxStart.y = mouseY;

                if (!selectionBox) {
                    selectionBox = createSelectionBox();
                }
                selectionBox.style.left = boxStart.x + 'px';
                selectionBox.style.top = boxStart.y + 'px';
                selectionBox.style.width = '0px';
                selectionBox.style.height = '0px';
                selectionBox.style.display = 'block';


                if (!e.shiftKey) {
                    this.clear3DSelection();
                }

                e.preventDefault();
                e.stopPropagation();
            }
        });


        this.threeRenderer.domElement.addEventListener('mousemove', (e) => {

            if (!isDragging && !isBoxSelecting && this.threeSelectedObjects.size > 0 && this.threeSelectionBox && this.threeSelectionBox.visible) {
                const rect = this.threeRenderer.domElement.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, this.threeCamera);


                const boxMin = new THREE.Vector3();
                const boxMax = new THREE.Vector3();
                let hasBox = false;
                this.threeSelectedObjects.forEach(obj => {
                    if (!hasBox) {
                        boxMin.copy(obj.position);
                        boxMax.copy(obj.position);
                        hasBox = true;
                    } else {
                        boxMin.min(obj.position);
                        boxMax.max(obj.position);
                    }
                });

                if (hasBox) {
                    const padding = 20;
                    boxMin.x -= padding; boxMin.y -= padding; boxMin.z -= padding;
                    boxMax.x += padding; boxMax.y += padding; boxMax.z += padding;

                    const box = new THREE.Box3(boxMin, boxMax);
                    const intersection = new THREE.Vector3();
                    const isInside = raycaster.ray.intersectBox(box, intersection);


                    let isOverControlPoint = false;
                    if (this.showGizmo && this.threeControlPoints && this.threeControlPoints.length > 0) {
                        const cpIntersects = raycaster.intersectObjects(this.threeControlPoints);
                        if (cpIntersects.length > 0) {
                            isOverControlPoint = true;
                        }
                    }


                    const spheres = [];
                    this.threeObjects.forEach((obj, key) => {
                        if (key.startsWith('point_')) spheres.push(obj);
                    });
                    const intersects = raycaster.intersectObjects(spheres);
                    const isOverPoint = intersects.length > 0;


                    if (isInside && !isOverControlPoint && !isOverPoint) {
                        this.threeRenderer.domElement.style.cursor = 'move';
                    } else if (isOverControlPoint || isOverPoint) {
                        this.threeRenderer.domElement.style.cursor = 'pointer';
                    } else {
                        this.threeRenderer.domElement.style.cursor = 'default';
                    }
                }
            }


            if (!isDragging && !isBoxSelecting) {
                const rect = this.threeRenderer.domElement.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, this.threeCamera);


                const spheres = [];
                this.threeObjects.forEach((obj, key) => {
                    if (key.startsWith('point_')) spheres.push(obj);
                });
                const intersects = raycaster.intersectObjects(spheres);
                const isOverPoint = intersects.length > 0;


                if (isOverPoint) {
                    const hoveredObj = intersects[0].object;

                    if (!hoveredObj.userData.isSelected) {
                        if (this.threeHoveredObject !== hoveredObj) {

                            if (this.threeHoveredObject && !this.threeHoveredObject.userData.isSelected) {
                                this.threeHoveredObject.scale.set(1, 1, 1);
                            }

                            this.threeHoveredObject = hoveredObj;

                            hoveredObj.material.emissive.setHex(0x333333);
                            hoveredObj.scale.set(1.2, 1.2, 1.2);
                        }
                    }
                } else {

                    if (this.threeHoveredObject && !this.threeHoveredObject.userData.isSelected) {
                        this.threeHoveredObject.material.emissive.setHex(0x000000);
                        this.threeHoveredObject.scale.set(1, 1, 1);
                    }
                    this.threeHoveredObject = null;
                }
            }

            if (isBoxSelecting && selectionBox) {

                const mouseX = e.clientX;
                const mouseY = e.clientY;


                const width = mouseX - boxStart.x;
                const height = mouseY - boxStart.y;
                selectionBox.style.left = Math.min(boxStart.x, mouseX) + 'px';
                selectionBox.style.top = Math.min(boxStart.y, mouseY) + 'px';
                selectionBox.style.width = Math.abs(width) + 'px';
                selectionBox.style.height = Math.abs(height) + 'px';


                const rect = this.threeRenderer.domElement.getBoundingClientRect();
                const startNDC = {
                    x: ((boxStart.x - rect.left) / rect.width) * 2 - 1,
                    y: -((boxStart.y - rect.top) / rect.height) * 2 + 1
                };
                const endNDC = {
                    x: ((mouseX - rect.left) / rect.width) * 2 - 1,
                    y: -((mouseY - rect.top) / rect.height) * 2 + 1
                };
                update3DDragBox(startNDC, endNDC);
            } else if (isDragging) {
                if (this.threeActiveControlPoint) {

                    const rect = this.threeRenderer.domElement.getBoundingClientRect();
                    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

                    raycaster.setFromCamera(mouse, this.threeCamera);

                    const target = new THREE.Vector3();
                    raycaster.ray.intersectPlane(this.threeDragPlane, target);

                    if (target && this.threeTransformCenter) {
                        const currentPos = new THREE.Vector3().copy(target).sub(dragOffset);

                        this.scaleFromControlPoint(dragStartPos, currentPos, this.threeActiveControlPoint);
                        dragStartPos.copy(currentPos);
                    }
                } else if (this.isTranslatingSelection && this.threeSelectedObjects.size > 0) {

                    const rect = this.threeRenderer.domElement.getBoundingClientRect();
                    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

                    raycaster.setFromCamera(mouse, this.threeCamera);

                    const target = new THREE.Vector3();
                    raycaster.ray.intersectPlane(this.threeDragPlane, target);

                    if (target) {
                        const currentPos = new THREE.Vector3().copy(target);
                        const delta = new THREE.Vector3().subVectors(currentPos, dragStartPos);
                        this.translate3DSelection(delta);
                        dragStartPos.copy(currentPos);
                    }
                } else if (this.threeSelectedObjects.size > 0) {

                    const rect = this.threeRenderer.domElement.getBoundingClientRect();
                    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

                    raycaster.setFromCamera(mouse, this.threeCamera);

                    const target = new THREE.Vector3();
                    raycaster.ray.intersectPlane(this.threeDragPlane, target);

                    if (target) {
                        const currentPos = new THREE.Vector3().copy(target).sub(dragOffset);
                        const selectedPoints = this.get3DSelectedPointObjects();

                        const ikHandled = this.threeRigMode === "ik" && selectedPoints.length === 1 && (
                            this.solveTwoBoneIKForTarget(selectedPoints[0], currentPos) ||
                            this.solveTwoBoneIKForMidTarget(selectedPoints[0], currentPos)
                        );

                        if (ikHandled) {
                            dragStartPos.copy(currentPos);
                        } else if (e.shiftKey && this.threeTransformCenter) {

                            this.rotate3DSelection(dragStartPos, currentPos);
                        } else if (e.ctrlKey && this.threeTransformCenter) {

                            this.scale3DSelection(dragStartPos, currentPos);
                        } else {

                            const delta = new THREE.Vector3().subVectors(currentPos, dragStartPos);
                            this.translate3DSelection(delta);
                        }

                        dragStartPos.copy(currentPos);
                    }
                }
            }
        });


        this.threeRenderer.domElement.addEventListener('mouseup', (e) => {
            if (isBoxSelecting) {
                isBoxSelecting = false;


                if (this.threeDragBox) {
                    this.threeDragBox.visible = false;
                }

                if (selectionBox) {

                    const boxRect = selectionBox.getBoundingClientRect();
                    const rendererRect = this.threeRenderer.domElement.getBoundingClientRect();


                    const selectLeft = boxRect.left;
                    const selectRight = boxRect.right;
                    const selectTop = boxRect.top;
                    const selectBottom = boxRect.bottom;


                    this.threeObjects.forEach((obj, key) => {
                        if (key.startsWith('point_')) {

                            const vector = new THREE.Vector3();
                            obj.getWorldPosition(vector);
                            vector.project(this.threeCamera);


                            const objX = (vector.x + 1) / 2 * rendererRect.width + rendererRect.left;
                            const objY = (-vector.y + 1) / 2 * rendererRect.height + rendererRect.top;

                            if (objX >= selectLeft && objX <= selectRight &&
                                objY >= selectTop && objY <= selectBottom) {
                                this.select3DObject(obj);
                            }
                        }
                    });

                    selectionBox.style.display = 'none';
                }
            } else if (isDragging) {
                isDragging = false;
                this.threeDragPlane = null;
                this.threeActiveControlPoint = null;
                this.isTranslatingSelection = false;

                this.updateTransformGizmo();
            }
        });
    }


    get3DScreenPosition(obj) {
        const vector = new THREE.Vector3();
        obj.getWorldPosition(vector);
        vector.project(this.threeCamera);

        const rect = this.threeRenderer.domElement.getBoundingClientRect();
        return {
            x: (vector.x + 1) / 2 * rect.width,
            y: (-vector.y + 1) / 2 * rect.height
        };
    }


    select3DObject(obj) {
        if (!obj.userData.isSelected) {
            obj.userData.isSelected = true;

            obj.material.emissive.setHex(0x666666);
            obj.scale.set(1.3, 1.3, 1.3);
            this.threeSelectedObjects.add(obj);

            this.update3DTransformCenter();

            if (this.threeSelectedObjects.size >= 2) {
                this.create3DSelectionBox();
            }
        }
        this.updateTransformGizmo();
        this.update3DStatus();
    }


    clear3DSelection() {
        this.threeSelectedObjects.forEach(obj => {
            obj.userData.isSelected = false;
            obj.material.emissive.setHex(0x000000);
            obj.scale.set(1, 1, 1);
        });
        this.threeSelectedObjects.clear();
        this.threeTransformCenter = null;
        this.threeComputedSelectionCenter = null;

        this.remove3DSelectionBox();
        this.updateTransformGizmo();
        this.update3DStatus();
    }


    update3DTransformCenter() {
        if (this.threeSelectedObjects.size === 0) {
            this.threeTransformCenter = null;
            this.threeComputedSelectionCenter = null;
            return;
        }

        let centerX = 0, centerY = 0, centerZ = 0;
        this.threeSelectedObjects.forEach(obj => {
            centerX += obj.position.x;
            centerY += obj.position.y;
            centerZ += obj.position.z;
        });

        const count = this.threeSelectedObjects.size;
        this.threeTransformCenter = new THREE.Vector3(
            centerX / count,
            centerY / count,
            centerZ / count
        );
        this.threeComputedSelectionCenter = this.threeTransformCenter.clone();
    }


    updateAll3DLines() {
        this.threeObjects.forEach((obj, key) => {
            if (key.startsWith('line_')) {
                if (obj.userData.isCylinder) {
                    this.update3DCylinderGeometry(obj);
                } else {
                    this.update3DLineGeometry(obj);
                }
            }
        });
        this.schedulePoseDescriptionRefresh();
    }


    translate3DSelection(delta) {
        this.threeSelectedObjects.forEach(obj => {
            obj.position.add(delta);

            if (obj.userData.pointData) {
                obj.userData.pointData.x = obj.position.x;
                obj.userData.pointData.y = obj.position.y;
                obj.userData.pointData.z = obj.position.z;
            }
        });

        if (this.threeTransformCenter) {
            this.threeTransformCenter.add(delta);
            this.threeComputedSelectionCenter = this.threeTransformCenter.clone();
        }

        this.updateAll3DLines();

        this.update3DSelectionBox();

        this.update3DOrbitCenter();

        this.updateTransformGizmo();
    }


    rotate3DSelection(startPos, currentPos) {
        if (!this.threeTransformCenter) return;

        const THREE = window.THREE;


        const deltaX = currentPos.x - startPos.x;
        const deltaY = currentPos.y - startPos.y;


        const cameraDirection = new THREE.Vector3();
        this.threeCamera.getWorldDirection(cameraDirection);
        const rotationAxis = new THREE.Vector3(-deltaY, deltaX, 0).normalize();
        if (rotationAxis.length() < 0.001) return;


        const angle = Math.sqrt(deltaX * deltaX + deltaY * deltaY) * 0.01;


        this.threeSelectedObjects.forEach(obj => {

            const relativePos = new THREE.Vector3().subVectors(obj.position, this.threeTransformCenter);


            relativePos.applyAxisAngle(cameraDirection, angle);


            obj.position.addVectors(this.threeTransformCenter, relativePos);


            if (obj.userData.pointData) {
                obj.userData.pointData.x = obj.position.x;
                obj.userData.pointData.y = obj.position.y;
                obj.userData.pointData.z = obj.position.z;
            }
        });


        this.updateAll3DLines();

        this.update3DSelectionBox();

        this.update3DOrbitCenter();

        this.updateTransformGizmo();
    }


    scale3DSelection(startPos, currentPos) {
        if (!this.threeTransformCenter) return;

        const THREE = window.THREE;


        const startDist = startPos.distanceTo(this.threeTransformCenter);
        const currentDist = currentPos.distanceTo(this.threeTransformCenter);

        if (startDist < 0.001) return;

        const scale = currentDist / startDist;


        this.threeSelectedObjects.forEach(obj => {

            const relativePos = new THREE.Vector3().subVectors(obj.position, this.threeTransformCenter);


            relativePos.multiplyScalar(scale);


            obj.position.addVectors(this.threeTransformCenter, relativePos);


            if (obj.userData.pointData) {
                obj.userData.pointData.x = obj.position.x;
                obj.userData.pointData.y = obj.position.y;
                obj.userData.pointData.z = obj.position.z;
            }
        });


        this.updateAll3DLines();

        this.update3DSelectionBox();

        this.updateTransformGizmo();

    }


    recalculateOrbitCenter() {
        if (!this.threeObjects || this.threeObjects.size === 0) return;

        const THREE = window.THREE;
        let centerX = 0, centerY = 0, centerZ = 0, count = 0;


        this.threeObjects.forEach((obj, key) => {
            if (key.startsWith('point_')) {
                centerX += obj.position.x;
                centerY += obj.position.y;
                centerZ += obj.position.z;
                count++;
            }
        });


        if (count > 0) {
            this.threeComputedModelCenter = new THREE.Vector3(
                centerX / count,
                centerY / count,
                centerZ / count
            );
        }
    }


    scaleFromControlPoint(startPos, currentPos, controlPoint) {
        if (!this.threeTransformCenter) return;

        const THREE = window.THREE;
        const isCorner = controlPoint.userData.isCorner;


        const controlPointDir = new THREE.Vector3().subVectors(controlPoint.position, this.threeTransformCenter);
        controlPointDir.z = 0;
        controlPointDir.normalize();


        const dragVector = new THREE.Vector3().subVectors(currentPos, startPos);
        dragVector.z = 0;
        const dragProjection = dragVector.dot(controlPointDir);

        if (isCorner) {


            const oppositePos = new THREE.Vector3(
                this.threeTransformCenter.x - (controlPoint.position.x - this.threeTransformCenter.x),
                this.threeTransformCenter.y - (controlPoint.position.y - this.threeTransformCenter.y),
                controlPoint.position.z
            );


            const newControlPos = new THREE.Vector3(
                controlPoint.position.x + controlPointDir.x * dragProjection,
                controlPoint.position.y + controlPointDir.y * dragProjection,
                controlPoint.position.z
            );


            const oldDist = Math.sqrt(
                Math.pow(controlPoint.position.x - oppositePos.x, 2) +
                Math.pow(controlPoint.position.y - oppositePos.y, 2)
            );
            const newDist = Math.sqrt(
                Math.pow(newControlPos.x - oppositePos.x, 2) +
                Math.pow(newControlPos.y - oppositePos.y, 2)
            );
            if (oldDist < 0.001) return;

            const scale = newDist / oldDist;


            this.threeSelectedObjects.forEach(obj => {

                const relativeX = obj.position.x - oppositePos.x;
                const relativeY = obj.position.y - oppositePos.y;

                obj.position.x = oppositePos.x + relativeX * scale;
                obj.position.y = oppositePos.y + relativeY * scale;


                if (obj.userData.pointData) {
                    obj.userData.pointData.x = obj.position.x;
                    obj.userData.pointData.y = obj.position.y;
                    obj.userData.pointData.z = obj.position.z;
                }
            });


            controlPoint.position.copy(newControlPos);


            this.threeTransformCenter.x = (oppositePos.x + newControlPos.x) / 2;
            this.threeTransformCenter.y = (oppositePos.y + newControlPos.y) / 2;

        } else {


            const absX = Math.abs(controlPointDir.x);
            const absY = Math.abs(controlPointDir.y);

            let scaleAxis = 'x';
            if (absY > absX) scaleAxis = 'y';


            let oppositeValue;
            if (scaleAxis === 'x') {
                oppositeValue = controlPointDir.x > 0 ?
                    this.threeTransformCenter.x - (controlPoint.position.x - this.threeTransformCenter.x) :
                    this.threeTransformCenter.x + (this.threeTransformCenter.x - controlPoint.position.x);
            } else {
                oppositeValue = controlPointDir.y > 0 ?
                    this.threeTransformCenter.y - (controlPoint.position.y - this.threeTransformCenter.y) :
                    this.threeTransformCenter.y + (this.threeTransformCenter.y - controlPoint.position.y);
            }


            let newControlValue;
            if (scaleAxis === 'x') {
                newControlValue = controlPoint.position.x + dragProjection * Math.sign(controlPointDir.x);
                if (controlPointDir.x > 0 && newControlValue < oppositeValue + 10) newControlValue = oppositeValue + 10;
                if (controlPointDir.x < 0 && newControlValue > oppositeValue - 10) newControlValue = oppositeValue - 10;
            } else {
                newControlValue = controlPoint.position.y + dragProjection * Math.sign(controlPointDir.y);
                if (controlPointDir.y > 0 && newControlValue < oppositeValue + 10) newControlValue = oppositeValue + 10;
                if (controlPointDir.y < 0 && newControlValue > oppositeValue - 10) newControlValue = oppositeValue - 10;
            }


            const oldDist = Math.abs((scaleAxis === 'x' ? controlPoint.position.x : controlPoint.position.y) - oppositeValue);
            const newDist = Math.abs(newControlValue - oppositeValue);
            if (oldDist < 0.001) return;

            const scale = newDist / oldDist;


            this.threeSelectedObjects.forEach(obj => {
                const objValue = scaleAxis === 'x' ? obj.position.x : obj.position.y;
                const relativeValue = objValue - oppositeValue;
                const newValue = oppositeValue + relativeValue * scale;

                if (scaleAxis === 'x') obj.position.x = newValue;
                else obj.position.y = newValue;


                if (obj.userData.pointData) {
                    obj.userData.pointData.x = obj.position.x;
                    obj.userData.pointData.y = obj.position.y;
                    obj.userData.pointData.z = obj.position.z;
                }
            });


            if (scaleAxis === 'x') controlPoint.position.x = newControlValue;
            else if (scaleAxis === 'y') controlPoint.position.y = newControlValue;
            else controlPoint.position.z = newControlValue;


            if (scaleAxis === 'x') this.threeTransformCenter.x = (oppositeValue + newControlValue) / 2;
            else if (scaleAxis === 'y') this.threeTransformCenter.y = (oppositeValue + newControlValue) / 2;
            else this.threeTransformCenter.z = (oppositeValue + newControlValue) / 2;
        }

        this.threeComputedSelectionCenter = this.threeTransformCenter ? this.threeTransformCenter.clone() : null;


        this.updateAll3DLines();

        this.update3DSelectionBox();

        this.updateTransformGizmo();


    }


    update3DOrbitCenter() {
        if (!this.threeObjects || this.threeObjects.size === 0) return;

        const THREE = window.THREE;
        let centerX = 0, centerY = 0, centerZ = 0, count = 0;

        this.threeObjects.forEach((obj, key) => {
            if (key.startsWith('point_')) {
                centerX += obj.position.x;
                centerY += obj.position.y;
                centerZ += obj.position.z;
                count++;
            }
        });

        if (count > 0) {
            this.threeComputedModelCenter = new THREE.Vector3(centerX / count, centerY / count, centerZ / count);
        }
    }


    create3DSelectionBox() {
        if (!this.threeScene) return;

        const THREE = window.THREE;


        if (this.threeSelectionBox) {
            this.threeScene.remove(this.threeSelectionBox);
        }
        if (this.threeControlPoints) {
            this.threeControlPoints.forEach(cp => this.threeScene.remove(cp));
        }


        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const edges = new THREE.EdgesGeometry(geometry);
        const material = new THREE.LineBasicMaterial({ color: 0x00aaff, linewidth: 2 });
        this.threeSelectionBox = new THREE.LineSegments(edges, material);
        this.threeScene.add(this.threeSelectionBox);


        this.threeControlPoints = [];
        const cornerGeometry = new THREE.BoxGeometry(12, 12, 12);
        const edgeGeometry = new THREE.BoxGeometry(10, 10, 10);
        const cpMaterial = new THREE.MeshBasicMaterial({ color: 0x00aaff });


        const corners = [
            [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
            [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]
        ];


        const edgeCenters = [

            [0, -0.5, -0.5], [0.5, 0, -0.5], [0, 0.5, -0.5], [-0.5, 0, -0.5],

            [0, -0.5, 0.5], [0.5, 0, 0.5], [0, 0.5, 0.5], [-0.5, 0, 0.5],

            [-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0]
        ];


        corners.forEach((pos, index) => {
            const cp = new THREE.Mesh(cornerGeometry, cpMaterial);
            cp.userData = { isControlPoint: true, isCorner: true, index: index };
            this.threeControlPoints.push(cp);
            this.threeScene.add(cp);
        });


        edgeCenters.forEach((pos, index) => {
            const cp = new THREE.Mesh(edgeGeometry, cpMaterial);
            cp.userData = { isControlPoint: true, isCorner: false, index: index + 8 };
            this.threeControlPoints.push(cp);
            this.threeScene.add(cp);
        });

        this.update3DSelectionBox();
    }


    update3DSelectionBox() {
        if (!this.threeSelectionBox || this.threeSelectedObjects.size === 0) return;


        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        this.threeSelectedObjects.forEach(obj => {
            minX = Math.min(minX, obj.position.x);
            minY = Math.min(minY, obj.position.y);
            minZ = Math.min(minZ, obj.position.z);
            maxX = Math.max(maxX, obj.position.x);
            maxY = Math.max(maxY, obj.position.y);
            maxZ = Math.max(maxZ, obj.position.z);
        });


        const padding = 20;
        minX -= padding; minY -= padding; minZ -= padding;
        maxX += padding; maxY += padding; maxZ += padding;


        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const centerZ = (minZ + maxZ) / 2;
        const width = maxX - minX;
        const height = maxY - minY;
        const depth = maxZ - minZ;

        this.threeSelectionBox.position.set(centerX, centerY, centerZ);
        this.threeSelectionBox.scale.set(width, height, depth);
        this.threeSelectionBox.visible = true;


        if (this.threeControlPoints) {

            const corners = [
                [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
                [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]
            ];


            const edgeCenters = [

                [0, -0.5, -0.5], [0.5, 0, -0.5], [0, 0.5, -0.5], [-0.5, 0, -0.5],

                [0, -0.5, 0.5], [0.5, 0, 0.5], [0, 0.5, 0.5], [-0.5, 0, 0.5],

                [-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0]
            ];

            this.threeControlPoints.forEach((cp, index) => {
                let pos;
                if (index < 8) {

                    pos = corners[index];
                } else {

                    pos = edgeCenters[index - 8];
                }
                cp.position.set(
                    centerX + pos[0] * width,
                    centerY + pos[1] * height,
                    centerZ + pos[2] * depth
                );
                cp.visible = true;
            });
        }
    }


    remove3DSelectionBox() {
        if (this.threeSelectionBox && this.threeScene) {
            this.threeScene.remove(this.threeSelectionBox);
            this.threeSelectionBox = null;
        }
        if (this.threeControlPoints && this.threeScene) {
            this.threeControlPoints.forEach(cp => this.threeScene.remove(cp));
            this.threeControlPoints = null;
        }
    }


    createTransformGizmo() {
        if (!this.threeScene) return;

        const THREE = window.THREE;


        if (this.threeTransformGizmo) {
            this.threeScene.remove(this.threeTransformGizmo);
        }


        if (this._clearGizmoCache) {
            this._clearGizmoCache();
        }


        this.threeTransformGizmo = new THREE.Group();


        if (!this.threeModelQuaternion) {
            this.threeModelQuaternion = new THREE.Quaternion();
        } else {
            this.threeModelQuaternion.set(0, 0, 0, 1);
        }


        const arrowLength = 100;
        const arrowHeadSize = 6;
        const lineRadius = 1.5;


        this.createGizmoAxis('x', new THREE.Color(0xff3333), arrowLength, arrowHeadSize, lineRadius);

        this.createGizmoAxis('y', new THREE.Color(0x33ff33), arrowLength, arrowHeadSize, lineRadius);

        this.createGizmoAxis('z', new THREE.Color(0x3333ff), arrowLength, arrowHeadSize, lineRadius);


        this.createGizmoRotationRing('x', new THREE.Color(0xff3333), 110);
        this.createGizmoRotationRing('y', new THREE.Color(0x33ff33), 110);
        this.createGizmoRotationRing('z', new THREE.Color(0x3333ff), 110);


        this.threeTransformGizmo.visible = false;
        this.threeScene.add(this.threeTransformGizmo);


        this.setupTransformGizmoInteraction();
    }


    createGizmoAxis(axis, color, length, headSize, lineRadius) {
        const THREE = window.THREE;
        const axisGroup = new THREE.Group();
        axisGroup.name = 'axis_' + axis;


        const lineGeometry = new THREE.CylinderGeometry(lineRadius, lineRadius, length, 8);
        const lineMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.8,
            depthTest: false
        });
        const line = new THREE.Mesh(lineGeometry, lineMaterial);


        const headGeometry = new THREE.ConeGeometry(headSize * 1.5, headSize * 2, 16);
        const headMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.8,
            depthTest: false
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);


        if (axis === 'x') {
            line.rotation.z = -Math.PI / 2;
            line.position.x = length / 2;
            head.rotation.z = -Math.PI / 2;
            head.position.x = length;
        } else if (axis === 'y') {
            line.position.y = length / 2;
            head.position.y = length;
        } else if (axis === 'z') {
            line.rotation.x = Math.PI / 2;
            line.position.z = length / 2;
            head.rotation.x = Math.PI / 2;
            head.position.z = length;
        }


        line.userData = { isGizmo: true, gizmoAxis: axis, originalColor: color.clone() };
        head.userData = { isGizmo: true, gizmoAxis: axis, originalColor: color.clone() };

        axisGroup.add(line);
        axisGroup.add(head);

        this.threeTransformGizmo.add(axisGroup);
    }


    createGizmoRotationRing(axis, color, radius) {
        const THREE = window.THREE;
        const ringGroup = new THREE.Group();
        ringGroup.name = 'rotate_' + axis;


        const tubeRadius = 1.5;
        const radialSegments = 8;
        const tubularSegments = 64;
        const arc = Math.PI * 2;

        const geometry = new THREE.TorusGeometry(radius, tubeRadius, radialSegments, tubularSegments, arc);
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.6,
            depthTest: false
        });
        const ring = new THREE.Mesh(geometry, material);





        ring.userData = { isGizmo: true, gizmoAxis: axis, isRotationRing: true, originalColor: color.clone() };

        ringGroup.add(ring);
        this.threeTransformGizmo.add(ringGroup);
    }


    getModelCenter() {
        let centerX = 0, centerY = 0, centerZ = 0, count = 0;
        this.threeObjects.forEach((obj, key) => {
            if (key.startsWith('point_')) {
                centerX += obj.position.x;
                centerY += obj.position.y;
                centerZ += obj.position.z;
                count++;
            }
        });
        if (count > 0) {
            return { x: centerX / count, y: centerY / count, z: centerZ / count };
        }
        return null;
    }


    updateTransformGizmo() {
        if (!this.threeTransformGizmo) return;


        const pivot = this.getTransformPivot();
        const center = pivot ? { x: pivot.x, y: pivot.y, z: pivot.z } : this.getModelCenter();
        if (center) {
            this.threeTransformGizmo.position.set(center.x, center.y, center.z);

            this.threeTransformGizmo.visible = this.showGizmo;


            this.updateGizmoOrientation();
        } else {
            this.threeTransformGizmo.visible = false;
        }

        this.update3DStatus();
    }



    updateGizmoOrientation() {
        if (!this.threeTransformGizmo) return;

        const THREE = window.THREE;
        const basis = this.resolveTransformBasis();
        if (!THREE || !basis?.quaternion) return;


        if (!this._gizmoBaseQuaternions) {
            this._gizmoBaseQuaternions = {
                x: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
                y: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
                z: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0)
            };
        }


        if (!this._tempFinalQuaternion) {
            this._tempFinalQuaternion = new THREE.Quaternion();
        }


        this.threeTransformGizmo.children.forEach(child => {
            if (child.name.startsWith('axis_')) {

                child.setRotationFromQuaternion(basis.quaternion);
            } else if (child.name.startsWith('rotate_')) {

                const axis = child.name.replace('rotate_', '');
                const ring = child.children[0];


                this._tempFinalQuaternion.copy(basis.quaternion);
                this._tempFinalQuaternion.multiply(this._gizmoBaseQuaternions[axis]);
                ring.setRotationFromQuaternion(this._tempFinalQuaternion);
            }
        });
    }


    getGizmoWorldAxis(axis) {
        const THREE = window.THREE;


        if (!this._gizmoAxisVectors) {
            this._gizmoAxisVectors = {
                x: new THREE.Vector3(1, 0, 0),
                y: new THREE.Vector3(0, 1, 0),
                z: new THREE.Vector3(0, 0, 1)
            };
        }


        if (!this._tempAxisVector) {
            this._tempAxisVector = new THREE.Vector3();
        }

        const baseVector = this._gizmoAxisVectors[axis];
        this._tempAxisVector.copy(baseVector);

        const basis = this.resolveTransformBasis();
        if (basis?.quaternion) {
            this._tempAxisVector.applyQuaternion(basis.quaternion);
        }

        return this._tempAxisVector;
    }


    setupTransformGizmoInteraction() {
        if (!this.threeRenderer || !this.threeCamera || !this.threeTransformGizmo) return;

        const THREE = window.THREE;
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();


        let cachedGizmoObjects = null;
        let lastHoveredAxis = null;

        const getGizmoObjects = () => {
            if (!cachedGizmoObjects) {
                cachedGizmoObjects = [];
                this.threeTransformGizmo.traverse(child => {
                    if (child.userData && child.userData.isGizmo) {
                        cachedGizmoObjects.push(child);
                    }
                });
            }
            return cachedGizmoObjects;
        };


        this._clearGizmoCache = () => {
            cachedGizmoObjects = null;
        };


        this.threeRenderer.domElement.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || !this.threeTransformGizmo || !this.threeTransformGizmo.visible) return;

            const rect = this.threeRenderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, this.threeCamera);


            const gizmoObjects = getGizmoObjects();
            const intersects = raycaster.intersectObjects(gizmoObjects);

            if (intersects.length > 0) {

                const target = intersects[0].object;
                const axis = target.userData.gizmoAxis;
                const isRotationRing = target.userData.isRotationRing;

                this.threeTransformGizmoDragging = true;
                this.threeTransformGizmoAxis = axis;
                this.threeIsTransforming = true;
                this.threeTransformGizmoIsRotating = isRotationRing;


                this.threeLastMouse = { x: e.clientX, y: e.clientY };


                if (isRotationRing && intersects[0].point) {
                    this.threeRotationRingClickPoint = intersects[0].point.clone();
                }

                e.preventDefault();
                e.stopPropagation();
            }
        });


        this.threeRenderer.domElement.addEventListener('mousemove', (e) => {
            if (!this.threeTransformGizmoDragging || !this.threeTransformGizmoAxis) return;

            const deltaX = e.clientX - this.threeLastMouse.x;
            const deltaY = e.clientY - this.threeLastMouse.y;

            const THREE = window.THREE;

            if (this.threeTransformGizmoIsRotating) {

                const rotateSpeed = 0.01;


                const axisVector = this.getGizmoWorldAxis(this.threeTransformGizmoAxis);


                const gizmoPos = this.threeTransformGizmo.position.clone();
                const gizmoScreen = gizmoPos.clone().project(this.threeCamera);



                let ringPointWorld;
                if (this.threeRotationRingClickPoint) {

                    ringPointWorld = this.threeRotationRingClickPoint.clone();
                } else {

                    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.threeCamera.quaternion);
                    const tangentDir = new THREE.Vector3().crossVectors(axisVector, cameraUp).normalize();
                    if (tangentDir.length() < 0.001) {
                        const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.threeCamera.quaternion);
                        tangentDir.crossVectors(axisVector, cameraRight).normalize();
                    }
                    ringPointWorld = gizmoPos.clone().add(tangentDir.multiplyScalar(50));
                }


                const radiusDir = new THREE.Vector3().subVectors(ringPointWorld, gizmoPos).normalize();


                const tangentWorld = new THREE.Vector3().crossVectors(axisVector, radiusDir).normalize();


                const tangentEnd = ringPointWorld.clone().add(tangentWorld);
                const tangentEndScreen = tangentEnd.clone().project(this.threeCamera);
                const ringPointScreen = ringPointWorld.clone().project(this.threeCamera);


                const screenTangentX = tangentEndScreen.x - ringPointScreen.x;
                const screenTangentY = tangentEndScreen.y - ringPointScreen.y;


                const screenTangentLength = Math.sqrt(screenTangentX * screenTangentX + screenTangentY * screenTangentY);

                let angle = 0;
                if (screenTangentLength > 0.001) {

                    const normalizedTangentX = screenTangentX / screenTangentLength;
                    const normalizedTangentY = screenTangentY / screenTangentLength;



                    const projection = deltaX * normalizedTangentX - deltaY * normalizedTangentY;




                    const radiusWorld = ringPointWorld.distanceTo(gizmoPos);

                    const worldMove = projection * radiusWorld * 0.01;
                    angle = worldMove * rotateSpeed;
                }


                const selectedPoints = this.get3DSelectedPointObjects();
                const pivot = this.getTransformPivot();
                if (pivot && Math.abs(angle) > 0.0001) {

                    if (!this._tempRotateCenter) {
                        this._tempRotateCenter = new THREE.Vector3();
                        this._tempRelativePos = new THREE.Vector3();
                        this._tempDeltaQuaternion = new THREE.Quaternion();
                    }

                    this._tempRotateCenter.copy(pivot);


                    this._tempDeltaQuaternion.setFromAxisAngle(axisVector, angle);

                    let handled = false;
                    if (selectedPoints.length === 1) {
                        handled = this.rotate3DChainFromJoint(selectedPoints[0], axisVector, angle);
                    }

                    if (!handled) {
                        const targetObjects = this.getTransformTargetObjects();
                        if (selectedPoints.length === 0) {
                            if (!this.threeModelQuaternion) {
                                this.threeModelQuaternion = new THREE.Quaternion();
                            }
                            this.threeModelQuaternion.premultiply(this._tempDeltaQuaternion);
                        }

                        targetObjects.forEach(obj => {
                            this._tempRelativePos.subVectors(obj.position, this._tempRotateCenter);
                            this._tempRelativePos.applyQuaternion(this._tempDeltaQuaternion);
                            obj.position.addVectors(this._tempRotateCenter, this._tempRelativePos);

                            if (obj.userData.pointData) {
                                obj.userData.pointData.x = obj.position.x;
                                obj.userData.pointData.y = obj.position.y;
                                obj.userData.pointData.z = obj.position.z;
                            }
                        });
                    }
                }
            } else {


                const axisVector = this.getGizmoWorldAxis(this.threeTransformGizmoAxis);



                const gizmoPos = this.threeTransformGizmo.position.clone();
                const axisEnd = gizmoPos.clone().add(axisVector);


                const gizmoScreen = gizmoPos.clone().project(this.threeCamera);
                const axisEndScreen = axisEnd.clone().project(this.threeCamera);


                const screenAxisX = axisEndScreen.x - gizmoScreen.x;
                const screenAxisY = axisEndScreen.y - gizmoScreen.y;


                const screenAxisLength = Math.sqrt(screenAxisX * screenAxisX + screenAxisY * screenAxisY);

                let moveDelta = 0;


                if (screenAxisLength > 0.1) {


                    const normalizedScreenAxisX = screenAxisX / screenAxisLength;
                    const normalizedScreenAxisY = screenAxisY / screenAxisLength;




                    const projection = deltaX * normalizedScreenAxisX - deltaY * normalizedScreenAxisY;



                    const worldUnitScreenLength = screenAxisLength;

                    const screenToWorldScale = 1 / worldUnitScreenLength;

                    moveDelta = projection * screenToWorldScale;
                } else {


                    const camera = this.threeCamera;


                    const distance = camera.position.distanceTo(gizmoPos);



                    const fov = camera.fov * (Math.PI / 180);
                    const screenHeight = this.threeRenderer.domElement.clientHeight;
                    const worldSizePerPixel = (2 * distance * Math.tan(fov / 2)) / screenHeight;


                    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
                    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);


                    const worldMove = new THREE.Vector3()
                        .addScaledVector(right, deltaX * worldSizePerPixel)
                        .addScaledVector(up, -deltaY * worldSizePerPixel);


                    moveDelta = worldMove.dot(axisVector);
                }


                const selectedPoints = this.get3DSelectedPointObjects();
                const deltaVector = axisVector.clone().multiplyScalar(moveDelta);
                const ikTarget = selectedPoints.length === 1 && this.threeRigMode === "ik"
                    ? selectedPoints[0].position.clone().add(deltaVector)
                    : null;

                const ikHandled = !!ikTarget && (
                    this.solveTwoBoneIKForTarget(selectedPoints[0], ikTarget) ||
                    this.solveTwoBoneIKForMidTarget(selectedPoints[0], ikTarget)
                );

                if (!ikHandled) {
                    if (selectedPoints.length > 0) {
                        this.translate3DSelection(deltaVector);
                    } else {
                        this.threeObjects.forEach((obj, key) => {
                            if (key.startsWith('point_')) {
                                obj.position.add(deltaVector);

                                if (obj.userData.pointData) {
                                    obj.userData.pointData.x = obj.position.x;
                                    obj.userData.pointData.y = obj.position.y;
                                    obj.userData.pointData.z = obj.position.z;
                                }
                            }
                        });
                    }
                }
            }


            this.updateAll3DLines();
            this.update3DOrbitCenter();
            this.updateTransformGizmo();
            this.update3DSelectionBox();

            this.threeLastMouse = { x: e.clientX, y: e.clientY };

            e.preventDefault();
            e.stopPropagation();
        });


        this.threeRenderer.domElement.addEventListener('mouseup', (e) => {
            if (this.threeTransformGizmoDragging) {
                this.threeTransformGizmoDragging = false;
                this.threeTransformGizmoAxis = null;
                this.threeTransformGizmoIsRotating = false;
                this.threeIsTransforming = false;

                this.threeRotationRingClickPoint = null;
            }
        });


        this.threeRenderer.domElement.addEventListener('mousemove', (e) => {
            if (this.threeTransformGizmoDragging) return;


            if (!this.showGizmo || !this.threeTransformGizmo || !this.threeTransformGizmo.visible) {
                this.threeRenderer.domElement.style.cursor = 'default';

                if (lastHoveredAxis) {
                    const gizmoObjects = getGizmoObjects();
                    gizmoObjects.forEach(child => {
                        if (child.userData && child.userData.isGizmo && child.userData.gizmoAxis === lastHoveredAxis && child.userData.originalColor) {
                            child.material.color.copy(child.userData.originalColor);
                        }
                    });
                    lastHoveredAxis = null;
                }
                return;
            }

            const rect = this.threeRenderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, this.threeCamera);

            const gizmoObjects = getGizmoObjects();
            const intersects = raycaster.intersectObjects(gizmoObjects);

            const currentHoveredAxis = intersects.length > 0 ? intersects[0].object.userData.gizmoAxis : null;


            if (currentHoveredAxis !== lastHoveredAxis) {

                if (lastHoveredAxis) {
                    gizmoObjects.forEach(child => {
                        if (child.userData && child.userData.isGizmo && child.userData.gizmoAxis === lastHoveredAxis && child.userData.originalColor) {
                            child.material.color.copy(child.userData.originalColor);
                        }
                    });
                } else {

                    gizmoObjects.forEach(child => {
                        if (child.userData && child.userData.isGizmo && child.userData.originalColor) {
                            child.material.color.copy(child.userData.originalColor);
                        }
                    });
                }


                if (currentHoveredAxis) {
                    gizmoObjects.forEach(child => {
                        if (child.userData && child.userData.isGizmo && child.userData.gizmoAxis === currentHoveredAxis) {
                            child.material.color.setHex(0xffffff);
                        }
                    });
                }

                lastHoveredAxis = currentHoveredAxis;
            }


            if (intersects.length > 0) {
                const target = intersects[0].object;
                if (target.userData.isRotationRing) {
                    this.threeRenderer.domElement.style.cursor = 'ew-resize';
                } else {
                    this.threeRenderer.domElement.style.cursor = 'move';
                }
            } else {
                this.threeRenderer.domElement.style.cursor = 'default';
            }
        });
    }


    add3DPose() {
        console.log('[OpenPose] add3DPose called, is3DMode:', this.is3DMode);


        this.clear3DPose();


        this.threeCameraState = { ...DEFAULT_THREE_CAMERA_STATE };


        this.threeOrbitCenter = new THREE.Vector3(0, 0, 0);


        if (this.threeCamera) {
            const center = this.threeOrbitCenter;
            const radius = 500;
            const theta = 0;
            const phi = Math.PI / 2;


            this.threeCamera.position.x = center.x + radius * Math.sin(phi) * Math.sin(theta);
            this.threeCamera.position.y = center.y + radius * Math.cos(phi);
            this.threeCamera.position.z = center.z + radius * Math.sin(phi) * Math.cos(theta);
            this.threeCamera.lookAt(center);
        }

        if (!this.threePoseData) {
            this.threePoseData = { points: [], connections: [] };
        }

        const poseId = this.nextPoseId++;


        let centerX = 0, centerY = 0, count = 0;
        DEFAULT_KEYPOINTS.forEach(pt => {
            centerX += pt[0];
            centerY += pt[1];
            count++;
        });
        centerX /= count;
        centerY /= count;

        console.log('[OpenPose] Adding pose with ID:', poseId, 'at center');


        DEFAULT_KEYPOINTS.forEach((pt, index) => {

            const offsetX = pt[0] - centerX;
            const offsetY = pt[1] - centerY;

            this.threePoseData.points.push({
                id: index,
                poseId: poseId,
                x: offsetX,
                y: -offsetY,
                z: 0,
                color: connect_color[index] || [255, 255, 255]
            });
        });


        connect_keypoints.forEach(pair => {
            this.threePoseData.connections.push({
                startId: pair[0],
                endId: pair[1],
                startPoseId: poseId,
                endPoseId: poseId
            });
        });

        console.log('[OpenPose] 3D pose data:', this.threePoseData.points.length, 'points');


        this.render3DPose();
        this.recordInitial3DViewState();
    }


    delete3DSelectedPoints() {
        if (this.threeSelectedObjects.size === 0) return;


        const idsToDelete = new Set();
        this.threeSelectedObjects.forEach(obj => {
            if (obj.userData.pointData) {
                idsToDelete.add(`${obj.userData.pointData.id}_${obj.userData.pointData.poseId}`);
            }
        });


        this.threePoseData.points = this.threePoseData.points.filter(
            p => !idsToDelete.has(`${p.id}_${p.poseId}`)
        );


        this.threePoseData.connections = this.threePoseData.connections.filter(
            c => !idsToDelete.has(`${c.startId}_${c.startPoseId}`) && !idsToDelete.has(`${c.endId}_${c.endPoseId}`)
        );


        this.clear3DSelection();


        this.render3DPose();
    }


    clear3DPose() {

        if (this.threeScene) {
            this.threeObjects.forEach((obj) => {
                this.threeScene.remove(obj);

                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            });
        }
        this.threeObjects.clear();
        this.threeSelectedObjects.clear();
        this.remove3DSelectionBox();


        this.threePoseData = { points: [], connections: [] };
        this.nextPoseId = 0;
        this.initial3DViewState = null;


        if (this.threeModelQuaternion) {
            this.threeModelQuaternion.set(0, 0, 0, 1);
        }


        this.render3DPose();
        this.update3DStatus();
    }

}

if (globalThis[OPENPOSE_EDITOR_BOOTSTRAP_KEY]) {
    console.warn(`[OpenPose3D] Duplicate frontend load skipped: ${import.meta.url}`);
} else {
    globalThis[OPENPOSE_EDITOR_BOOTSTRAP_KEY] = import.meta.url;

app.registerExtension({
    name: OPENPOSE_EDITOR_EXTENSION_NAME,
    setup() {

        api.addEventListener("beforeQueuePrompt", async (event) => {
            const nodes = app.graph.nodes.filter(n => n.type === OPENPOSE_EDITOR_NODE_NAME);
            for (const node of nodes) {
                if (node.openPosePanel && node.openPosePanel.poseDescriptionText) {
                    const text = node.openPosePanel.poseDescriptionText.innerText;

                    if (node.postureTextWidget) {
                        node.postureTextWidget.value = text;
                    }

                    await api.fetchApi("/openpose/set_current_posture_text", {
                        method: "POST",
                        body: JSON.stringify({
                            node_id: node.id,
                            text: text
                        })
                    }).catch(() => {});
                }
            }
        });


        api.addEventListener("openpose_capture_3d", async (event) => {
            const nodeId = event.detail.node_id;
            const width = event.detail.width;
            const height = event.detail.height;

            const node = app.graph.getNodeById(nodeId);
            if (!node || !node.openPosePanel) return;

            const panel = node.openPosePanel;


            if (panel.is3DMode && panel.threeRenderer) {
                try {

                    const gizmoWasVisible = panel.showGizmo;
                    if (panel.threeTransformGizmo) {
                        panel.threeTransformGizmo.visible = false;
                    }


                    panel.threeRenderer.render(panel.threeScene, panel.threeCamera);


                    const imageData = panel.threeRenderer.domElement.toDataURL('image/png');


                    if (panel.threeTransformGizmo && gizmoWasVisible) {
                        panel.threeTransformGizmo.visible = true;
                        panel.threeRenderer.render(panel.threeScene, panel.threeCamera);
                    }


                    await api.fetchApi("/openpose/save_3d_pose_image", {
                        method: "POST",
                        body: JSON.stringify({
                            node_id: nodeId,
                            image_data: imageData
                        })
                    });
                } catch (e) {
                    console.log('[OpenPose] Failed to capture 3D pose image:', e);
                }
            }
        });


        api.addEventListener("openpose_capture_2d", async (event) => {
            const nodeId = event.detail.node_id;
            const width = event.detail.width;
            const height = event.detail.height;

            const node = app.graph.getNodeById(nodeId);
            if (!node || !node.openPosePanel) return;

            const panel = node.openPosePanel;

            try {

                if (panel.is3DMode && panel.threePoseData && panel.threePoseData.points.length > 0) {
                    panel.sync3DTo2DCanvas();
                }


                const imageData = panel.canvas.toDataURL({
                    format: 'png',
                    quality: 1.0,
                    multiplier: 1.0
                });


                await api.fetchApi("/openpose/save_2d_pose_image", {
                    method: "POST",
                    body: JSON.stringify({
                        node_id: nodeId,
                        image_data: imageData
                    })
                });
            } catch (e) {
                console.log('[OpenPose] Failed to capture 2D pose image:', e);
            }
        });

        api.addEventListener("openpose_node_pause", (event) => {
            const nodeId = event.detail.node_id;
            const currentPose = event.detail.current_pose;
            const currentBackgroundImage = event.detail.current_background_image;

            const node = app.graph.getNodeById(nodeId);
            if (!node) return;



            node.is_paused = true;


            if (currentPose && currentPose.trim() !== "") {
                node.setProperty("poses_datas", currentPose);


                if (node.openPosePanel) {
                    void node.openPosePanel.loadJSON(currentPose);
                }
            }

            if (typeof currentBackgroundImage === "string") {
                setNodeBackgroundProperty(node, currentBackgroundImage);

                if (node.openPosePanel) {
                    void node.openPosePanel.applyBackgroundState(currentBackgroundImage, { syncNode: false });
                }
            }


            if (node.openWidget && node.openWidget.callback) {

                if (!node.openPosePanel || !node.openPosePanel.panel || !document.body.contains(node.openPosePanel.panel)) {
                    node.openWidget.callback();
                }
            }


            if (node.openPosePanel && node.openPosePanel.panel) {

                node.openPosePanel.showPauseControls();
            }
        });
    },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== OPENPOSE_EDITOR_NODE_NAME) {
            return
        }

        fabric.Object.prototype.transparentCorners = false;
        fabric.Object.prototype.cornerColor = '#108ce6';
        fabric.Object.prototype.borderColor = '#108ce6';
        fabric.Object.prototype.cornerSize = 10;

        const makePanelDraggable = function (panelElement) {
            let isDragging = false;
            let startX, startY;
            let initialLeft, initialTop;





            panelElement.addEventListener("mousedown", (e) => {
                const rect = panelElement.getBoundingClientRect();


                if (e.clientX > rect.right - 30 && e.clientY > rect.bottom - 30) {
                    return;
                }


                const target = e.target;
                const tagName = target.tagName.toUpperCase();

                if (tagName === 'INPUT' ||
                    tagName === 'BUTTON' ||
                    tagName === 'SELECT' ||
                    tagName === 'TEXTAREA' ||
                    tagName === 'CANVAS') {
                    return;
                }


                if (target.classList.contains('canvas-container')) {
                    return;
                }


                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;



                const computedStyle = window.getComputedStyle(panelElement);
                const currentLeft = rect.left;
                const currentTop = rect.top;


                panelElement.style.transform = "none";
                panelElement.style.position = "fixed";
                panelElement.style.left = currentLeft + "px";
                panelElement.style.top = currentTop + "px";
                panelElement.style.margin = "0";

                panelElement.style.zIndex = "2147483647";

                initialLeft = currentLeft;
                initialTop = currentTop;

                document.body.style.userSelect = "none";
                panelElement.style.cursor = "move";
            });

            window.addEventListener("mousemove", (e) => {
                if (!isDragging) return;

                e.preventDefault();
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;

                panelElement.style.left = (initialLeft + deltaX) + "px";
                panelElement.style.top = (initialTop + deltaY) + "px";
            });

            window.addEventListener("mouseup", () => {
                if (isDragging) {
                    isDragging = false;
                    document.body.style.userSelect = "";
                    panelElement.style.cursor = "default";
                }
            });
        }

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

            if (!this.properties) {
                this.properties = {};
            }
            if (!this.properties.poses_datas) {
                this.properties.poses_datas = "";
            }
            if (!this.properties.posture_description) {
                this.properties.posture_description = "";
            }

            this.serialize_widgets = true;

            this.imageWidget = this.widgets.find(w => w.name === "image");
            this.imageWidget.callback = this.showImage.bind(this);
            this.imageWidget.disabled = true;


            this.bgImageWidget = this.addWidget("text", "backgroundImage", this.properties.backgroundImage || "", () => { }, {});
            if (this.bgImageWidget && this.bgImageWidget.inputEl) {
                this.bgImageWidget.inputEl.style.display = "none";
            }

			this.jsonWidget = this.addWidget("text", "poses_datas", this.properties.poses_datas, "poses_datas");
            if (this.jsonWidget && this.jsonWidget.inputEl) {
                this.jsonWidget.inputEl.style.display = "none";
            }





            this.updateJsonDimensions = (newWidth, newHeight) => {
                updatePoseJsonDimensions(this, newWidth, newHeight);
            };


            const widthWidget = this.widgets?.find(w => w.name === "output_width_for_dwpose");
            const heightWidget = this.widgets?.find(w => w.name === "output_height_for_dwpose");


            const node = this;


            if (widthWidget) {
                let currentWidth = widthWidget.value;
                Object.defineProperty(widthWidget, 'value', {
                    get: function() {
                        return currentWidth;
                    },
                    set: function(newValue) {
                        currentWidth = newValue;

                        if (this.inputEl) {
                            this.inputEl.value = newValue;
                        }

                        const h = heightWidget ? heightWidget.value : 512;
                        console.log(`[OpenPose] Width changed: ${newValue}, height: ${h}`);
                        updatePoseJsonDimensions(node, newValue, h);
                    },
                    configurable: true
                });
            }


            if (heightWidget) {
                let currentHeight = heightWidget.value;
                Object.defineProperty(heightWidget, 'value', {
                    get: function() {
                        return currentHeight;
                    },
                    set: function(newValue) {
                        currentHeight = newValue;

                        if (this.inputEl) {
                            this.inputEl.value = newValue;
                        }

                        const w = widthWidget ? widthWidget.value : 512;
                        console.log(`[OpenPose] Height changed: ${newValue}, width: ${w}`);
                        updatePoseJsonDimensions(node, w, newValue);
                    },
                    configurable: true
                });
            }




            this.matchSizeWidget = this.addWidget("button", "Match Size", null, async () => {
                try {

                    const widthInput = this.inputs?.find(inp => inp.name === "output_width_for_dwpose");
                    const heightInput = this.inputs?.find(inp => inp.name === "output_height_for_dwpose");

                    if (!widthInput?.link && !heightInput?.link) {
                        alert("output_width_for_dwpose and output_height_for_dwpose are not connected to any upstream node.");
                        return;
                    }


                    const subWorkflow = this.buildSubWorkflowForSize();
                    if (!subWorkflow) {
                        console.log("[OpenPose] Failed to build sub-workflow. Please check upstream node connections.");
                        return;
                    }

                    console.log("[OpenPose] Running sub-workflow to fetch width and height...");


                    const response = await api.fetchApi("/prompt", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            prompt: subWorkflow,
                            client_id: api.clientId
                        })
                    });

                    if (response.status !== 200) {
                        throw new Error(`Execution failed: ${response.statusText}`);
                    }

                    const data = await response.json();
                    const promptId = data.prompt_id;


                    const checkExecution = async () => {
                        try {
                            const historyResponse = await api.fetchApi(`/history/${promptId}`);
                            if (historyResponse.status === 200) {
                                const history = await historyResponse.json();
                                if (history[promptId]) {
                                    const outputs = history[promptId].outputs;

                                    let newWidth = null;
                                    let newHeight = null;


                                    for (const [nid, nodeOutput] of Object.entries(outputs)) {
                                        console.log(`[OpenPose] Checking node ${nid} outputs:`, nodeOutput);


                                        const intOutputs = Object.entries(nodeOutput).filter(([k, v]) =>
                                            Array.isArray(v) && v.length === 1 && typeof v[0] === 'number'
                                        );

                                        console.log(`[OpenPose] INT outputs for node ${nid}:`, intOutputs);

                                        if (intOutputs.length >= 2) {

                                            newWidth = intOutputs[0][1][0];
                                            newHeight = intOutputs[1][1][0];
                                            console.log(`[OpenPose] Found width=${newWidth}, height=${newHeight}`);
                                            break;
                                        } else if (intOutputs.length === 1) {

                                            const key = intOutputs[0][0];
                                            const val = intOutputs[0][1][0];
                                            if (key.toLowerCase().includes('width') || (!newWidth && newWidth === null)) {
                                                newWidth = val;
                                                console.log(`[OpenPose] Found width=${newWidth}`);
                                            } else if (key.toLowerCase().includes('height') || (!newHeight && newHeight === null)) {
                                                newHeight = val;
                                                console.log(`[OpenPose] Found height=${newHeight}`);
                                            }
                                        }
                                    }


                                    if (newWidth !== null && newHeight === null) {
                                        for (const [nid, nodeOutput] of Object.entries(outputs)) {
                                            for (const [key, value] of Object.entries(nodeOutput)) {
                                                if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'number') {
                                                    if (key.toLowerCase().includes('height')) {
                                                        newHeight = value[0];
                                                        console.log(`[OpenPose] Found height=${newHeight} from ${key}`);
                                                        break;
                                                    }
                                                }
                                            }
                                            if (newHeight !== null) break;
                                        }
                                    }

                                    if (newWidth !== null && newHeight !== null) {

                                        updatePoseJsonDimensions(this, newWidth, newHeight);
                                        console.log(`[OpenPose] Matched size: width=${newWidth}, height=${newHeight}`);
                                        return true;
                                    } else {
                                        console.log(`[OpenPose] Failed to get a complete size result: width=${newWidth}, height=${newHeight}`);
                                    }
                                }
                            }
                        } catch (e) {
                            console.error("[OpenPose] Failed to inspect execution results:", e);
                        }
                        return false;
                    };


                    let attempts = 0;
                    const maxAttempts = 30;
                    const pollInterval = setInterval(async () => {
                        attempts++;
                        const completed = await checkExecution();
                        if (completed || attempts >= maxAttempts) {
                            clearInterval(pollInterval);
                            if (!completed && attempts >= maxAttempts) {
                                console.error("[OpenPose] Execution timed out. Please check whether the workflow is valid.");
                            }
                        }
                    }, 1000);

                } catch (error) {
                    console.error("[OpenPose] Failed to match size:", error);
                    alert(`Failed to match size: ${error.message}`);
                }
            });
            this.matchSizeWidget.serialize = false;


            this.applyPoseWidget = this.addWidget("button", "Apply Pose", "image", async () => {
                try {

                    if (this.openPosePanel) {

                        await this.openPosePanel.loadFromPoseKeypoint();
                    } else {

                        let poseData = this.properties?.poses_datas;

                        if (!poseData || poseData.trim() === "") {
                            alert("No valid poses_datas data was detected. Please make sure this property has a value.");
                            return;
                        }


                        let poseJson = null;
                        if (typeof poseData === "string") {
                            poseJson = JSON.parse(poseData);
                        } else if (Array.isArray(poseData) || typeof poseData === "object") {
                            poseJson = poseData;
                        }

                        if (!poseJson) {
                            alert("poses_datas data format is invalid.");
                            return;
                        }


                        let canvasWidth = 512;
                        let canvasHeight = 512;
                        if (Array.isArray(poseJson) && poseJson[0]) {
                            canvasWidth = poseJson[0].canvas_width || poseJson[0].width || 512;
                            canvasHeight = poseJson[0].canvas_height || poseJson[0].height || 512;
                        } else if (poseJson.width && poseJson.height) {
                            canvasWidth = poseJson.width;
                            canvasHeight = poseJson.height;
                        }


                        this.setProperty("output_width_for_dwpose", canvasWidth);
                        this.setProperty("output_height_for_dwpose", canvasHeight);


                        const widthWidget = this.widgets?.find(w => w.name === "output_width_for_dwpose");
                        if (widthWidget) {
                            widthWidget.value = canvasWidth;
                            if (widthWidget.callback) widthWidget.callback(canvasWidth);
                            if (widthWidget.inputEl) widthWidget.inputEl.value = canvasWidth;
                        }

                        const heightWidget = this.widgets?.find(w => w.name === "output_height_for_dwpose");
                        if (heightWidget) {
                            heightWidget.value = canvasHeight;
                            if (heightWidget.callback) heightWidget.callback(canvasHeight);
                            if (heightWidget.inputEl) heightWidget.inputEl.value = canvasHeight;
                        }


                        let people = [];
                        if (Array.isArray(poseJson) && poseJson[0]?.people) {
                            people = poseJson[0].people;
                        } else if (poseJson.people) {
                            people = poseJson.people;
                        }

                        if (people.length > 0) {

                            const poseJsonData = JSON.stringify({
                                "width": canvasWidth,
                                "height": canvasHeight,
                                "people": people
                            }, null, 4);

                            this.setProperty("poses_datas", poseJsonData);
                            if (this.jsonWidget) {
                                this.jsonWidget.value = poseJsonData;
                            }


                            this.setDirtyCanvas(true, true);
                            if (app.graph) app.graph.setDirtyCanvas(true, true);
                            if (app.canvas) app.canvas.draw(true);

                        } else {
                            alert("No valid human keypoint data was found in poses_datas.");
                        }
                    }
                } catch (error) {
                    alert(`Failed to apply pose: ${error.message}`);
                }
            });
            this.applyPoseWidget.serialize = false;



            this.buildSubWorkflowForSize = function() {
                const graph = app.graph;
                const nodeId = this.id.toString();


                const widthInput = this.inputs?.find(inp => inp.name === "output_width_for_dwpose");
                const heightInput = this.inputs?.find(inp => inp.name === "output_height_for_dwpose");

                if (!widthInput?.link && !heightInput?.link) {
                    return null;
                }


                const nodesToInclude = new Set();
                const linksToInclude = new Set();


                const addNodeAndDependencies = (node) => {
                    if (!node || nodesToInclude.has(node.id.toString())) return;

                    nodesToInclude.add(node.id.toString());


                    if (node.inputs) {
                        for (const input of node.inputs) {
                            if (input.link) {
                                linksToInclude.add(input.link);
                                const link = graph.links[input.link];
                                if (link) {
                                    const originNode = graph.getNodeById(link.origin_id);
                                    addNodeAndDependencies(originNode);
                                }
                            }
                        }
                    }
                };


                addNodeAndDependencies(this);


                const prompt = {};
                const workflow = { nodes: [], links: [] };

                for (const nid of nodesToInclude) {
                    const node = graph.getNodeById(parseInt(nid));
                    if (node) {

                        const nodeData = node.serialize();
                        prompt[nid] = {
                            inputs: {},
                            class_type: node.type,
                            _meta: {
                                title: node.title
                            }
                        };


                        if (node.widgets_values) {
                            node.widgets_values.forEach((val, idx) => {
                                if (node.widgets && node.widgets[idx]) {
                                    prompt[nid].inputs[node.widgets[idx].name] = val;
                                }
                            });
                        }


                        if (node.inputs) {
                            for (const input of node.inputs) {
                                if (input.link && linksToInclude.has(input.link)) {
                                    const link = graph.links[input.link];
                                    if (link) {
                                        const originId = link.origin_id.toString();
                                        const originSlot = link.origin_slot;
                                        prompt[nid].inputs[input.name] = [originId, originSlot];
                                    }
                                }
                            }
                        }

                        workflow.nodes.push(nodeData);
                    }
                }


                for (const linkId of linksToInclude) {
                    const link = graph.links[linkId];
                    if (link) {
                        workflow.links.push([
                            link.id,
                            link.origin_id,
                            link.origin_slot,
                            link.target_id,
                            link.target_slot
                        ]);
                    }
                }


                const previewNodeId = "preview_" + Date.now();
                prompt[previewNodeId] = {
                    inputs: {
                        images: [nodeId, 0]
                    },
                    class_type: "PreviewImage",
                    _meta: {
                        title: "Preview (OpenPose)"
                    }
                };

                console.log("[OpenPose] Built sub-workflow:", prompt);
                return prompt;
            };

            this.openWidget = this.addWidget("button", "Open Pose Editor", "image", () => {
                const graphCanvas = LiteGraph.LGraphCanvas.active_canvas
                if (graphCanvas == null)
                    return;


                if (this.properties.poses_datas && this.properties.poses_datas.trim() !== "") {
                } else {
                }

                const panel = graphCanvas.createPanel("3D Pose Editor WHK_2D DocKr", { closable: true });
                panel.node = this;
                panel.classList.add("openpose-editor");


                panel.style.width = "900px";
                panel.style.height = "850px";

                const panelHost = document.createElement("div");
                panelHost.className = "openpose-3d-panel-host";
                panelHost.style.cssText = "position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
                document.body.appendChild(panelHost);
                panelHost.appendChild(panel);


                panel.style.position = "fixed";
                panel.style.top = "50%";
                panel.style.left = "50%";
                panel.style.transform = "translate(-50%, -50%)";
                panel.style.zIndex = "2147483647";
                panel.style.pointerEvents = "auto";
                panel.style.boxShadow = "0 0 50px rgba(0,0,0,0.5)";

                this.openPosePanel = new OpenPosePanel(panel, this);
                makePanelDraggable(panel, this.openPosePanel);


                const resizer = document.createElement("div");
                resizer.style.width = "10px";
                resizer.style.height = "10px";
                resizer.style.background = "#888";
                resizer.style.position = "absolute";
                resizer.style.right = "0";
                resizer.style.bottom = "0";
                resizer.style.cursor = "se-resize";
                panel.appendChild(resizer);

                const originalClose = panel.close;
                const openPosePanel = this.openPosePanel;
                let panelClosed = false;
                let isResizing = false;
                const handleResizeMove = (e) => {
                    if (!isResizing) return;
                    const rect = panel.getBoundingClientRect();
                    panel.style.width = `${e.clientX - rect.left}px`;
                    panel.style.height = `${e.clientY - rect.top}px`;
                };
                const handleResizeUp = () => {
                    if (!isResizing) return;
                    isResizing = false;
                    this.openPosePanel?.resizeCanvas();
                };
                const cleanupPanelHost = () => {
                    document.removeEventListener("mousemove", handleResizeMove);
                    document.removeEventListener("mouseup", handleResizeUp);
                    if (panelHost.parentNode) {
                        panelHost.parentNode.removeChild(panelHost);
                    }
                };
                panel.close = async function() {
                    if (panelClosed) {
                        return;
                    }
                    panelClosed = true;

                    if (openPosePanel) {

                        if (openPosePanel.threePoseData && openPosePanel.threePoseData.points.length > 0) {
                            console.log('[OpenPose] Saving 3D pose data:', openPosePanel.threePoseData.points.length, 'points');
                            openPosePanel.node.setProperty("three_pose_data", JSON.parse(JSON.stringify(openPosePanel.threePoseData)));
                        }


                        if (openPosePanel.is3DMode && openPosePanel.threeRenderer) {
                            try {

                                const gizmoWasVisible = openPosePanel.showGizmo;
                                if (openPosePanel.threeTransformGizmo) {
                                    openPosePanel.threeTransformGizmo.visible = false;
                                }


                                openPosePanel.threeRenderer.render(openPosePanel.threeScene, openPosePanel.threeCamera);


                                const imageData3D = openPosePanel.threeRenderer.domElement.toDataURL('image/png');


                                if (openPosePanel.threeTransformGizmo && gizmoWasVisible) {
                                    openPosePanel.threeTransformGizmo.visible = true;
                                    openPosePanel.threeRenderer.render(openPosePanel.threeScene, openPosePanel.threeCamera);
                                }


                                await api.fetchApi("/openpose/save_3d_pose_image", {
                                    method: "POST",
                                    body: JSON.stringify({
                                        node_id: openPosePanel.node.id,
                                        image_data: imageData3D
                                    })
                                });
                                console.log('[OpenPose] Saved 3D pose image for node:', openPosePanel.node.id);
                            } catch (e) {
                                console.log('[OpenPose] Failed to save 3D pose image:', e);
                            }
                        }


                        try {

                            if (openPosePanel.is3DMode && openPosePanel.threePoseData && openPosePanel.threePoseData.points.length > 0) {
                                openPosePanel.sync3DTo2DCanvas();
                            }


                            const imageData = openPosePanel.canvas.toDataURL({
                                format: 'png',
                                quality: 1.0,
                                multiplier: 1.0
                            });


                            await api.fetchApi("/openpose/save_2d_pose_image", {
                                method: "POST",
                                body: JSON.stringify({
                                    node_id: openPosePanel.node.id,
                                    image_data: imageData
                                })
                            });
                            console.log('[OpenPose] Saved 2D pose image for node:', openPosePanel.node.id);
                        } catch (e) {
                            console.log('[OpenPose] Failed to save 2D pose image:', e);
                        }

                        openPosePanel.saveToNode();
                    }
                    if (originalClose) originalClose.call(panel);
                    cleanupPanelHost();
                };

                resizer.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    isResizing = true;
                });

                document.addEventListener("mousemove", handleResizeMove);
                document.addEventListener("mouseup", handleResizeUp);
            });
            this.openWidget.serialize = false;



            requestAnimationFrame(async () => {
                if (this.imageWidget.value) {
                    await this.setImage(this.imageWidget.value);
                }


                const widthWidget = this.widgets?.find(w => w.name === "output_width_for_dwpose");
                const heightWidget = this.widgets?.find(w => w.name === "output_height_for_dwpose");
                if (widthWidget && heightWidget && this.updateJsonDimensions) {
                    this.updateJsonDimensions(widthWidget.value, heightWidget.value);
                }
            });
        }

        const onExecuted = nodeType.prototype.onExecuted;
		nodeType.prototype.onExecuted = function (message) {

			if (onExecuted) {
				onExecuted.apply(this, arguments);
			}


			let dataUpdated = false;

			if (message && message.poses_datas && message.poses_datas.length > 0) {
				const poseData = message.poses_datas[0];
				if (poseData && poseData.trim() !== "") {
					this.setProperty("poses_datas", poseData);

					const poseShape = message.dw_pose_shape && message.dw_pose_shape[0] ? message.dw_pose_shape[0] : [];
					if (poseShape.length >= 4) {
						const height = poseShape[1];
						const width = poseShape[2];

						console.log(`[OpenPose] onExecuted updated size: width=${width}, height=${height}`);

						this.setProperty("output_width_for_dwpose", width);
						this.setProperty("output_height_for_dwpose", height);

						const widthWidget = this.widgets?.find(w => w.name === "output_width_for_dwpose");
						if (widthWidget) {
							widthWidget.value = width;
							if (widthWidget.callback) widthWidget.callback(width);
						}

						const heightWidget = this.widgets?.find(w => w.name === "output_height_for_dwpose");
						if (heightWidget) {
							heightWidget.value = height;
							if (heightWidget.callback) heightWidget.callback(height);
						}


						updatePoseJsonDimensions(this, width, height);
					}

					if (this.imageWidget) {
						this.imageWidget.value = poseData;
					}
					if (this.jsonWidget) {
						this.jsonWidget.value = poseData;
					}


					requestAnimationFrame(async () => {
						if (this.imageWidget.value && message.editdPose && message.editdPose[0]) {

							if (this.openPosePanel) {
								await this.setImage(message.editdPose[0]);
							}
						}
					});

					dataUpdated = true;
				}
			}

				if (message && message.backgroundImage && message.backgroundImage.length > 0) {
					const bgImage = typeof message.backgroundImage[0] === "string" ? message.backgroundImage[0] : "";
					setNodeBackgroundProperty(this, bgImage);
					dataUpdated = true;
				}

				if (message && message.inputPose && message.inputPose.length > 0) {
					const bgImage = message.inputPose[0];
					if (bgImage && bgImage.trim() !== "") {
						setNodeBackgroundProperty(this, bgImage);
						dataUpdated = true;
					}
				}

			if (dataUpdated && this.openPosePanel) {
				void (async () => {
					if (this.properties.poses_datas && this.properties.poses_datas.trim() !== "") {
						await this.openPosePanel.loadJSON(this.properties.poses_datas);
					}

					await this.openPosePanel.applyBackgroundState(this.properties.backgroundImage, { syncNode: false });
				})();
			}

			if (dataUpdated) {
				app.graph.setDirtyCanvas(true, true);
				this.onResize?.(this.size);
				app.canvas.draw(true);
			}

			this.setDirtyCanvas(true, true);
		}
        nodeType.prototype.showImage = async function (name) {
            let folder_separator = name.lastIndexOf("/");
            let subfolder = "";
            if (folder_separator > -1) {
                subfolder = name.substring(0, folder_separator);
                name = name.substring(folder_separator + 1);
            }
            const img = await loadImageAsync(`/view?filename=${name}&type=input&subfolder=${subfolder}&t=${Date.now()}`);
            if (!img) {
                return;
            }
            this.imgs = [img];
            app.graph.setDirtyCanvas(true);
        }

        nodeType.prototype.setImage = async function (name) {
            this.imageWidget.value = name;
            await this.showImage(name);
        }

        const baseOnPropertyChanged = nodeType.prototype.onPropertyChanged;
        nodeType.prototype.onPropertyChanged = function (property, value, prev) {
            console.log(`[OpenPose] onPropertyChanged: ${property} = ${value}`);
            if (property === "poses_datas" && this.jsonWidget) {
                this.jsonWidget.value = value;
            } else if (property === "output_width_for_dwpose" || property === "output_height_for_dwpose") {

                const width = property === "output_width_for_dwpose" ? value : this.properties?.output_width_for_dwpose;
                const height = property === "output_height_for_dwpose" ? value : this.properties?.output_height_for_dwpose;
                console.log(`[OpenPose] Detected size change, updating: width=${width}, height=${height}`);
                updatePoseJsonDimensions(this, width, height);
            } else if (baseOnPropertyChanged) {
                baseOnPropertyChanged.call(this, property, value, prev);
            }
        };


        const baseOnConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, slotIndex, isConnected, link, input) {
            console.log(`[OpenPose] onConnectionsChange: type=${type}, slot=${slotIndex}, connected=${isConnected}`);


            if (baseOnConnectionsChange) {
                baseOnConnectionsChange.call(this, type, slotIndex, isConnected, link, input);
            }


            setTimeout(() => {

                const inputs = this.inputs || [];
                let widthInputIndex = -1;
                let heightInputIndex = -1;

                inputs.forEach((inp, idx) => {
                    if (inp.name === "output_width_for_dwpose") {
                        widthInputIndex = idx;
                    } else if (inp.name === "output_height_for_dwpose") {
                        heightInputIndex = idx;
                    }
                });

                console.log(`[OpenPose] widthInputIndex=${widthInputIndex}, heightInputIndex=${heightInputIndex}`);


                if (type === LiteGraph.INPUT) {
                    const widthWidget = this.widgets?.find(w => w.name === "output_width_for_dwpose");
                    const heightWidget = this.widgets?.find(w => w.name === "output_height_for_dwpose");

                    const currentWidth = widthWidget ? widthWidget.value : this.properties?.output_width_for_dwpose;
                    const currentHeight = heightWidget ? heightWidget.value : this.properties?.output_height_for_dwpose;

                    console.log(`[OpenPose] Updated after connection change: width=${currentWidth}, height=${currentHeight}`);
                    updatePoseJsonDimensions(this, currentWidth, currentHeight);
                }
            }, 100);
        };

    }
});
}
