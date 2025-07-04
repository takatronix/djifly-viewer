const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow;

// Run server in main process instead of child process
const NodeMediaServer = require('node-media-server');
const express = require('express');

let nms;
let expressApp;
let server;
let serverProcess;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false
        },
        show: false // Don't show until ready
    });

    // Start the server in main process
    startServer();

    // Wait for server to be ready
    let retryCount = 0;
    const loadApp = () => {
        console.log(`Loading app... (attempt ${retryCount + 1})`);
        mainWindow.loadURL('http://localhost:8080').then(() => {
            console.log('App loaded successfully');
            mainWindow.show(); // Show window when loaded
        }).catch((error) => {
            console.error('Load error:', error);
            if (retryCount < 15) {
                retryCount++;
                setTimeout(loadApp, 2000);
            } else {
                console.error('Failed to load app after 15 retries');
                mainWindow.show();
            }
        });
    };
    
    // Wait for server startup
    setTimeout(loadApp, 3000);

    // Build menu
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Quit',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        mainWindow.reload();
                    }
                },
                {
                    label: 'Toggle DevTools',
                    accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
                    click: () => {
                        mainWindow.webContents.toggleDevTools();
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Log when window is ready
    mainWindow.webContents.once('dom-ready', () => {
        console.log('DOM ready');
    });

    // Debug: Check if server is responding
    const checkServer = () => {
        const http = require('http');
        const req = http.get('http://localhost:8080', (res) => {
            console.log('Server check: HTTP', res.statusCode);
        });
        req.on('error', (err) => {
            console.log('Server check failed:', err.message);
        });
        req.setTimeout(1000);
    };
    
    setTimeout(checkServer, 2000);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    stopServer();
    app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

app.on('before-quit', () => {
    stopServer();
});

function startServer() {
    try {
        // Start server.js as a child process
        const { spawn } = require('child_process');
        const path = require('path');
        
        const serverPath = path.join(__dirname, '../server.js');
        console.log('Starting server.js at:', serverPath);
        
        serverProcess = spawn('node', [serverPath], {
            stdio: 'inherit'
        });
        
        serverProcess.on('error', (error) => {
            console.error('Server process error:', error);
        });
        
        serverProcess.on('exit', (code) => {
            console.log(`Server process exited with code ${code}`);
        });
        
        // Get local IP dynamically
        function getLocalIP() {
            const interfaces = require('os').networkInterfaces();
            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        return iface.address;
                    }
                }
            }
            return 'localhost';
        }

        const localIP = getLocalIP();
        
        // RTMP server configuration
        const config = {
            rtmp: {
                port: 1935,
                chunk_size: 60000,
                gop_cache: true,
                ping: 30,
                ping_timeout: 60
            },
            http: {
                port: 8000,
                allow_origin: '*',
                mediaroot: app.isPackaged 
                    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'media')
                    : path.join(__dirname, '../media')
            }
        };

        nms = new NodeMediaServer(config);
        nms.run();
        
        // Express server
        expressApp = express();
        
        // Determine the correct static files path
        let publicPath;
        
        if (app.isPackaged) {
            // Try multiple possible paths for packaged app
            const possiblePaths = [
                path.join(process.resourcesPath, 'app.asar.unpacked', 'public'),
                path.join(process.resourcesPath, 'public'),
                path.join(__dirname, 'public'),
                path.join(__dirname, '../public'),
                path.join(app.getAppPath(), 'public')
            ];
            
            for (const testPath of possiblePaths) {
                console.log('Testing path:', testPath, 'exists:', require('fs').existsSync(testPath));
                if (require('fs').existsSync(testPath)) {
                    publicPath = testPath;
                    break;
                }
            }
            
            if (!publicPath) {
                console.error('Could not find public directory in packaged app');
                publicPath = path.join(__dirname, '../public'); // fallback
            }
        } else {
            publicPath = path.join(__dirname, '../public');
        }
            
        console.log('Using static files path:', publicPath);
        console.log('Path exists:', require('fs').existsSync(publicPath));
        
        expressApp.use(express.static(publicPath));
        
        // Add API endpoint for server info
        expressApp.get('/api/server-info', (req, res) => {
            res.json({
                localIP: localIP,
                rtmpPort: 1935,
                webPort: 8080,
                httpPort: 8000
            });
        });
        
        // Add logs API proxy
        expressApp.get('/api/logs', async (req, res) => {
            try {
                // Forward to the actual server running on port 8081 (where server.js runs)
                const http = require('http');
                const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
                
                const options = {
                    hostname: 'localhost',
                    port: 8081,
                    path: `/api/logs${queryString}`,
                    method: 'GET'
                };
                
                const proxyReq = http.request(options, (proxyRes) => {
                    let data = '';
                    proxyRes.on('data', (chunk) => {
                        data += chunk;
                    });
                    proxyRes.on('end', () => {
                        try {
                            const logs = JSON.parse(data);
                            res.json(logs);
                        } catch (e) {
                            res.json([]);
                        }
                    });
                });
                
                proxyReq.on('error', (error) => {
                    console.error('Failed to fetch logs:', error);
                    res.json([]);
                });
                
                proxyReq.end();
            } catch (error) {
                console.error('Failed to fetch logs:', error);
                res.json([]);
            }
        });
        
        server = expressApp.listen(8080, () => {
            console.log(`RTMP Viewer server started on port 8080`);
            console.log(`Web interface: http://${localIP}:8080`);
        });
        
        console.log('RTMP server started on port 1935');
        console.log(`Stream URL: rtmp://${localIP}:1935/live/stream`);
        
    } catch (error) {
        console.error('Failed to start server:', error);
    }
}

function stopServer() {
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
    }
    if (nms) {
        nms.stop();
        nms = null;
    }
    if (server) {
        server.close();
        server = null;
    }
}