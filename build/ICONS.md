# Adding a Custom App Icon

Drop your icon as **`build/icon.png`** (512×512 or 1024×1024, square PNG).
`electron-builder` auto-converts it to `.ico` (Windows) and `.icns` (macOS).

## Generate from a source image

```bash
# 1. Put your 1024×1024 PNG here:
#    build/icon.png

# 2. Build — electron-builder handles the conversion automatically
npm run electron:build
```

## Online converters (if needed manually)

- PNG → ICO: https://www.icoconverter.com  
- PNG → ICNS: https://cloudconvert.com/png-to-icns

## Building without a custom icon

The build works without any icon — the stock Electron icon is used.
Add `build/icon.png` any time and rebuild to apply your branding.
