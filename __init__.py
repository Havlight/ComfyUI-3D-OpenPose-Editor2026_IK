import sys
import subprocess
import os
import importlib.util

def check_and_install_dependencies():
    # 获取当前文件所在目录
    current_dir = os.path.dirname(os.path.abspath(__file__))
    requirements_path = os.path.join(current_dir, "requirements.txt")
    
    if not os.path.exists(requirements_path):
        return

    try:
        with open(requirements_path, 'r') as f:
            requirements = [line.strip() for line in f if line.strip() and not line.startswith('#')]
        
        for req in requirements:
            # 简单的包名提取 (例如 "numpy<2" -> "numpy")
            pkg_name = req.split('==')[0].split('>=')[0].split('<=')[0].split('<')[0].split('>')[0].strip()
            
            # 特殊处理 opencv
            if pkg_name == "opencv-python":
                pkg_name = "cv2"
            elif pkg_name == "Pillow":
                pkg_name = "PIL"
            
            spec = importlib.util.find_spec(pkg_name)
            if spec is None:
                try:
                    subprocess.check_call([sys.executable, "-m", "pip", "install", req])
                except Exception:
                    pass
                
    except Exception:
        pass

# 执行依赖检查
check_and_install_dependencies()

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
import time

WEB_DIRECTORY = "./js"
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']

# 添加时间戳强制刷新缓存
JS_FILE_TIMESTAMP = str(int(time.time()))
