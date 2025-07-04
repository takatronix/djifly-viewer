let flvPlayer = null;
let isInitializing = false;
let retryCount = 0;
const MAX_RETRY = 2;
const videoElement = document.getElementById('videoPlayer');
// Removed play/stop buttons - auto play on mode change
const statusElement = document.getElementById('status');
const modeSelect = document.getElementById('modeSelect');
const rtmpUrlElement = document.getElementById('rtmpUrl');
// const currentResolutionElement = document.getElementById('currentResolution');
// const latencyModeElement = document.getElementById('latencyMode');

let lowLatencyActive = false;
let ultraLowLatencyActive = false;
let currentStreamKey = 's';
let serverInfo = null;
let autoConnectEnabled = true;
let streamUrl = 'http://localhost:8000/lives/.flv';
let lastStreamCount = 0;

// Global debug variables for HTML access
window.currentStreamUrl = streamUrl;
window.flvPlayer = null; // Initialize as null

// Enhanced debug logging
function debugLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    
    // Add to debug panel if available
    if (typeof addLogEntry === 'function') {
        addLogEntry(type, message, Date.now());
    }
}

// Check if flv.js is available
function checkFlvJsAvailability() {
    if (typeof flvjs === 'undefined') {
        console.error('❌ flv.js is not available');
        debugLog('flv.js ライブラリが利用できません', 'error');
        updateStatus('flv.js ライブラリエラー - ページを再読み込みしてください', 'error');
        return false;
    }
    
    if (!flvjs.isSupported()) {
        console.error('❌ flv.js is not supported in this browser');
        debugLog('このブラウザはFLV再生をサポートしていません', 'error');
        updateStatus('このブラウザはFLV再生をサポートしていません', 'error');
        return false;
    }
    
    console.log('✅ flv.js is available and supported');
    debugLog('flv.js が正常に利用可能です', 'success');
    return true;
}

function updateStatus(status, className = '') {
    debugLog(`Status updated: ${status} (${className})`, 'info');
    if (statusElement) {
        statusElement.textContent = status;
        statusElement.className = className;
    } else {
        console.log('Status update:', status);
    }
}

async function playStream() {
    debugLog('playStream() called', 'info');
    
    if (!modeSelect) {
        console.error('modeSelect element not found');
        debugLog('modeSelect element not found', 'error');
        return;
    }
    
    currentStreamKey = 's'; // 固定のストリームキー
    const mode = modeSelect.value;
    
    debugLog(`Starting stream with mode: ${mode}`, 'info');
    
    let actualStreamKey = currentStreamKey;
    let newStreamUrl;
    
    // Stop current stream first and wait for clean stop
    if (flvPlayer) {
        debugLog('Stopping existing stream before starting new one', 'info');
        stopStream();
        // Wait for clean stop
        await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    // Parse mode selection
    if (mode === 'original') {
        // Standard original quality - use the actual working path
        newStreamUrl = `http://${window.location.hostname}:8000/lives/.flv`;
        debugLog(`Using original quality stream: ${newStreamUrl}`, 'info');
        
        // Start stream immediately for original
        setTimeout(() => {
            startNewStream(newStreamUrl);
        }, 200);
    } else {
        // Parse mode: low_720p, ultra_360p, extreme_240p, etc.
        const [latencyType, resolution] = mode.split('_');
        const isUltra = latencyType === 'ultra';
        const isExtreme = latencyType === 'extreme';
        
        debugLog(`Starting latency mode: ${latencyType}, resolution: ${resolution}`, 'info');
        
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
                    newStreamUrl = `http://${window.location.hostname}:8000/live/${actualStreamKey}.flv`;
                    debugLog(`Starting latency stream: ${newStreamUrl}`, 'info');
                    startNewStream(newStreamUrl);
                }, 3000);
            } else {
                // Fallback to original stream if latency mode fails
                console.log('Falling back to original stream');
                debugLog('Falling back to original stream', 'warning');
                newStreamUrl = `http://${window.location.hostname}:8000/lives/.flv`;
                setTimeout(() => {
                    startNewStream(newStreamUrl);
                }, 500);
            }
        } catch (error) {
            console.error('Failed to start latency mode:', error);
            debugLog(`Failed to start latency mode: ${error.message}`, 'error');
            updateStatus('低遅延モード開始に失敗', 'error');
            
            // Fallback to original stream
            newStreamUrl = `http://${window.location.hostname}:8000/live/${currentStreamKey}.flv`;
            setTimeout(() => {
                startNewStream(newStreamUrl);
            }, 500);
        }
    }
}

function forceResetPlayer() {
    debugLog('Force resetting player...', 'info');
    
    if (flvPlayer) {
        try {
            // More thorough cleanup
            flvPlayer.pause();
            flvPlayer.unload();
            flvPlayer.detachMediaElement();
            flvPlayer.destroy();
            debugLog('Player destroyed successfully', 'success');
        } catch (e) {
            console.warn('Force destroy error:', e);
            debugLog(`Force destroy error: ${e.message}`, 'warning');
        }
    }
    
    // Always reset both local and global variables
    flvPlayer = null;
    window.flvPlayer = null;
    
    // VideoElementを強制リセット
    if (videoElement) {
        try {
            videoElement.pause();
            videoElement.removeAttribute('src');
            videoElement.load();
            debugLog('Video element reset successfully', 'success');
        } catch (e) {
            console.warn('Video element reset error:', e);
            debugLog(`Video element reset error: ${e.message}`, 'warning');
        }
    }
    
    isInitializing = false;
    retryCount = 0;
    
    // ガベージコレクションを促進
    if (window.gc) {
        window.gc();
    }
}

function stopStream() {
    debugLog('Stopping stream...', 'info');
    forceResetPlayer();
    
    // 低遅延ストリームも停止
    fetch(`/api/stream/stop-low-latency/s`, {
        method: 'POST'
    }).catch(() => {});
    
    updateStatus('停止', '');
}

function startNewStream(url) {
    if (isInitializing) {
        debugLog('Already initializing, skipping...', 'warning');
        return;
    }
    
    debugLog(`Starting new stream: ${url}`, 'info');
    streamUrl = url;
    window.currentStreamUrl = url;
    isInitializing = true;
    
    // 前のプレイヤーを完全に破棄
    forceResetPlayer();
    
    // 少し待ってから新しいプレイヤーを作成
    setTimeout(() => {
        createNewPlayer();
    }, 800); // 待機時間を延長
}

// 完全に書き直された createNewPlayer 関数
function createNewPlayer() {
    debugLog('=== Starting createNewPlayer ===', 'info');
    
    // 基本的なチェック
    if (!checkFlvJsAvailability()) {
        debugLog('flv.js not available, aborting', 'error');
        isInitializing = false;
        return;
    }
    
    if (!videoElement) {
        debugLog('Video element not found, aborting', 'error');
        isInitializing = false;
        updateStatus('ビデオ要素が見つかりません', 'error');
        return;
    }
    
    if (!streamUrl) {
        debugLog('Stream URL not set, aborting', 'error');
        isInitializing = false;
        updateStatus('ストリームURLが設定されていません', 'error');
        return;
    }
    
    debugLog(`Creating player for URL: ${streamUrl}`, 'info');
    updateStatus('プレイヤー初期化中...', '');
    
    try {
        // シンプルなflv.js プレイヤー作成
        debugLog('Creating simple flv.js player...', 'info');
        
        flvPlayer = flvjs.createPlayer({
            type: 'flv',
            url: streamUrl,
            isLive: true
        });
        
        // グローバル変数を即座に更新
        window.flvPlayer = flvPlayer;
        
        if (!flvPlayer) {
            throw new Error('flvjs.createPlayer returned null');
        }
        
        debugLog('Player created successfully', 'success');
        
        // 最小限のエラーハンドリング
        flvPlayer.on(flvjs.Events.ERROR, (errorType, errorDetail, errorInfo) => {
            debugLog(`Player error: ${errorType} - ${errorDetail}`, 'error');
            updateStatus(`エラー: ${errorDetail}`, 'error');
            
            if (retryCount < MAX_RETRY) {
                retryCount++;
                debugLog(`Retrying... (${retryCount}/${MAX_RETRY})`, 'info');
                setTimeout(() => {
                    startNewStream(streamUrl);
                }, 2000);
            } else {
                debugLog('Max retry reached', 'error');
                updateStatus('最大再試行回数に達しました', 'error');
                forceResetPlayer();
            }
        });
        
        // メタデータ受信時の処理
        flvPlayer.on(flvjs.Events.METADATA_ARRIVED, (metadata) => {
            debugLog('Metadata arrived - starting playback', 'success');
            updateStatus('メタデータ受信完了', 'connected');
            
            // 500ms後に自動再生を試行
            setTimeout(() => {
                if (flvPlayer) {
                    flvPlayer.play().then(() => {
                        debugLog('Auto-play started', 'success');
                        updateStatus('再生中', 'connected');
                    }).catch(err => {
                        debugLog(`Auto-play failed: ${err.message}`, 'warning');
                        updateStatus('手動で再生ボタンをクリック', '');
                    });
                }
            }, 500);
        });
        
        // 読み込み完了
        flvPlayer.on(flvjs.Events.LOADING_COMPLETE, () => {
            debugLog('Loading complete', 'success');
            updateStatus('読み込み完了', 'connected');
            retryCount = 0;
        });
        
        // プレイヤーをビデオ要素にアタッチ
        debugLog('Attaching player to video element...', 'info');
        flvPlayer.attachMediaElement(videoElement);
        
        // プレイヤーを読み込み
        debugLog('Loading player...', 'info');
        flvPlayer.load();
        
        debugLog('Player initialization completed', 'success');
        
    } catch (error) {
        debugLog(`Player creation failed: ${error.message}`, 'error');
        console.error('Player creation error:', error);
        updateStatus('プレイヤー作成エラー', 'error');
        
        // 失敗時にnullを設定
        flvPlayer = null;
        window.flvPlayer = null;
        
        forceResetPlayer();
    } finally {
        isInitializing = false;
    }
}

// 自動再生を試行する関数（削除 - createNewPlayer に統合）

// ビデオ要素のイベントリスナーを設定（削除 - シンプル化）

// ビデオイベントハンドラー（削除 - シンプル化）

function updateStreamList() {
    // ストリーム一覧は不要になったので、RTMP URLのみ更新
    updateRtmpUrl();
}

// Auto play on mode change - removed play/stop buttons
if (modeSelect) {
    modeSelect.addEventListener('change', onModeChange);
} else {
    console.error('modeSelect element not found');
}


// Unified latency mode function
async function startLatencyMode(streamKey, resolution, isUltra, isExtreme) {
    try {
        let params = '';
        if (isExtreme) {
            params = '?extreme=true';
        } else if (isUltra) {
            params = '?ultra=true';
        } else {
            // For low latency mode (low_), no special params needed
            params = '';
        }
        
        console.log(`Starting latency mode: streamKey=${streamKey}, resolution=${resolution}, isUltra=${isUltra}, isExtreme=${isExtreme}`);
        
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
            console.log(`✅ ${mode}モード開始成功: ${resolution}`);
            updateStatus(`${mode}モード開始: ${resolution}`, 'connected');
            return true;
        } else {
            console.error(`❌ 低遅延モード開始失敗: HTTP ${response.status} - ${result.error}`);
            console.error('Response details:', result);
            updateStatus(`Error: ${result.error}`, 'error');
            return false;
        }
    } catch (error) {
        console.error(`❌ 低遅延モード開始エラー: ${error.message}`);
        console.error('Error details:', error);
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
    const streamKey = 's'; // Fixed stream key instead of using streamSelect
    const resolution = '480p'; // Default resolution since resolutionSelect is removed
    
    if (ultraLowLatencyActive) {
        await stopLowLatency(streamKey);
    } else {
        // Enable ultra mode
        ultraLowLatencyActive = true;
        
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
    } else {
        // プレイヤーがアクティブでない場合は即座に再生開始
        playStream();
    }
}

// Emergency stop function removed for simplicity

// Make functions global for onclick handlers
window.copyRtmpUrl = copyRtmpUrl;
window.playStream = playStream;


// Auto-connect variables (moved from duplicate declaration)
// autoConnectEnabled and lastStreamCount are declared at the top of the file



// Modified auto-connect with better stream detection
function checkAndAutoConnect() {
    fetch('/api/streams')
        .then(response => response.json())
        .then(streams => {
            console.log('Auto-connect check - streams:', streams.length, 'flvPlayer:', !!flvPlayer);
            console.log('Stream details:', streams);
            
            // ストリームがあり、flvPlayerがなければ常に再生
            if (streams.length > 0 && !flvPlayer) {
                console.log('🎥 Auto-connecting to stream...');
                updateStatus('ストリーム検出 - 自動接続中...', 'connecting');
                setTimeout(() => {
                    playStream();
                }, 500);
            }
            
            // ストリームがなくなったらプレイヤーを停止
            if (streams.length === 0 && flvPlayer) {
                console.log('❌ No streams available, stopping player');
                stopStream();
                updateStatus('ストリーム終了', '');
            }
            
            // ストリーム数の変化をログ
            if (lastStreamCount !== streams.length) {
                console.log(`📊 Stream count changed: ${lastStreamCount} → ${streams.length}`);
                if (streams.length > 0) {
                    updateStatus(`ストリーム受信中 (${streams.length}個)`, 'connected');
                }
            }
            
            lastStreamCount = streams.length;
        })
        .catch(error => {
            console.error('Failed to check streams:', error);
            updateStatus('API接続エラー', 'error');
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
if (toggleLogBtn) {
    toggleLogBtn.addEventListener('click', () => {
        isLogCollapsed = !isLogCollapsed;
        if (logPanel) {
            logPanel.classList.toggle('collapsed', isLogCollapsed);
        }
        toggleLogBtn.textContent = isLogCollapsed ? '▲' : '▼';
    });
}

// Clear logs
if (clearLogBtn) {
    clearLogBtn.addEventListener('click', () => {
        if (logContent) {
            logContent.innerHTML = '';
        }
    });
}

// Add log entry to panel
function addLogEntry(type, message, timestamp) {
    if (!logContent) {
        console.log(`[${type}] ${message}`);
        return;
    }
    
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

if (logResizer) {
    logResizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = logPanel ? logPanel.offsetHeight : 200;
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
    });
}

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const deltaY = startY - e.clientY;
    const newHeight = Math.min(Math.max(startHeight + deltaY, 35), window.innerHeight * 0.8);
    if (logPanel) {
        logPanel.style.height = `${newHeight}px`;
    }
    
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
    if (!rtmpUrlElement) {
        console.error('rtmpUrlElement not found');
        return;
    }
    
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

// DJI Goggles 3 guide button
const djiGoggles3Btn = document.getElementById('djiGoggles3Btn');
if (djiGoggles3Btn) {
    djiGoggles3Btn.addEventListener('click', () => {
        window.open('dji-goggles3-guide.html', '_blank');
    });
}

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

// Help button event listeners with null checks
const rtmpHelp = document.getElementById('rtmpHelp');
if (rtmpHelp) {
    rtmpHelp.addEventListener('click', (e) => {
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
}

// Hide tooltip when clicking elsewhere
document.addEventListener('click', (e) => {
    if (!e.target.classList.contains('help-button')) {
        hideTooltip();
    }
});

// Test functions removed for simplicity

// Make test functions globally available
window.playStream = playStream;

// Auto-play if requested in URL
const urlParams = new URLSearchParams(window.location.search);
const autoPlay = urlParams.get('autoplay');
if (autoPlay === 'true') {
    // Wait for flv.js to load before auto-playing
    setTimeout(() => {
        if (checkFlvJsAvailability()) {
            playStream();
        }
    }, 1000);
}