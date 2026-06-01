from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
import numpy as np
import cv2
from PIL import Image
import io
import easyocr

app = FastAPI()
reader = easyocr.Reader(['en','nl'], gpu=False)


def to_gray(img):
    if len(img.shape) == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return img


def deskew_image(img):
    gray = to_gray(img)
    coords = cv2.findNonZero(cv2.bitwise_not(cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]))
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
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
    cl = clahe.apply(gray)
    return cl


def denoise(img):
    return cv2.fastNlMeansDenoising(img, None, 10, 7, 21)


def sharpen(img):
    blur = cv2.GaussianBlur(img, (0,0), 3)
    sharpened = cv2.addWeighted(img, 1.6, blur, -0.6, 0)
    return sharpened


def threshold_binary(img):
    _, th = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return th


def normalize_text_confidence(text: str, conf: float, threshold: float = 0.6):
    # EasyOCR gives a single confidence per text; spread it over chars
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
async def ocr(image: UploadFile = File(...)):
    try:
        contents = await image.read()
        pil = Image.open(io.BytesIO(contents)).convert('RGB')
        arr = np.array(pil)[:, :, ::-1].copy()
    except Exception as e:
        raise HTTPException(status_code=400, detail='Invalid image')

    # Preprocessing pipeline
    img = arr
    img = deskew_image(img)
    img = adaptive_contrast(img)
    img = denoise(img)
    img = sharpen(img)
    bin_img = threshold_binary(img)

    # Run EasyOCR
    try:
        results = reader.readtext(bin_img)
    except Exception as e:
        raise HTTPException(status_code=500, detail='OCR failed')

    if not results:
        return JSONResponse({'text': 'GEEN TEKST GEVONDEN'})

    lines = []
    for bbox, txt, conf in results:
        normalized = normalize_text_confidence(txt, conf, threshold=0.6)
        if normalized:
            lines.append(normalized)

    final = '\n'.join(lines).strip()
    if not final:
        final = 'GEEN TEKST GEVONDEN'

    return JSONResponse({'text': final})
