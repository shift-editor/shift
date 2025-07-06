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
