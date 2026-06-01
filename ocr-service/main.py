def adaptive_contrast(img):
def denoise(img):
def sharpen(img):
def threshold_binary(img):
def normalize_text_confidence(text: str, conf: float, threshold: float = 0.6):
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
import numpy as np
import cv2
from PIL import Image
import io
from paddleocr import PaddleOCR

app = FastAPI()
# Initialize PaddleOCR (CPU). For better languages/models adjust accordingly.
ocr = PaddleOCR(use_angle_cls=True, lang='en')


def to_gray(img):
    if len(img.shape) == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return img


def deskew_image(img):
    gray = to_gray(img)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    coords = cv2.findNonZero(cv2.bitwise_not(thresh))
    if coords is None:
        return img
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    if abs(angle) < 0.4:
        return img
    (h, w) = img.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return rotated


def adaptive_contrast(img):
    gray = to_gray(img)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    cl = clahe.apply(gray)
    return cl


def denoise(img):
    return cv2.fastNlMeansDenoising(img, None, 10, 7, 21)


def sharpen(img):
    blur = cv2.GaussianBlur(img, (0, 0), 3)
    sharpened = cv2.addWeighted(img, 1.6, blur, -0.6, 0)
    return sharpened


def threshold_binary(img):
    _, th = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return th


def normalize_text_confidence(text: str, conf: float, threshold: float = 0.6):
    if not text or len(text.strip()) == 0:
        return ""
    chars = []
    for ch in text:
        if ch.isalnum():
            chars.append(ch if conf >= threshold else '?')
        else:
            chars.append(ch)
    out = ''.join(chars).strip()
    return out


@app.get('/health')
async def health():
    return JSONResponse({'status': 'ok'})


@app.post('/ocr')
async def ocr_endpoint(image: UploadFile = File(...)):
    try:
        contents = await image.read()
        pil = Image.open(io.BytesIO(contents)).convert('RGB')
        arr = np.array(pil)[:, :, ::-1].copy()
    except Exception:
        raise HTTPException(status_code=400, detail='Invalid image')

    # Preprocessing pipeline
    img = arr
    img = deskew_image(img)
    img = adaptive_contrast(img)
    img = denoise(img)
    img = sharpen(img)
    bin_img = threshold_binary(img)

    # Run PaddleOCR
    try:
        results = ocr.ocr(bin_img, cls=True)
    except Exception:
        raise HTTPException(status_code=500, detail='OCR failed')

    # results is list of lists: each item -> [box, (text, confidence)] or similar
    lines = []
    for item in results:
        # paddle may return nested lists
        if not item:
            continue
        # item could be [box, (text, conf)] or list of such
        if isinstance(item[0][0], (list, tuple)):
            # nested structure
            for sub in item:
                text = sub[1][0] if len(sub) > 1 and isinstance(sub[1], (list, tuple)) else ''
                conf = float(sub[1][1]) if len(sub) > 1 and isinstance(sub[1], (list, tuple)) else 0.0
                normalized = normalize_text_confidence(text, conf, threshold=0.6)
                if normalized:
                    lines.append(normalized)
        else:
            # expected [box, (text, conf)]
            pair = item[1] if len(item) > 1 else None
            if pair:
                text = pair[0] if len(pair) > 0 else ''
                conf = float(pair[1]) if len(pair) > 1 else 0.0
                normalized = normalize_text_confidence(text, conf, threshold=0.6)
                if normalized:
                    lines.append(normalized)

    final = '\n'.join(lines).strip()
    if not final:
        final = 'GEEN TEKST GEVONDEN'

    return JSONResponse({'text': final})
