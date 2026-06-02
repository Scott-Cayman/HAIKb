from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional
import shutil
import os
import logging

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1"

logger = logging.getLogger(__name__)


class OCRService:
    """图片文字识别服务，使用 Tesseract OCR。"""

    def __init__(self):
        self._initialized = False

    def _initialize(self):
        if self._initialized:
            return
        
        import pytesseract
        
        # 查找tesseract的完整路径
        tesseract_path = shutil.which('tesseract')
        if tesseract_path:
            logger.info(f"Found tesseract at: {tesseract_path}")
            pytesseract.pytesseract.tesseract_cmd = tesseract_path
        else:
            logger.warning("Could not find tesseract command")
        
        self._initialized = True

    def extract_text_from_image(self, image_path: str | Path) -> Dict[str, object]:
        """
        从图片中提取文字。

        Args:
            image_path: 图片文件路径

        Returns:
            包含识别文本的字典
        """
        self._initialize()
        
        image_path_str = str(image_path)
        logger.info(f"Starting OCR for image: {image_path_str}")
        
        try:
            import pytesseract
            from PIL import Image
            
            # 检查文件是否存在
            if not os.path.exists(image_path_str):
                raise FileNotFoundError(f"Image file not found: {image_path_str}")
            
            # 打开图片
            logger.info(f"Opening image file")
            img = Image.open(image_path_str)
            
            # 使用 Tesseract 识别，支持中英文
            logger.info(f"Running tesseract OCR")
            text = pytesseract.image_to_string(img, lang='chi_sim+eng')
            
            combined_text = text.strip()
            logger.info(f"OCR completed, extracted {len(combined_text)} characters")
            
            # 简单的置信度判断
            parse_confidence = "high" if len(combined_text) > 50 else (
                "medium" if len(combined_text) > 10 else "low"
            )
            
        except Exception as e:
            logger.exception(f"Error during OCR processing: {str(e)}")
            combined_text = ""
            parse_confidence = "low"
        
        return {
            "text": combined_text,
            "page_count": 1,
            "parsed_pages": 1,
            "parse_confidence": parse_confidence,
            "image_path": image_path_str,
        }


ocr_service = OCRService()
