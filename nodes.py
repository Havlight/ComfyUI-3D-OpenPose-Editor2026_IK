import os.path
import folder_paths
from nodes import LoadImage, interrupt_processing
import json
import time
import numpy as np
import torch
import cv2
import math
import random
from PIL import Image
from server import PromptServer
from aiohttp import web

# ====================================================================================================
# API 路由处理：暂停与恢复
# ====================================================================================================
PAUSED_NODES = {}

routes = PromptServer.instance.routes

class AnyType(str):
    """A special type that always compares equal to any value."""

    def __ne__(self, __value: object) -> bool:
        return False

any_type = AnyType("*")

@routes.post('/openpose/update_pose')
async def openpose_update_pose(request):
    try:
        json_data = await request.json()
        node_id = str(json_data.get('node_id')) # 强制转字符串
        pose_data = json_data.get('pose_data')
        
        if node_id in PAUSED_NODES:
            PAUSED_NODES[node_id] = {
                'status': 'resume',
                'data': pose_data
            }
            return web.json_response({"status": "success", "message": "Resuming execution"})
        else:
             return web.json_response({"status": "error", "message": "Node not paused"}, status=400)
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@routes.post('/openpose/cancel')
async def openpose_cancel(request):
    try:
        json_data = await request.json()
        node_id = str(json_data.get('node_id')) # 强制转字符串
        
        if node_id in PAUSED_NODES:
            PAUSED_NODES[node_id] = {
                'status': 'cancel'
            }
            return web.json_response({"status": "success", "message": "Cancelling execution"})
        else:
             return web.json_response({"status": "error", "message": "Node not paused"}, status=400)
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

# 存储3D姿态截图
POSE_3D_IMAGES = {}

# 存储最新的姿态描述（按节点ID）
POSTURE_DESCRIPTIONS = {}

@routes.post('/openpose/save_3d_pose_image')
async def openpose_save_3d_pose_image(request):
    try:
        json_data = await request.json()
        node_id = str(json_data.get('node_id'))
        image_data = json_data.get('image_data')  # base64编码的图片
        
        if image_data:
            # 解码base64图片
            import base64
            image_bytes = base64.b64decode(image_data.split(',')[1] if ',' in image_data else image_data)
            
            # 保存到临时文件
            temp_dir = folder_paths.get_input_directory()
            filename = f"openpose_3d_pose_{node_id}_{int(time.time() * 1000)}.png"
            filepath = os.path.join(temp_dir, filename)
            
            with open(filepath, 'wb') as f:
                f.write(image_bytes)
            
            # 存储文件名
            POSE_3D_IMAGES[node_id] = filename
            
            # 通知后端截图已完成
            if node_id + "_capture" in POSE_3D_IMAGES:
                POSE_3D_IMAGES[node_id + "_capture"] = {"status": "success", "filename": filename}
            
            return web.json_response({"status": "success", "filename": filename})
        else:
            return web.json_response({"status": "error", "message": "No image data"}, status=400)
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

# 存储当前显示的姿态描述（按节点ID）
CURRENT_POSTURE_TEXTS = {}

@routes.post('/openpose/set_current_posture_text')
async def openpose_set_current_posture_text(request):
    """前端设置当前显示的姿态文本"""
    try:
        json_data = await request.json()
        node_id = str(json_data.get('node_id'))
        text = json_data.get('text', '')
        
        CURRENT_POSTURE_TEXTS[node_id] = text
        
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@routes.get('/openpose/get_current_posture_text')
async def openpose_get_current_posture_text(request):
    """获取前端当前显示的姿态文本"""
    try:
        node_id = str(request.query.get('node_id', ''))
        text = CURRENT_POSTURE_TEXTS.get(node_id, '')
        
        return web.json_response({"status": "success", "text": text})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@routes.post('/openpose/save_2d_pose_image')
async def openpose_save_2d_pose_image(request):
    """保存2D姿态截图"""
    try:
        json_data = await request.json()
        node_id = str(json_data.get('node_id'))
        image_data = json_data.get('image_data')  # base64编码的图片
        
        if image_data:
            # 解码base64图片
            import base64
            image_bytes = base64.b64decode(image_data.split(',')[1] if ',' in image_data else image_data)
            
            # 保存到临时文件
            temp_dir = folder_paths.get_input_directory()
            filename = f"openpose_2d_pose_{node_id}_{int(time.time() * 1000)}.png"
            filepath = os.path.join(temp_dir, filename)
            
            with open(filepath, 'wb') as f:
                f.write(image_bytes)
            
            # 存储文件名（使用_2d后缀区分）
            POSE_3D_IMAGES[node_id + "_2d"] = filename
            
            # 通知后端截图已完成
            if node_id + "_capture_2d" in POSE_3D_IMAGES:
                POSE_3D_IMAGES[node_id + "_capture_2d"] = {"status": "success", "filename": filename}
            
            return web.json_response({"status": "success", "filename": filename})
        else:
            return web.json_response({"status": "error", "message": "No image data"}, status=400)
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

# ====================================================================================================
# 常量定义
# ====================================================================================================
LIMB_SEQ = [[2, 3], [2, 6], [3, 4], [4, 5], [6, 7], [7, 8], [2, 9], [9, 10], [10, 11], [2, 12], [12, 13], [13, 14], [2, 1], [1, 15], [15, 17], [1, 16], [16, 18]]

COLORS = [[255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85]]


# 【最终整合版】OpenPose Editor 节点
# ====================================================================================================
class OpenPoseEditor:
    _last_fingerprints = {}

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("STRING", { "default": "" }),
            },
            "optional": {
                "pose_image": ("IMAGE",),
                "pose_point": ("POSE_KEYPOINT",),
                "prev_image": ("IMAGE",),
                "bridge_anything": (any_type,),  # 改为IMAGE类型
                "output_width_for_dwpose": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "output_height_for_dwpose": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "scale_for_xinsr_for_dwpose": ("BOOLEAN", {"default": True}),
                "stop_for_edit": ("BOOLEAN", {"default": False, "label_on": "Pause for Edit", "label_off": "No Pause"}),
            },
            "hidden": {
                "backgroundImage": ("STRING", {"multiline": False}),
                "poses_datas": ("STRING", {"multiline": True, "rows": 10, "placeholder": "Pose JSON data will be stored here..."}),
                "unique_id": "UNIQUE_ID",
            }
        }
    
    # 【优化】IS_CHANGED：只在参数变化时返回不同值，避免每次强制重新执行
    @classmethod
    def IS_CHANGED(cls, *args, **kwargs):
        """
        兼容任意参数传入：
        - *args 接收位置参数
        - **kwargs 接收所有关键字参数
        只在参数真正变化时才返回不同的值
        """
        # 1. 提取核心参数（兼容任意传入方式）
        image = kwargs.get("image", args[0] if args else "")
        output_width_for_dwpose = kwargs.get("output_width_for_dwpose", 512)
        output_height_for_dwpose = kwargs.get("output_height_for_dwpose", 512)
        scale_for_xinsr_for_dwpose = kwargs.get("scale_for_xinsr_for_dwpose", True)
        stop_for_edit = kwargs.get("stop_for_edit", False)
        
        backgroundImage = kwargs.get("backgroundImage", "")
        poses_datas = kwargs.get("poses_datas", "")
        
        # 处理IMAGE类型参数的哈希（用内存地址+形状）
        def get_image_hash(img_tensor):
            if img_tensor is None:
                return 0
            try:
                # 组合内存地址+张量形状，确保唯一性
                return hash(f"{id(img_tensor)}_{str(img_tensor.shape)}")
            except:
                return hash(id(img_tensor))
        
        bridge_anything_hash = get_image_hash(kwargs.get("bridge_anything"))
        prev_image_hash = get_image_hash(kwargs.get("prev_image"))
        pose_image_hash = get_image_hash(kwargs.get("pose_image"))
        pose_hash = hash(str(kwargs.get("pose_point"))) if kwargs.get("pose_point") else 0

        # 2. 生成指纹（不包含时间戳和随机数，只在参数变化时变化）
        fingerprint = (
            f"{image}-{pose_hash}-{pose_image_hash}-{prev_image_hash}-{bridge_anything_hash}-"
            f"{output_width_for_dwpose}-{output_height_for_dwpose}-{scale_for_xinsr_for_dwpose}-{stop_for_edit}-"
            f"{backgroundImage}-{poses_datas}"
        )
        
        return fingerprint

    # 输出定义
    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "INT", "INT", "STRING",)
    RETURN_NAMES = ("dw_pose_image", "dw_comb_image", "3DposeImage", "2DposeImage", "dw_pose_image_width", "dw_pose_image_height", "Posture Text")
    FUNCTION = "get_images"
    CATEGORY = "image"
    
    # POSE_KEYPOINT转JSON
    def pose_point_to_json(self, pose_point, image_tensor):
        if not pose_point or not isinstance(pose_point, list):
            return ""
        
        if image_tensor.shape[0] == 0:
            return ""
        
        image_height = image_tensor.shape[1]
        image_width = image_tensor.shape[2]
        
        processed_people = []
        for result_dict in pose_point:
            people_in_dict = result_dict.get("people", [])
            for person in people_in_dict:
                original_keypoints = person.get("pose_keypoints_2d", [])
                body_keypoints = [0.0] * 54 
                num_points_to_copy = min(18, len(original_keypoints) // 3)
                for i in range(num_points_to_copy):
                    base_idx = i * 3
                    x = original_keypoints[base_idx]
                    y = original_keypoints[base_idx + 1]
                    confidence = original_keypoints[base_idx + 2]
                    if confidence > 0:
                        absolute_x = x * image_width
                        absolute_y = y * image_height
                        body_keypoints[base_idx] = absolute_x
                        body_keypoints[base_idx + 1] = absolute_y
                        body_keypoints[base_idx + 2] = confidence
                processed_people.append({
                    "pose_keypoints_2d": body_keypoints
                })
        
        data_to_save = {
            "width": int(image_width),
            "height": int(image_height),
            "people": processed_people
        }
        return json.dumps(data_to_save, indent=4)
    
    # 渲染DWPose
    def render_dw_pose(self, pose_json, width, height, scale_for_xinsr):
        if not pose_json or not pose_json.strip():
            return np.zeros((height, width, 3), dtype=np.uint8)
        try:
            data = json.loads(pose_json)
        except json.JSONDecodeError:
            return np.zeros((height, width, 3), dtype=np.uint8)

        target_w, target_h = width, height
        original_w, original_h = data.get('width', target_w), data.get('height', target_h)
        scale_x, scale_y = target_w / original_w, target_h / original_h

        canvas = np.zeros((target_h, target_w, 3), dtype=np.uint8)
        people = data.get('people', [])
        if not people:
            return canvas

        BASE_RESOLUTION_SIDE = 512.0
        base_thickness = 2.0
        target_max_side = max(target_w, target_h)
        scale_factor = target_max_side / BASE_RESOLUTION_SIDE
        scaled_joint_radius = int(max(1, base_thickness * scale_factor))
        scaled_stickwidth = scaled_joint_radius

        if scale_for_xinsr:
            xinsr_stick_scale = 1 if target_max_side < 500 else min(2 + (target_max_side // 1000), 7)
            scaled_stickwidth *= xinsr_stick_scale

        for person in people:
            keypoints_flat = person.get('pose_keypoints_2d', [])
            keypoints = [ (int(keypoints_flat[i] * scale_x), int(keypoints_flat[i+1] * scale_y)) if keypoints_flat[i+2] > 0 else None for i in range(0, len(keypoints_flat), 3) ]
            
            for limb_indices, color in zip(LIMB_SEQ, COLORS):
                k1_idx, k2_idx = limb_indices[0] - 1, limb_indices[1] - 1
                if k1_idx >= len(keypoints) or k2_idx >= len(keypoints): continue
                p1, p2 = keypoints[k1_idx], keypoints[k2_idx]
                if p1 is None or p2 is None: continue
                
                Y, X = np.array([p1[0], p2[0]]), np.array([p1[1], p2[1]])
                mX, mY = np.mean(X), np.mean(Y)
                length = np.sqrt((X[0] - X[1])**2 + (Y[0] - Y[1])**2)
                angle = math.degrees(math.atan2(X[0] - X[1], Y[0] - Y[1]))
                
                polygon = cv2.ellipse2Poly((int(mY), int(mX)), (int(length / 2), scaled_stickwidth), int(angle), 0, 360, 1)
                cv2.fillConvexPoly(canvas, polygon, [int(c * 0.6) for c in color])

            for i, keypoint in enumerate(keypoints):
                if keypoint is None: continue
                if i >= len(COLORS): continue
                cv2.circle(canvas, keypoint, scaled_joint_radius, COLORS[i], thickness=-1)
        
        return cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)

    # 主函数：处理bridge_anything（IMAGE类型）
    def get_images(self, image, output_width_for_dwpose, output_height_for_dwpose, scale_for_xinsr_for_dwpose, 
                    stop_for_edit, backgroundImage, poses_datas, bridge_anything=None, prev_image=None, pose_image=None, pose_point=None, 
                    unique_id=None):
        # 安全性检查：确保核心字符串参数不为 None
        if backgroundImage is None:
            backgroundImage = ""
        if poses_datas is None:
            poses_datas = ""

        # 清理缓存
        if hasattr(folder_paths, 'cache') and isinstance(folder_paths.cache, dict):
            folder_paths.cache.clear()
        
        # 处理bridge_anything（新增：保存为临时文件）
        if bridge_anything is not None and bridge_anything.shape[0] > 0:
            try:
                import time
                bridge_np = (bridge_anything[0].cpu().numpy() * 255).astype(np.uint8)
                bridge_pil = Image.fromarray(bridge_np)
                temp_dir = folder_paths.get_input_directory()
                bridge_filename = f"openpose_bridge_temp_{int(time.time() * 1000)}.png"
                bridge_filepath = os.path.join(temp_dir, bridge_filename)
                bridge_pil.save(bridge_filepath)
                # 可选择将bridge作为背景图使用
                # backgroundImage = bridge_filename
            except Exception as e:
                pass
        
        # 1. 转换pose_point为JSON
        converted_pose_json = ""
        if pose_point is not None and pose_image is not None:
            converted_pose_json = self.pose_point_to_json(pose_point, pose_image)
            if converted_pose_json:
                try:
                    pose_json = json.loads(converted_pose_json)
                    output_width_for_dwpose = pose_json.get("width", output_width_for_dwpose)
                    output_height_for_dwpose = pose_json.get("height", output_height_for_dwpose)
                except json.JSONDecodeError:
                    pass
	
        # 2. 保存pose_image为临时文件
        if pose_image is not None and pose_image.shape[0] > 0:
            try:
                import time
                pose_image_np = (pose_image[0].cpu().numpy() * 255).astype(np.uint8)
                pose_image_pil = Image.fromarray(pose_image_np)
                temp_dir = folder_paths.get_input_directory()
                bg_filename = f"openpose_lg_temp_{int(time.time() * 1000)}.png"
                bg_filepath = os.path.join(temp_dir, bg_filename)
                pose_image_pil.save(bg_filepath)
            except Exception as e:
                pass
            
        # 3. 保存prev_image为临时文件
        ld_filepath= None
        if prev_image is not None and prev_image.shape[0] > 0:
            try:
                import time
                prev_image_np = (prev_image[0].cpu().numpy() * 255).astype(np.uint8)
                prev_image_pil = Image.fromarray(prev_image_np)
                temp_dir = folder_paths.get_input_directory()
                ld_filename = f"openpose_ld_temp_{int(time.time() * 1000)}.png"
                ld_filepath = os.path.join(temp_dir, ld_filename)
                prev_image_pil.save(ld_filepath)
                backgroundImage = ld_filename
            except Exception as e:
                pass
        
        # 4. 更新poses_datas (关键修复：确保从输入连接获取的姿态数据被使用)
        if converted_pose_json:
            poses_datas = converted_pose_json

        # ============================================================
        # 暂停/断点逻辑 (Stop for Edit)
        # ============================================================
        if stop_for_edit and unique_id:
            node_str_id = str(unique_id) # 强制转字符串
            
            # 初始化暂停状态
            # 关键修复：将当前的 poses_datas (可能刚从输入连接更新) 放入状态中
            # 这样前端如果查询状态，或者后端需要知道当前数据
            PAUSED_NODES[node_str_id] = {'status': 'waiting', 'initial_data': poses_datas}
            
            # 发送暂停消息给前端
            # 关键修复：把最新的 pose 数据也发给前端，让前端有机会刷新编辑器
            # 同时发送最新的背景图片路径
            PromptServer.instance.send_sync("openpose_node_pause", {
                "node_id": node_str_id, 
                "current_pose": poses_datas,  # 携带最新的姿态数据
                "current_background_image": backgroundImage # 携带最新的背景图片路径
            })
            
            # 阻塞循环
            while True:
                if node_str_id not in PAUSED_NODES:
                    # 异常情况，状态丢失
                    break
                    
                state = PAUSED_NODES[node_str_id]
                status = state.get('status')
                
                if status == 'resume':
                    # 获取前端传回的新数据
                    new_pose_data = state.get('data')
                    if new_pose_data:
                        poses_datas = new_pose_data
                        # 尝试更新尺寸
                        try:
                            pd = json.loads(new_pose_data)
                            output_width_for_dwpose = pd.get("width", output_width_for_dwpose)
                            output_height_for_dwpose = pd.get("height", output_height_for_dwpose)
                        except:
                            pass
                    # 清理状态
                    del PAUSED_NODES[node_str_id]
                    break
                
                elif status == 'cancel':
                    del PAUSED_NODES[node_str_id]
                    # 使用 ComfyUI 推荐的方式中断执行
                    interrupt_processing()
                    return (torch.zeros(1, 512, 512, 3), {}, torch.zeros(1, 512, 512, 3)) # 返回空数据防止立即报错
                
                time.sleep(0.1)
            
        # --- 输出1: 纯DWPose渲染图 ---
        dw_pose_np = self.render_dw_pose(poses_datas, output_width_for_dwpose, output_height_for_dwpose, scale_for_xinsr_for_dwpose)
        dw_pose_image = torch.from_numpy(dw_pose_np.astype(np.float32) / 255.0).unsqueeze(0).clone()
        
        # 保存DWPose渲染图
        dw_bg_filename = ""
        try:
            dw_pose_image_pil = Image.fromarray(dw_pose_np)
            temp_dir = folder_paths.get_input_directory()
            import time
            dw_bg_filename = f"openpose_dw_bg_temp_{int(time.time() * 1000)}.png"
            dw_bg_filepath = os.path.join(temp_dir, dw_bg_filename)
            dw_pose_image_pil.save(dw_bg_filepath)
        except Exception as e:
            pass

        # --- 输出2: DWPose+背景合成图 ---
        dw_combined_image = dw_pose_image.clone()
        if backgroundImage and backgroundImage.strip() != "":
            bg_image_path = folder_paths.get_annotated_filepath(backgroundImage)
            if os.path.exists(bg_image_path):
                try:
                    bg_image_pil = Image.open(bg_image_path).convert("RGB")
                    bg_image_np = np.array(bg_image_pil)
                    bg_image_resized = cv2.resize(bg_image_np, (output_width_for_dwpose, output_height_for_dwpose), interpolation=cv2.INTER_AREA)
                    
                    dw_pose_gray = cv2.cvtColor(dw_pose_np, cv2.COLOR_RGB2GRAY)
                    _, mask = cv2.threshold(dw_pose_gray, 1, 255, cv2.THRESH_BINARY)
                    dw_combined_np = bg_image_resized.copy()
                    dw_combined_np[mask != 0] = dw_pose_np[mask != 0]
                    dw_combined_image = torch.from_numpy(dw_combined_np.astype(np.float32) / 255.0).unsqueeze(0).clone()
                except Exception as e:
                    pass
        
        # --- 输出3: 3D姿态图 ---
        # 首先尝试从存储中获取3D姿态截图（如果编辑器打开过并保存了）
        pose_3d_image = None
        node_str_id = str(unique_id) if unique_id else ""
        
        # 从存储中读取3D截图（如果存在）
        if node_str_id and node_str_id in POSE_3D_IMAGES:
            try:
                pose_3d_filename = POSE_3D_IMAGES[node_str_id]
                pose_3d_path = os.path.join(folder_paths.get_input_directory(), pose_3d_filename)
                if os.path.exists(pose_3d_path):
                    pose_3d_pil = Image.open(pose_3d_path).convert("RGB")
                    pose_3d_np = np.array(pose_3d_pil)
                    # 调整尺寸以匹配输出尺寸
                    if pose_3d_np.shape[0] != output_height_for_dwpose or pose_3d_np.shape[1] != output_width_for_dwpose:
                        pose_3d_np = cv2.resize(pose_3d_np, (output_width_for_dwpose, output_height_for_dwpose), interpolation=cv2.INTER_AREA)
                    pose_3d_image = torch.from_numpy(pose_3d_np.astype(np.float32) / 255.0).unsqueeze(0)
            except Exception as e:
                pass
        
        # 如果没有保存的截图，使用DWPose渲染图（与dw_pose_image相同）
        if pose_3d_image is None:
            pose_3d_image = dw_pose_image.clone()
        
        # --- 输出4: 2D姿态图 ---
        # 首先尝试从存储中获取2D姿态截图（如果编辑器打开过并保存了）
        pose_2d_image = None
        
        # 从存储中读取2D截图（如果存在）
        if node_str_id and node_str_id + "_2d" in POSE_3D_IMAGES:
            try:
                pose_2d_filename = POSE_3D_IMAGES[node_str_id + "_2d"]
                pose_2d_path = os.path.join(folder_paths.get_input_directory(), pose_2d_filename)
                if os.path.exists(pose_2d_path):
                    pose_2d_pil = Image.open(pose_2d_path).convert("RGB")
                    pose_2d_np = np.array(pose_2d_pil)
                    # 调整尺寸以匹配输出尺寸
                    if pose_2d_np.shape[0] != output_height_for_dwpose or pose_2d_np.shape[1] != output_width_for_dwpose:
                        pose_2d_np = cv2.resize(pose_2d_np, (output_width_for_dwpose, output_height_for_dwpose), interpolation=cv2.INTER_AREA)
                    pose_2d_image = torch.from_numpy(pose_2d_np.astype(np.float32) / 255.0).unsqueeze(0)
            except Exception as e:
                pass
        
        # 如果没有保存的截图，使用DWPose渲染图（与dw_pose_image相同）
        if pose_2d_image is None:
            pose_2d_image = dw_pose_image.clone()
        
        # 构建UI数据
        import time
        import random
        timestamp = str(time.time() * 1000)
        random_str = str(random.randint(0, 999999))
        ui_data = {
            "poses_datas": [poses_datas],
            "editdPose": [dw_bg_filename],
            "inputPose": [ld_filepath or ""],
            "backgroundImage": [backgroundImage],
            "refresh_trigger": [f"{timestamp}_{random_str}"],
            "dw_pose_shape": [list(dw_pose_image.shape)],
            "combined_shape": [list(dw_combined_image.shape)],
            "dw_pose_width": [output_width_for_dwpose],
            "dw_pose_height": [output_height_for_dwpose]
        }
        
        # 从poses_datas JSON中读取姿态描述
        posture_text = ""
        if poses_datas:
            try:
                pose_data = json.loads(poses_datas)
                if isinstance(pose_data, dict) and "posture_description" in pose_data:
                    posture_text = pose_data["posture_description"]
            except:
                pass
        
        # 返回结果
        return {
            "ui": ui_data,
            "result": (dw_pose_image, dw_combined_image, pose_3d_image, pose_2d_image, output_width_for_dwpose, output_height_for_dwpose, posture_text)
        }
    
    # 生成姿态文字描述
    def generate_posture_description(self, poses_datas):
        if not poses_datas:
            return "无姿态数据"
        
        try:
            data = json.loads(poses_datas)
            people = data.get("people", [])
            if not people:
                return "无人物姿态"
            
            # 获取第一个人的关键点
            person = people[0]
            keypoints = person.get("pose_keypoints_2d", [])
            if not keypoints or len(keypoints) < 39:
                return "关键点数据不完整"
            
            descriptions = []
            
            # 获取关键点坐标（COCO格式：x, y, confidence）
            def get_point(idx):
                base = idx * 3
                if base + 2 < len(keypoints) and keypoints[base + 2] > 0:
                    return {"x": keypoints[base], "y": keypoints[base + 1]}
                return None
            
            # 获取关键部位
            nose = get_point(0)
            left_shoulder = get_point(5)
            right_shoulder = get_point(6)
            left_hip = get_point(11)
            right_hip = get_point(12)
            left_knee = get_point(13)
            right_knee = get_point(14)
            left_ankle = get_point(15)
            right_ankle = get_point(16)
            
            # 判断身体姿态
            if left_shoulder and right_shoulder and left_hip and right_hip:
                shoulder_y = (left_shoulder["y"] + right_shoulder["y"]) / 2
                hip_y = (left_hip["y"] + right_hip["y"]) / 2
                
                # 身体倾斜判断
                body_tilt = abs(shoulder_y - hip_y)
                if body_tilt < 0.1:
                    descriptions.append("身体水平")
                elif shoulder_y < hip_y - 0.1:
                    descriptions.append("身体前倾")
                elif shoulder_y > hip_y + 0.1:
                    descriptions.append("身体后仰")
                else:
                    descriptions.append("身体直立")
            
            # 判断腿部姿态
            if left_hip and left_knee:
                left_knee_forward = left_knee["y"] - left_hip["y"]
                if left_knee_forward < -0.1:
                    descriptions.append("左膝盖抬起")
            
            if right_hip and right_knee:
                right_knee_forward = right_knee["y"] - right_hip["y"]
                if right_knee_forward < -0.1:
                    descriptions.append("右膝盖抬起")
            
            # 判断双腿分开
            if left_knee and right_knee:
                knee_distance = abs(left_knee["x"] - right_knee["x"])
                if knee_distance > 0.15:
                    descriptions.append("双腿分开")
                elif knee_distance < 0.05:
                    descriptions.append("双腿并拢")
            
            if descriptions:
                return "，".join(descriptions)
            else:
                return "标准姿态"
                
        except Exception as e:
            return f"姿态解析错误: {str(e)}"

# ====================================================================================================
# SavePoseToJson 节点
# ====================================================================================================
class SavePoseToJson:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "pose_point": ("POSE_KEYPOINT",),      # 姿态关键点数据（包含canvas尺寸）
                "filename_prefix": ("STRING", {"default": "poses/pose"})  # 保存文件名前缀
            },
            "optional": {
                "pose_image": ("IMAGE",),  # 可选保存图片
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("filename",)
    FUNCTION = "save_json"
    OUTPUT_NODE = True
    CATEGORY = "image"

    def save_json(self, pose_point, filename_prefix="pose", pose_image=None):
        # ========== 核心修改：从pose_point获取canvas尺寸 ==========
        image_width = 512  # 默认值
        image_height = 512 # 默认值
        
        # 解析pose_point获取canvas尺寸
        if pose_point and isinstance(pose_point, list) and len(pose_point) > 0:
            # 取第一个元素（对应你的JSON数组中的第一个对象）
            first_pose_data = pose_point[0]
            if isinstance(first_pose_data, dict):
                # 从pose数据中读取canvas尺寸
                image_width = first_pose_data.get("canvas_width", 512)
                image_height = first_pose_data.get("canvas_height", 512)

        # ========== 处理姿态关键点数据 ==========
        processed_people = []
        if pose_point and isinstance(pose_point, list) and len(pose_point) > 0:
            for result_dict in pose_point:
                # 安全获取 people 列表
                people_in_dict = result_dict.get("people", []) if isinstance(result_dict, dict) else []
                for person in people_in_dict:
                    if not isinstance(person, dict):
                        continue
                        
                    # 获取原始关键点并初始化输出数组
                    original_keypoints = person.get("pose_keypoints_2d", [])
                    body_keypoints = [0.0] * 54  # 18个关键点 × 3（x,y,confidence）
                    
                    # 复制并转换关键点（相对坐标 → 绝对坐标）
                    num_points_to_copy = min(18, len(original_keypoints) // 3)
                    for i in range(num_points_to_copy):
                        base_idx = i * 3
                        # 安全取值（避免索引越界）
                        if base_idx + 2 >= len(original_keypoints):
                            continue
                            
                        x = original_keypoints[base_idx]
                        y = original_keypoints[base_idx + 1]
                        confidence = original_keypoints[base_idx + 2]
                        
                        if confidence > 0 and image_width > 0 and image_height > 0:
                            # 相对坐标（0-1）转换为绝对像素坐标
                            absolute_x = x * image_width
                            absolute_y = y * image_height
                            body_keypoints[base_idx] = absolute_x
                            body_keypoints[base_idx + 1] = absolute_y
                            body_keypoints[base_idx + 2] = confidence
                    
                    processed_people.append({
                        "pose_keypoints_2d": body_keypoints
                    })

        # ========== 保存 JSON 文件 ==========
        # 构建要保存的数据（保留canvas尺寸信息）
        data_to_save = {
            "width": int(image_width),
            "height": int(image_height),
            "canvas_width": int(image_width),   # 兼容保留原字段
            "canvas_height": int(image_height), # 兼容保留原字段
            "people": processed_people
        }

        # 生成保存路径和文件名
        output_dir = folder_paths.get_output_directory()
        full_output_folder, filename, _, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, output_dir, image_width, image_height
        )
        
        # 确保保存文件夹存在
        os.makedirs(full_output_folder, exist_ok=True)
        
        # 处理文件计数器（避免重复）
        counter = 1
        try:
            existing_files = [f for f in os.listdir(full_output_folder) 
                             if f.startswith(filename + "_") and f.endswith(".json")]
            if existing_files:
                max_counter = 0
                for f in existing_files:
                    try:
                        num_str = f[len(filename)+1:-5]  # 提取数字部分
                        num = int(num_str)
                        if num > max_counter:
                            max_counter = num
                    except ValueError:
                        continue
                counter = max_counter + 1
        except FileNotFoundError:
            pass

        # 保存文件（UTF-8编码，兼容中文）
        final_filename = f"{filename}_{counter:05d}.json"
        file_path = os.path.join(full_output_folder, final_filename)

        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data_to_save, f, indent=4, ensure_ascii=False)

        result_filename = os.path.join(subfolder, final_filename) if subfolder else final_filename

        # ========== 保存图片文件 (新增功能) ==========
        if pose_image is not None:
            try:
                # 处理 batch 中的第一张图片
                img_tensor = pose_image[0]
                i = 255. * img_tensor.cpu().numpy()
                img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
                
                image_filename = f"{filename}_{counter:05d}.png"
                image_file_path = os.path.join(full_output_folder, image_filename)
                
                img.save(image_file_path)
            except Exception as e:
                pass
        
        return {"ui": {"text": [result_filename]}, "result": (result_filename,)}


# ====================================================================================================
# 节点注册 + 修复TextConcatenator警告的全局方案
# ====================================================================================================
NODE_CLASS_MAPPINGS = {
    "Nui.OpenPoseEditor": OpenPoseEditor,
    "SavePoseToJson": SavePoseToJson
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Nui.OpenPoseEditor": "whk_3DPose_edit_2D_DocKr",
    "SavePoseToJson": "Save Pose to JSON (from Keypoint)"
}

# 【关键】全局修复TextConcatenator的IS_CHANGED警告（一次性解决）
try:
    from nodes import TextConcatenator
    # 重写TextConcatenator的IS_CHANGED方法，兼容所有参数
    original_tc_is_changed = TextConcatenator.IS_CHANGED
    @classmethod
    def fixed_tc_is_changed(cls, *args, **kwargs):
        return original_tc_is_changed(cls, *args, **kwargs) if callable(original_tc_is_changed) else str(time.time())
    TextConcatenator.IS_CHANGED = fixed_tc_is_changed
except ImportError:
    pass