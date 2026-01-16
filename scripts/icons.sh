#!/bin/bash

# Electron Icon Generator Script
# Usage: ./generate-icons.sh input-image.png [output-directory]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo -e "${RED}❌ ImageMagick is not installed.${NC}"
    echo "Install it with:"
    echo "  macOS: brew install imagemagick"
    echo "  Ubuntu/Debian: sudo apt-get install imagemagick"
    echo "  CentOS/RHEL: sudo yum install ImageMagick"
    exit 1
fi

# Check arguments
if [ $# -eq 0 ]; then
    echo "Usage: $0 <input-image> [output-directory]"
    echo "Example: $0 logo.png ./icons"
    exit 1
fi

INPUT_FILE="$1"
OUTPUT_DIR="${2:-./icons}"

# Check if input file exists
if [ ! -f "$INPUT_FILE" ]; then
    echo -e "${RED}❌ Input file not found: $INPUT_FILE${NC}"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo -e "${BLUE}🎨 Generating icons from: $INPUT_FILE${NC}"
echo -e "${BLUE}📁 Output directory: $OUTPUT_DIR${NC}"

# Get input image dimensions
INPUT_SIZE=$(identify -format "%wx%h" "$INPUT_FILE")
echo -e "${BLUE}📐 Input image size: $INPUT_SIZE${NC}"

# Define icon sizes
PNG_SIZES=(16 32 48 64 96 128 192 256 512 1024)
ICO_SIZES=(16 32 48 64 128 256)
ICNS_SIZES=(16 32 64 128 256 512 1024)
FAVICON_SIZES=(16 32 48)

echo -e "\n${YELLOW}📋 Generating PNG files...${NC}"

# Generate individual PNG files
for size in "${PNG_SIZES[@]}"; do
    output_file="$OUTPUT_DIR/icon-${size}x${size}.png"
    convert "$INPUT_FILE" -resize "${size}x${size}" -background transparent "$output_file"
    echo -e "${GREEN}  ✅ Generated: icon-${size}x${size}.png${NC}"
done

# Generate main icon.png (512x512)
convert "$INPUT_FILE" -resize "512x512" -background transparent "$OUTPUT_DIR/icon.png"
echo -e "${GREEN}  ✅ Generated: icon.png (512x512)${NC}"

echo -e "\n${YELLOW}🌐 Generating favicon sizes...${NC}"

# Generate favicon sizes
for size in "${FAVICON_SIZES[@]}"; do
    output_file="$OUTPUT_DIR/favicon-${size}x${size}.png"
    convert "$INPUT_FILE" -resize "${size}x${size}" -background transparent "$output_file"
    echo -e "${GREEN}  ✅ Generated: favicon-${size}x${size}.png${NC}"
done

# Generate Windows ICO file
echo -e "\n${YELLOW}🪟 Generating Windows ICO...${NC}"

# Create temporary PNG files for ICO
ICO_TEMP_DIR="$OUTPUT_DIR/temp_ico"
mkdir -p "$ICO_TEMP_DIR"

for size in "${ICO_SIZES[@]}"; do
    convert "$INPUT_FILE" -resize "${size}x${size}" -background transparent "$ICO_TEMP_DIR/icon-${size}.png"
done

# Combine into ICO file
convert "$ICO_TEMP_DIR"/icon-*.png "$OUTPUT_DIR/icon.ico"
echo -e "${GREEN}  ✅ Generated: icon.ico${NC}"

# Clean up temporary files
rm -rf "$ICO_TEMP_DIR"

# Generate macOS ICNS file
echo -e "\n${YELLOW}🍎 Generating macOS ICNS...${NC}"

if [[ "$OSTYPE" == "darwin"* ]] && command -v iconutil &> /dev/null; then
    # Create iconset directory
    ICONSET_DIR="$OUTPUT_DIR/icon.iconset"
    mkdir -p "$ICONSET_DIR"

    # Generate required iconset files
    convert "$INPUT_FILE" -resize "16x16" -background transparent "$ICONSET_DIR/icon_16x16.png"
    convert "$INPUT_FILE" -resize "32x32" -background transparent "$ICONSET_DIR/icon_16x16@2x.png"
    convert "$INPUT_FILE" -resize "32x32" -background transparent "$ICONSET_DIR/icon_32x32.png"
    convert "$INPUT_FILE" -resize "64x64" -background transparent "$ICONSET_DIR/icon_32x32@2x.png"
    convert "$INPUT_FILE" -resize "128x128" -background transparent "$ICONSET_DIR/icon_128x128.png"
    convert "$INPUT_FILE" -resize "256x256" -background transparent "$ICONSET_DIR/icon_128x128@2x.png"
    convert "$INPUT_FILE" -resize "256x256" -background transparent "$ICONSET_DIR/icon_256x256.png"
    convert "$INPUT_FILE" -resize "512x512" -background transparent "$ICONSET_DIR/icon_256x256@2x.png"
    convert "$INPUT_FILE" -resize "512x512" -background transparent "$ICONSET_DIR/icon_512x512.png"
    convert "$INPUT_FILE" -resize "1024x1024" -background transparent "$ICONSET_DIR/icon_512x512@2x.png"

    # Convert iconset to icns
    iconutil -c icns "$ICONSET_DIR"

    # Clean up iconset directory
    rm -rf "$ICONSET_DIR"

    echo -e "${GREEN}  ✅ Generated: icon.icns${NC}"
else
    echo -e "${YELLOW}  ⚠️  iconutil not available. Using PNG fallback for macOS.${NC}"
    convert "$INPUT_FILE" -resize "512x512" -background transparent "$OUTPUT_DIR/icon-macos.png"
    echo -e "${GREEN}  ✅ Generated: icon-macos.png${NC}"
fi

# Generate usage instructions
echo -e "\n${YELLOW}📖 Generating usage instructions...${NC}"

cat > "$OUTPUT_DIR/README.md" << 'EOF'
# Generated Icons

This directory contains all the icons generated for your Electron app.

## Usage in Electron

### Main Process (src/main.js)
```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  // Set dock icon (macOS only)
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, '../icons/icon.png'));
  }

  createWindow();
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../icons/icon.png'), // Cross-platform
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
}
```

### Forge Configuration (forge.config.js)
```javascript
module.exports = {
  packagerConfig: {
    icon: './icons/icon', // Don't include extension
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        iconUrl: 'https://example.com/icon.ico',
        setupIcon: './icons/icon.ico'
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
      config: {
        icon: './icons/icon.icns'
      }
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: './icons/icon.png'
        }
      }
    }
  ]
};
```

## Files Generated

- `icon.png` - Main icon (512x512) - use for development
- `icon.ico` - Windows icon
- `icon.icns` - macOS icon (requires macOS + iconutil)
- `icon-{size}x{size}.png` - Individual PNG files for various sizes
- `favicon-{size}x{size}.png` - Favicon sizes for web contexts

## Platform Recommendations

- **Windows**: Use `icon.ico` or `icon.png`
- **macOS**: Use `icon.icns` or `icon.png`
- **Linux**: Use `icon.png`
- **Development**: Use `icon.png` for all platforms

## Tips

1. The input image should be at least 512x512 or 1024x1024 for best results
2. Use a square image with transparent background
3. Keep the design simple - it will be scaled down to 16x16
4. Test your icon at different sizes to ensure it looks good
EOF

echo -e "${GREEN}  ✅ Generated: README.md${NC}"

echo -e "\n${GREEN}🎉 Icon generation complete!${NC}"
echo -e "${BLUE}📖 Check $OUTPUT_DIR/README.md for usage instructions.${NC}"

# List generated files
echo -e "\n${BLUE}📁 Generated files:${NC}"
ls -la "$OUTPUT_DIR" | grep -E '\.(png|ico|icns|md)$' | awk '{print "  " $9 " (" $5 " bytes)"}'
