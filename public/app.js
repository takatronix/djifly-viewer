let flvPlayer = null;
const videoElement = document.getElementById('videoPlayer');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
// Removed old latency buttons
const statusElement = document.getElementById('status');
const modeSelect = document.getElementById('modeSelect');
const rtmpUrlElement = document.getElementById('rtmpUrl');
const currentResolutionElement = document.getElementById('currentResolution');
const latencyModeElement = document.getElementById('latencyMode');

let lowLatencyActive = false;
let ultraLowLatencyActive = false;
let currentStreamKey = 's';
let serverInfo = null;
let autoConnectEnabled = true;

function updateStatus(status, className = '') {
    statusElement.textContent = status;
    statusElement.className = className;
}

async function playStream() {
    currentStreamKey = 's'; // 固定のストリームキー
    const mode = modeSelect.value;
    
    let actualStreamKey = currentStreamKey;
    let streamUrl;
    
    // Stop current stream first and wait for clean stop
    if (flvPlayer) {
        stopStream();
        // Wait for clean stop
        await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    // Parse mode selection
    if (mode === 'original') {
        // Standard original quality
        streamUrl = `http://${window.location.hostname}:8000/live/${actualStreamKey}.flv`;
        currentResolutionElement.textContent = 'オリジナル';
        latencyModeElement.textContent = '標準';
        
        // Start stream immediately for original
        setTimeout(() => {
            startNewStream(streamUrl);
        }, 200);
    } else {
        // Parse mode: low_720p, ultra_360p, extreme_240p, etc.
        const [latencyType, resolution] = mode.split('_');
        const isUltra = latencyType === 'ultra';
        const isExtreme = latencyType === 'extreme';
        
        currentResolutionElement.textContent = resolution.toUpperCase();
        if (isExtreme) {
            latencyModeElement.textContent = '極限低遅延';
        } else if (isUltra) {
            latencyModeElement.textContent = '超低遅延';
        } else {
            latencyModeElement.textContent = '低遅延';
        }
        
        try {
            // Start latency mode and wait for it to be ready
            const success = await startLatencyMode(currentStreamKey, resolution, isUltra, isExtreme);
            
            if (success) {
                // Wait longer for FFmpeg to start processing
                setTimeout(() => {
                    let suffix = '';
                    if (isExtreme) suffix = '_extreme';
                    else if (isUltra) suffix = '_ultra';
                    actualStreamKey = `${currentStreamKey}_${resolution}${suffix}`;
                    streamUrl = `http://${window.location.hostname}:8000/live/${actualStreamKey}.flv`;
                    startNewStream(streamUrl);
                }, 3000);
            } else {
                // Fallback to original stream if latency mode fails
                console.log('Falling back to original stream');
                streamUrl = `http://${window.location.hostname}:8000/live/${currentStreamKey}.flv`;
                currentResolutionElement.textContent = 'オリジナル';
                latencyModeElement.textContent = '標準';
                setTimeout(() => {
                    startNewStream(streamUrl);
                }, 500);
            }
        } catch (error) {
            console.error('Failed to start latency mode:', error);
            updateStatus('低遅延モード開始に失敗', 'error');
            
            // Fallback to original stream
            streamUrl = `http://${window.location.hostname}:8000/live/${currentStreamKey}.flv`;
            currentResolutionElement.textContent = 'オリジナル';
            latencyModeElement.textContent = '標準';
            setTimeout(() => {
                startNewStream(streamUrl);
            }, 500);
        }
    }
}

function startNewStream(streamUrl) {
    if (flvjs.isSupported()) {
        console.log('Starting stream:', streamUrl);
        
        flvPlayer = flvjs.createPlayer({
            type: 'flv',
            url: streamUrl,
            isLive: true,
            enableStashBuffer: false,
            stashInitialSize: 0,
            enableWorker: true,
            lazyLoad: false,
            lazyLoadMaxDuration: 0,
            deferLoadAfterSourceOpen: false,
            statisticsInfoReportInterval: 1000,
            fixAudioTimestampGap: false
        }, {
            enableStashBuffer: false,
            autoCleanupSourceBuffer: true,
            autoCleanupMaxBackwardDuration: 3,
            autoCleanupMinBackwardDuration: 2,
            stashInitialSize: 0,
            seekType: 'range',
            lazyLoadMaxDuration: 0,
            lazyLoadRecoverDuration: 0,
            deferLoadAfterSourceOpen: false,
            fixAudioTimestampGap: false,
            accurateSeek: false
        });
        
        flvPlayer.attachMediaElement(videoElement);
        flvPlayer.load();
        
        flvPlayer.on(flvjs.Events.ERROR, (errorType, errorDetail) => {
            console.error('Player error:', errorType, errorDetail);
            updateStatus(`Error: ${errorDetail}`, 'error');
            
            // Retry connection after error
            if (errorDetail === 'NetworkError') {
                setTimeout(() => {
                    updateStatus('再接続中...', '');
                    playStream();
                }, 3000);
            }
        });
        
        flvPlayer.on(flvjs.Events.LOADING_COMPLETE, () => {
            updateStatus('読み込み完了', 'connected');
        });
        
        flvPlayer.on(flvjs.Events.METADATA_ARRIVED, () => {
            updateStatus('再生中', 'connected');
            flvPlayer.play();
        });
        
        updateStatus('接続中...', '');
    } else {
        updateStatus('FLV.jsがサポートされていません', 'error');
    }
}

function stopStream() {
    if (flvPlayer) {
        flvPlayer.pause();
        flvPlayer.unload();
        flvPlayer.detachMediaElement();
        flvPlayer.destroy();
        flvPlayer = null;
    }
    
    // 現在のストリームキーで低遅延ストリームも停止
    const currentStreamKey = 's';
    fetch(`/api/stream/stop-low-latency/${currentStreamKey}`, {
        method: 'POST'
    }).then(response => {
        if (response.ok) {
            console.log('Low latency stream stopped successfully');
        } else {
            console.log('Low latency stream stop request failed');
        }
    }).catch(error => {
        console.log('Low latency stream stop request failed:', error);
    });
    
    updateStatus('停止', '');
}

function updateStreamList() {
    // ストリーム一覧は不要になったので、RTMP URLのみ更新
    updateRtmpUrl();
}

playBtn.addEventListener('click', playStream);
stopBtn.addEventListener('click', stopStream);
modeSelect.addEventListener('change', onModeChange);


// Unified latency mode function
async function startLatencyMode(streamKey, resolution, isUltra, isExtreme) {
    try {
        let params = '';
        if (isExtreme) {
            params = '?extreme=true';
        } else if (isUltra) {
            params = '?ultra=true';
        }
        
        const response = await fetch(`/api/stream/low-latency/${streamKey}/${resolution}${params}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            let mode;
            if (isExtreme) {
                mode = '極限低遅延';
            } else if (isUltra) {
                mode = '超低遅延';
            } else {
                mode = '低遅延';
            }
            updateStatus(`${mode}モード開始: ${resolution}`, 'connected');
            return true;
        } else {
            updateStatus(`Error: ${result.error}`, 'error');
            return false;
        }
    } catch (error) {
        updateStatus(`Error: ${error.message}`, 'error');
        return false;
    }
}

async function startLowLatency(streamKey, resolution) {
    try {
        const ultraParam = ultraLowLatencyActive ? '?ultra=true' : '';
        const response = await fetch(`/api/stream/low-latency/${streamKey}/${resolution}${ultraParam}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            lowLatencyActive = true;
            lowLatencyBtn.textContent = 'Disable Low Latency';
            const mode = ultraLowLatencyActive ? 'ULTRA low latency' : 'Low latency';
            updateStatus(`${mode} enabled: ${resolution}`, 'connected');
            
            // Restart stream with low latency
            if (flvPlayer) {
                setTimeout(() => {
                    playStream();
                }, 2000);
            }
        } else {
            updateStatus(`Error: ${result.error}`, 'error');
        }
    } catch (error) {
        updateStatus(`Error enabling low latency: ${error.message}`, 'error');
    }
}

async function stopLowLatency(streamKey) {
    try {
        const response = await fetch(`/api/stream/stop-low-latency/${streamKey}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            lowLatencyActive = false;
            ultraLowLatencyActive = false;
            lowLatencyBtn.textContent = 'Enable Low Latency';
            ultraLowLatencyBtn.textContent = 'Ultra Mode (Packet Drop)';
            updateStatus('Low latency disabled', '');
            
            // Restart stream with original quality
            if (flvPlayer) {
                setTimeout(() => {
                    playStream();
                }, 1000);
            }
        } else {
            updateStatus(`Error: ${result.error}`, 'error');
        }
    } catch (error) {
        updateStatus(`Error disabling low latency: ${error.message}`, 'error');
    }
}

// Ultra low latency functions
async function toggleUltraLowLatency() {
    const streamKey = streamSelect.value || 'stream';
    const resolution = resolutionSelect.value;
    
    if (resolution === 'original') {
        updateStatus('超低遅延モードには解像度プリセットを選択してください', 'error');
        return;
    }
    
    if (ultraLowLatencyActive) {
        await stopLowLatency(streamKey);
    } else {
        // Enable ultra mode
        ultraLowLatencyActive = true;
        ultraLowLatencyBtn.textContent = 'Disable Ultra Mode';
        
        if (lowLatencyActive) {
            // Restart with ultra settings
            await stopLowLatency(streamKey);
            setTimeout(() => {
                startLowLatency(streamKey, resolution);
            }, 1000);
        } else {
            await startLowLatency(streamKey, resolution);
        }
    }
}

// Standard resolution conversion (without low latency)
async function startStandardResolutionStream(streamKey, resolution) {
    try {
        const response = await fetch(`/api/stream/standard-resolution/${streamKey}/${resolution}`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            console.log('Standard resolution conversion not available, using original stream');
        }
    } catch (error) {
        console.log('Standard resolution conversion failed:', error);
    }
}

// Mode change handler
function onModeChange() {
    // 現在のストリームを停止してから新しいモードで開始
    if (flvPlayer) {
        stopStream();
        // 少し待ってから新しいモードで開始
        setTimeout(() => {
            playStream();
        }, 500);
    }
}

// Make functions global for onclick handlers
window.copyRtmpUrl = copyRtmpUrl;
window.playStream = playStream;


// Auto-connect variables (moved from duplicate declaration)
// autoConnectEnabled and lastStreamCount are declared at the top of the file

// Modified update stream list with auto-connect
function checkAndAutoConnect() {
    fetch('/api/streams')
        .then(response => response.json())
        .then(streams => {
            console.log('Auto-connect check - streams:', streams.length, 'flvPlayer:', !!flvPlayer, 'autoConnectEnabled:', autoConnectEnabled);
            
            // If we found a new stream and player is not active
            if (streams.length > 0 && !flvPlayer && autoConnectEnabled) {
                console.log('Auto-connecting to stream:', streams[0].stream);
                
                // Check if stream 's' exists in the list (our default stream)
                const sStream = streams.find(s => s.stream === 's');
                if (sStream) {
                    console.log('Found default stream "s", auto-connecting...');
                    // Add delay to ensure stream is ready
                    setTimeout(() => {
                        console.log('Starting auto-connect playback...');
                        playStream();
                    }, 1000);
                    autoConnectEnabled = false; // Disable auto-connect after first connection
                } else {
                    console.log('Default stream "s" not found, available streams:', streams.map(s => s.stream));
                }
            } else if (streams.length > 0 && flvPlayer) {
                console.log('Stream available but player is already active');
            } else if (streams.length === 0) {
                console.log('No streams available');
            } else if (!autoConnectEnabled) {
                console.log('Auto-connect is disabled');
            }
            
            // Re-enable auto-connect if all streams are gone
            if (streams.length === 0 && lastStreamCount > 0) {
                console.log('All streams gone, re-enabling auto-connect');
                autoConnectEnabled = true;
                if (flvPlayer) {
                    stopStream();
                }
            }
            
            lastStreamCount = streams.length;
        })
        .catch(error => {
            console.error('Failed to check streams:', error);
        });
}

// Fetch server info on startup
async function fetchServerInfo() {
    try {
        console.log('Fetching server info...');
        const response = await fetch('/api/server-info');
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        serverInfo = await response.json();
        console.log('Server info received:', serverInfo);
        updateRtmpUrl(); // Update URL with correct IP
        
        // Update status to show IP is loaded
        if (serverInfo && serverInfo.localIP) {
            console.log('IP address loaded:', serverInfo.localIP);
        }
    } catch (error) {
        console.error('Failed to fetch server info:', error);
        // Fallback to localhost if server info fails
        serverInfo = { localIP: 'localhost' };
        updateRtmpUrl();
    }
}

// Update stream list every 2 seconds for faster auto-connect
setInterval(() => {
    updateStreamList();
    checkAndAutoConnect();
}, 2000);

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing app...');
    console.log('rtmpUrlElement:', rtmpUrlElement);

    fetchServerInfo();
    updateStreamList();
    
    // Wait a bit before first auto-connect check
    setTimeout(() => {
        checkAndAutoConnect();
    }, 1000);
});

// Also initialize immediately in case DOMContentLoaded has already fired
if (document.readyState === 'loading') {
    // DOM is still loading, wait for DOMContentLoaded
    console.log('DOM still loading, waiting...');
} else {
    // DOM is already loaded
    console.log('DOM already loaded, initializing immediately...');
    console.log('rtmpUrlElement:', rtmpUrlElement);
    
    fetchServerInfo();
    updateStreamList();
    
    // Wait a bit before first auto-connect check
    setTimeout(() => {
        checkAndAutoConnect();
    }, 1000);
}

// Log panel functionality
const logPanel = document.getElementById('logPanel');
const logContent = document.getElementById('logContent');
const toggleLogBtn = document.getElementById('toggleLogBtn');
const clearLogBtn = document.getElementById('clearLogBtn');
const logResizer = document.getElementById('logResizer');

let isLogCollapsed = false;
let lastLogTimestamp = null;

// Toggle log panel
toggleLogBtn.addEventListener('click', () => {
    isLogCollapsed = !isLogCollapsed;
    logPanel.classList.toggle('collapsed', isLogCollapsed);
    toggleLogBtn.textContent = isLogCollapsed ? '▲' : '▼';
});

// Clear logs
clearLogBtn.addEventListener('click', () => {
    logContent.innerHTML = '';
});

// Add log entry to panel
function addLogEntry(type, message, timestamp) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const time = new Date(timestamp).toLocaleTimeString();
    entry.innerHTML = `<span class="log-timestamp">${time}</span>${message}`;
    
    logContent.appendChild(entry);
    // Auto-scroll to bottom
    logContent.scrollTop = logContent.scrollHeight;
}

// Fetch and update logs
async function updateLogs() {
    try {
        const url = lastLogTimestamp 
            ? `/api/logs?since=${lastLogTimestamp}`
            : '/api/logs';
            
        const response = await fetch(url);
        const logs = await response.json();
        
        logs.forEach(log => {
            addLogEntry(log.type, log.message, log.timestamp);
            lastLogTimestamp = log.timestamp;
        });
    } catch (error) {
        console.error('Failed to fetch logs:', error);
    }
}

// Update logs every 2 seconds
setInterval(updateLogs, 2000);

// Resize functionality
let isResizing = false;
let startY = 0;
let startHeight = 0;

logResizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startY = e.clientY;
    startHeight = logPanel.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const deltaY = startY - e.clientY;
    const newHeight = Math.min(Math.max(startHeight + deltaY, 35), window.innerHeight * 0.8);
    logPanel.style.height = `${newHeight}px`;
    
    // Update body padding
    document.body.style.paddingBottom = `${newHeight + 20}px`;
});

document.addEventListener('mouseup', () => {
    isResizing = false;
    document.body.style.cursor = '';
});

// Initial log fetch
updateLogs();

// Update RTMP URL display
function updateRtmpUrl() {
    const streamKey = 's'; // 固定のストリームキー
    const hostname = serverInfo ? serverInfo.localIP : window.location.hostname;
    const rtmpUrl = `rtmp://${hostname}/live/${streamKey}`;
    
    console.log('Updating RTMP URL:', rtmpUrl);
    console.log('serverInfo:', serverInfo);
    console.log('rtmpUrlElement:', rtmpUrlElement);
    
    if (rtmpUrlElement) {
        rtmpUrlElement.textContent = rtmpUrl;
        console.log('RTMP URL updated successfully');
    } else {
        console.error('rtmpUrlElement not found');
    }
}

// Copy RTMP URL to clipboard
function copyRtmpUrl() {
    const url = rtmpUrlElement.textContent;
    navigator.clipboard.writeText(url).then(() => {
        updateStatus('RTMP URLをクリップボードにコピーしました！', 'connected');
        setTimeout(() => {
            updateStatus('未接続', '');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy: ', err);
        updateStatus('URLのコピーに失敗しました', 'error');
    });
}

// Update URL when stream selection changes
streamSelect.addEventListener('change', () => {
    updateRtmpUrl();
    // Auto-switch stream if already playing
    if (flvPlayer && statusElement.textContent === '再生中') {
        playStream();
    }
});

// DJI Goggles 3 guide button
const djiGoggles3Btn = document.getElementById('djiGoggles3Btn');
djiGoggles3Btn.addEventListener('click', () => {
    window.open('dji-goggles3-guide.html', '_blank');
});

// Help tooltip functionality
let currentTooltip = null;

function showTooltip(button, content) {
    // Remove existing tooltip
    hideTooltip();
    
    const tooltip = document.createElement('div');
    tooltip.className = 'help-tooltip show';
    tooltip.innerHTML = content;
    
    // Position the tooltip
    const rect = button.getBoundingClientRect();
    tooltip.style.position = 'fixed';
    tooltip.style.top = (rect.bottom + 10) + 'px';
    tooltip.style.left = rect.left + 'px';
    
    document.body.appendChild(tooltip);
    currentTooltip = tooltip;
    
    // Auto-hide after 5 seconds
    setTimeout(hideTooltip, 5000);
}

function hideTooltip() {
    if (currentTooltip) {
        currentTooltip.remove();
        currentTooltip = null;
    }
}

// Help button event listeners
document.getElementById('streamHelp').addEventListener('click', (e) => {
    e.preventDefault();
    showTooltip(e.target, `
        <h4>📺 ストリーム選択</h4>
        <p><strong>デフォルトストリーム:</strong> <code>rtmp://[IP]/live/s</code></p>
        <ul>
            <li>DJI Flyアプリからの配信を受信</li>
            <li>複数のストリームを同時受信可能</li>
            <li>カスタムストリームキーも使用可能</li>
        </ul>
        <p><strong>使い方:</strong> 表示されたRTMP URLをDJI Flyアプリにコピー</p>
    `);
});

// Removed old resolution help - now using unified mode selector

document.getElementById('rtmpHelp').addEventListener('click', (e) => {
    e.preventDefault();
    showTooltip(e.target, `
        <h4>📡 RTMP URL</h4>
        <p><strong>この URL を DJI Fly アプリにコピーしてください</strong></p>
        <ul>
            <li>クリックでクリップボードにコピー</li>
            <li>自動的にローカル IP を表示</li>
            <li>同一 Wi-Fi ネットワーク内からアクセス可能</li>
        </ul>
        <p><strong>設定方法:</strong> DJI Fly → 設定 → ライブストリーミング → カスタム RTMP</p>
    `);
});

// Hide tooltip when clicking elsewhere
document.addEventListener('click', (e) => {
    if (!e.target.classList.contains('help-button')) {
        hideTooltip();
    }
});

// Auto-play if requested in URL
const urlParams = new URLSearchParams(window.location.search);
const autoPlay = urlParams.get('autoplay');
if (autoPlay === 'true') {
    playStream();
}