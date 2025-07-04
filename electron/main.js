const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow;
let serverProcess;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 1100,
        minWidth: 800,
        minHeight: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false
        },
        show: false // Don't show until ready
    });

    // Start the server as a child process
    startServer();

    // Wait for server to be ready
    let retryCount = 0;
    const loadApp = () => {
        console.log(`Loading app... (attempt ${retryCount + 1})`);
        mainWindow.loadURL('http://localhost:8081').then(() => {
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
        const req = http.get('http://localhost:8081', (res) => {
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
        
        console.log('Server process started');
        
    } catch (error) {
        console.error('Failed to start server:', error);
    }
}

function stopServer() {
    if (serverProcess) {
        console.log('Stopping server process...');
        serverProcess.kill('SIGTERM');
        serverProcess = null;
    }
}