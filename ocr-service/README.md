PaddleOCR microservice

Requirements
- Python 3.9+
- Create a venv and install via `pip install -r requirements.txt`

Run
```
uvicorn main:app --host 0.0.0.0 --port 8000
```

Endpoints
- `GET /health` - health check
- `POST /ocr` - multipart form upload (`image` field) returns JSON `{ "text": "..." }`

Notes
- Service performs preprocessing (deskew, CLAHE, denoise, sharpen, threshold) before running PaddleOCR.
- Low-confidence characters (confidence < 0.6) are replaced with `?`.
- If no readable text remains, the service returns `GEEN TEKST GEVONDEN` as `text`.