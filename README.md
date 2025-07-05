# DJI Fly Stream Viewer

A desktop application for receiving and viewing live streaming from DJI drones on PC. Receives RTMP streaming from DJI Fly app and provides stable viewing experience. Despite the name including "DJI", this is a generic RTMP streaming receiver that also works with OBS and other streaming software.

![DJI Fly Stream Viewer](https://img.shields.io/badge/DJI-Fly%20Stream%20Viewer-blue?style=for-the-badge&logo=dji)
![Version](https://img.shields.io/badge/version-v1.0.8-green?style=for-the-badge)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey?style=for-the-badge)

## 🎯 Key Features

- **📡 RTMP Stream Reception**: Receives streaming from DJI Fly app, OBS, and other streaming software
- **🎥 Quality Streaming**: Multiple quality modes for optimal viewing experience
- **📱 DJI Goggles 3 Support**: Detailed connection guide included
- **🌐 Web UI**: User-friendly interface with real-time controls
- **⚡ Resolution Conversion**: Real-time resolution adjustment and optimization
- **🔧 H.264 Encoding**: Fixed H.264 encoding errors for stable streaming
- **🤝 Cross-Platform**: Support for both OBS and DJI with unified streaming paths

## 🚀 Quick Start

### 1. Installation & Launch

#### macOS (Recommended)
1. Download the latest `.dmg` file from [Releases](https://github.com/takatronix/djifly-viewer/releases)
2. Choose the correct version for your Mac:
   - **Intel Mac**: `DJI Fly Stream Viewer-1.0.8.dmg`
   - **Apple Silicon (M1/M2/M3/M4)**: `DJI Fly Stream Viewer-1.0.8-arm64.dmg`
3. Double-click the downloaded `.dmg` file
4. Drag "DJI Fly Stream Viewer" to the Applications folder
5. Launch "DJI Fly Stream Viewer" from Applications

#### Windows
1. Download `DJI Fly Stream Viewer Setup 1.0.8.exe` from [Releases](https://github.com/takatronix/djifly-viewer/releases)
2. Double-click the downloaded `.exe` file
3. Follow the installation wizard
4. Launch "DJI Fly Stream Viewer" from Desktop or Start Menu

### 2. Configure DJI Fly App

1. Open DJI Fly app
2. Go to Settings → Live Streaming
3. Select "Custom RTMP"
4. Connect your DJI Goggles to DJI Fly
5. Enter RTMP URL: `rtmp://[displayed IP address]/live/s`
6. Click "GO LIVE" to start streaming

### 3. Configure OBS Studio

1. Open OBS Studio
2. Go to Settings → Stream
3. Set Service to "Custom"
4. Set Server to: `rtmp://[displayed IP address]/live`
5. Set Stream Key to: `s`
6. Click "Start Streaming"

### 4. Start Viewing

The application will automatically detect the stream and start playback. You can also manually select quality modes from the interface.

## 📋 Detailed Usage

### RTMP Streaming Settings

| Setting | Recommended Value |
|---------|-------------------|
| Resolution | 1080p (High Quality) / 720p (Stability Focus) |
| Bitrate | 2-4 Mbps |
| Frame Rate | 30fps |
| Codec | H.264 |

### Quality Modes

- **🎥 Standard Quality (1080p)**: High quality with optimal stability
- **⚡ Enhanced 720p**: Optimized quality with good performance
- **⚡ Enhanced 480p**: Optimized for lower bandwidth environments

### Resolution Presets

| Resolution | Use Case |
|------------|----------|
| Original | Preserves source quality |
| 720p | Balanced quality and performance |
| 480p | Low bandwidth environments |

## 🛠️ System Requirements

### Minimum Requirements
- **OS**: macOS 10.14+ / Windows 10+
- **CPU**: Intel Core i3 / Apple M1 or equivalent
- **Memory**: 4GB RAM
- **Network**: Wired LAN recommended

### Recommended Requirements
- **OS**: macOS 12.0+ / Windows 11+
- **CPU**: Intel Core i5 / Apple M1 Pro or equivalent
- **Memory**: 8GB RAM
- **Network**: Gigabit Ethernet

## 📱 Compatible Devices

### DJI Drones
- DJI Mini 3 / Mini 3 Pro / Mini 4 Pro
- DJI Air 2S / Air 3
- DJI Mavic 3 Series
- DJI FPV Series
- DJI Avata Series

### DJI Goggles
- DJI Goggles 3
- DJI Goggles 2
- DJI FPV Goggles V2

### Streaming Software
- DJI Fly App
- OBS Studio
- Streamlabs OBS
- XSplit

## 🔧 Troubleshooting

### Stream Connection Issues
1. Check firewall settings
2. Verify ports 1935, 8000, 8081 are open
3. Ensure devices are on the same network
4. Try restarting the application

### Video Playback Issues
1. Switch from Wi-Fi to wired connection
2. Lower resolution (720p → 480p)
3. Try standard quality mode instead of enhanced modes
4. Clear browser cache and reload

### Audio Issues
1. Check browser audio settings
2. Verify DJI Fly app audio settings
3. Check system volume settings
4. Ensure audio codec is supported

### Port Usage Check
```bash
# Check ports in use
lsof -i :1935 -i :8000 -i :8081
```

### Log Inspection
```bash
# View application logs (development mode)
npm run electron
# Check console for error messages
```

## 🏗️ Development Information

### Project Structure
```
dji-fly-viewer/
├── electron/          # Electron main process
│   └── main.js
├── public/            # Web frontend
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── dji-goggles3-guide.html
├── server.js          # Node.js server
├── package.json       # Dependencies & build config
└── dist/             # Built applications
```

### Key Dependencies
- **node-media-server**: RTMP server implementation
- **express**: Web server framework
- **electron**: Desktop application wrapper
- **ffmpeg-static**: Video conversion engine

### Development Commands
```bash
# Install dependencies
npm install

# Start development mode
npm run electron

# Start server only
npm start

# Build macOS DMG
npm run build-mac

# Build Windows installer
npm run build-win

# Build all platforms
npm run build-all
```

### API Endpoints
```
GET  /api/streams        # Active streams list
GET  /api/server-info    # Server information (IP, etc.)
POST /api/stream/resolution/:streamKey/:resolution  # Resolution conversion
POST /api/stream/stop-conversion/:streamKey         # Stop resolution conversion
```

## 📄 License

MIT License

## 🤝 Contributing

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Create a Pull Request

## 📞 Support

### Issue Reporting
- Report issues on [GitHub Issues](https://github.com/takatronix/djifly-viewer/issues)
- Please include the following information in bug reports:
  - OS & Version
  - DJI drone/goggles model
  - Error messages
  - Steps to reproduce

### Feature Requests
- Post feature requests on [GitHub Discussions](https://github.com/takatronix/djifly-viewer/discussions)

## 🔗 Related Links

- [DJI Official Website](https://www.dji.com/)
- [DJI Fly App](https://www.dji.com/downloads/djiapp/dji-fly)
- [FFmpeg Official Website](https://ffmpeg.org/)
- [Node Media Server](https://github.com/illuspas/Node-Media-Server)

## 📝 Release Notes

### v1.0.8 (Latest)
- ✅ **Fixed DJI compatibility**: Corrected stream URL paths for DJI devices
- ✅ **Fixed OBS compatibility**: Maintained compatibility with OBS Studio
- ✅ **H.264 encoding fix**: Resolved H.264 encoding errors
- ✅ **Stream processing improvements**: Fixed RTMP input URLs for resolution conversion
- ✅ **Cross-platform support**: Windows x64/ia32 and macOS Intel/ARM64

### v1.0.7
- ✅ **UI layout improvements**: Moved status display, reduced font size
- ✅ **Resolution fixes**: Changed resolution heights to even numbers

---

**🚁 Enjoy your drone streaming with DJI Fly Stream Viewer!**