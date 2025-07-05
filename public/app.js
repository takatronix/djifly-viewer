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
let streamUrl = 'http://localhost:8000/live/s.flv';
let lastStreamCount = 0;

// シンプルな自動再生制御
let autoPlayState = {
    lastAttempt: 0,
    cooldownPeriod: 10000 // 10秒間は再試行しない
};

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
        debugLog(t('flvLibraryError'), 'error');
        updateStatus(t('flvLibraryError'), 'error');
        return false;
    }
    
    if (!flvjs.isSupported()) {
        console.error('❌ flv.js is not supported in this browser');
        debugLog(t('browserNotSupported'), 'error');
        updateStatus(t('browserNotSupported'), 'error');
        return false;
    }
    
    console.log('✅ flv.js is available and supported');
    debugLog(t('flvLibraryAvailable'), 'success');
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
        newStreamUrl = `http://${window.location.hostname}:8000/live/s.flv`;
        debugLog(`Using original quality stream: ${newStreamUrl}`, 'info');
        
        // Start stream immediately for original
        setTimeout(() => {
            startNewStream(newStreamUrl);
        }, 200);
    } else {
        // Parse mode: low_720p, low_480p
        const [latencyType, resolution] = mode.split('_');
        
        debugLog(`Starting latency mode: ${latencyType}, resolution: ${resolution}`, 'info');
        updateStatus(`${resolution} ${t('preparing')}`, 'connecting');
        
        try {
            // Start latency mode with proper stream availability check
            const success = await startLatencyModeWithCheck(currentStreamKey, resolution);
            
            if (success) {
                actualStreamKey = `${currentStreamKey}_${resolution}`;
                newStreamUrl = `http://${window.location.hostname}:8000/live/${actualStreamKey}.flv`;
                debugLog(`Starting latency stream: ${newStreamUrl}`, 'info');
                startNewStream(newStreamUrl);
            } else {
                // 低遅延モードが失敗した場合、すぐにフォールバック
                debugLog('Low latency mode failed, falling back to original stream', 'warning');
                updateStatus(t('error') + ' - ' + t('standardQuality'), 'warning');
                
                newStreamUrl = `http://${window.location.hostname}:8000/live/s.flv`;
                setTimeout(() => {
                    startNewStream(newStreamUrl);
                }, 500);
            }
        } catch (error) {
            console.error('Failed to start latency mode:', error);
            debugLog(`Failed to start latency mode: ${error.message}`, 'error');
            updateStatus(t('error') + ' - ' + t('standardQuality'), 'error');
            
            // Fallback to original stream
            newStreamUrl = `http://${window.location.hostname}:8000/live/s.flv`;
            setTimeout(() => {
                startNewStream(newStreamUrl);
            }, 500);
        }
    }
}

// Force reset player - enhanced cleanup
function forceResetPlayer() {
    console.log('🔄 Force resetting player...');
    
    // 完全なクリーンアップ
    if (flvPlayer) {
        try {
            flvPlayer.pause();
            flvPlayer.unload();
            flvPlayer.detachMediaElement();
            flvPlayer.destroy();
            debugLog('Player destroyed successfully', 'success');
        } catch (e) {
            debugLog('Error destroying player: ' + e.message, 'error');
        }
    }
    
    // グローバル変数のクリア
    flvPlayer = null;
    window.flvPlayer = null;
    retryCount = 0;
    
    // ビデオ要素の完全リセット
    if (videoElement) {
        videoElement.pause();
        videoElement.src = '';
        videoElement.load();
        videoElement.removeAttribute('src');
        debugLog('Video element reset complete', 'success');
    }
    
    // 残存タイマーのクリア
    if (window.playerResetTimer) {
        clearTimeout(window.playerResetTimer);
        window.playerResetTimer = null;
    }
    
    updateStatus(t('resetComplete'), '');
    debugLog('Force reset completed', 'success');
}

function stopStream() {
    debugLog('Stopping stream...', 'info');
    forceResetPlayer();
    
    // 低遅延ストリームも停止
    fetch(`/api/stream/stop-low-latency/s`, {
        method: 'POST'
    }).catch(() => {});
    
    updateStatus(t('stopped'), '');
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
    
    // 適切な待機時間
    setTimeout(() => {
        createNewPlayer();
    }, 500); // 元の待機時間に戻す
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
        updateStatus(t('videoElementNotFound'), 'error');
        return;
    }
    
    if (!streamUrl) {
        debugLog('Stream URL not set, aborting', 'error');
        isInitializing = false;
        updateStatus(t('streamUrlNotSet'), 'error');
        return;
    }
    
    debugLog(`Creating player for URL: ${streamUrl}`, 'info');
    updateStatus(t('playerInitializing'), '');
    
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
        
        // 最小限のエラーハンドリング（再試行を無効化）
        flvPlayer.on(flvjs.Events.ERROR, (errorType, errorDetail, errorInfo) => {
            debugLog(`Player error: ${errorType} - ${errorDetail}`, 'error');
            updateStatus(`${t('error')}: ${errorDetail}`, 'error');
            
            // 再試行ロジックを完全に無効化 - 無限ループの原因
            debugLog('Error occurred - stopping player (no retry)', 'warning');
            forceResetPlayer();
            
            // // 標準品質モードでのみリトライを許可
            // if (modeSelect && modeSelect.value === 'original' && 
            //     (errorType === flvjs.ErrorTypes.NETWORK_ERROR || 
            //      errorType === flvjs.ErrorTypes.MEDIA_ERROR)) {
            //     
            //     if (retryCount < MAX_RETRY) {
            //         retryCount++;
            //         debugLog(`Retrying standard quality... (${retryCount}/${MAX_RETRY})`, 'info');
            //         updateStatus(`再試行中... (${retryCount}/${MAX_RETRY})`, 'connecting');
            //         
            //         setTimeout(() => {
            //             startNewStream(streamUrl);
            //         }, 3000); // 再試行間隔を延長
            //     } else {
            //         debugLog('Max retry reached for standard quality', 'error');
            //         updateStatus('最大再試行回数に達しました', 'error');
            //         forceResetPlayer();
            //     }
            // } else {
            //     debugLog('Error in non-standard mode or non-retryable error', 'warning');
            //     updateStatus(`エラー: ${errorDetail}`, 'error');
            //     forceResetPlayer();
            // }
        });
        
        // メタデータ受信時の処理
        flvPlayer.on(flvjs.Events.METADATA_ARRIVED, (metadata) => {
            debugLog('Metadata arrived - starting playback', 'success');
            updateStatus(t('metadataReceived'), 'connected');
            
            // 500ms後に自動再生を試行
            setTimeout(() => {
                if (flvPlayer) {
                    flvPlayer.play().then(() => {
                        debugLog('Auto-play started', 'success');
                        updateStatus(t('streaming'), 'connected');
                    }).catch(err => {
                        debugLog(`Auto-play failed: ${err.message}`, 'warning');
                        updateStatus(t('autoplayFailed'), '');
                    });
                }
            }, 500);
        });
        
        // 読み込み完了
        flvPlayer.on(flvjs.Events.LOADING_COMPLETE, () => {
            debugLog('Loading complete', 'success');
            updateStatus(t('loadingComplete'), 'connected');
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
        updateStatus(t('playerError'), 'error');
        
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

// 品質選択時の自動再生を有効化
if (modeSelect) {
    modeSelect.addEventListener('change', onModeChange);
} else {
    console.error('modeSelect element not found');
}

console.log('Mode change auto-play enabled');


// Unified latency mode function
async function startLatencyModeWithCheck(streamKey, resolution) {
    try {
        // 1. 低遅延ストリーム開始
        debugLog(`Starting latency mode for ${streamKey} → ${resolution}`, 'info');
        const apiUrl = `/api/stream/low-latency/${streamKey}/${resolution}`;
        debugLog(`Calling API: ${apiUrl}`, 'info');
        
        const response = await fetch(apiUrl, {
            method: 'POST'
        });
        
        debugLog(`API response status: ${response.status}`, 'info');
        
        if (!response.ok) {
            debugLog(`Latency mode API failed: ${response.status} ${response.statusText}`, 'error');
            if (response.status === 404) {
                debugLog('Low latency API not found - falling back to original stream', 'warning');
            }
            return false;
        }
        
        const result = await response.json();
        debugLog(`Latency mode API response: ${JSON.stringify(result)}`, 'info');
        
        // 2. ストリーム利用可能性をチェック（最大30秒間）
        const streamPath = `${streamKey}_${resolution}`;
        const maxRetries = 60; // 30秒間 (500ms * 60)
        let retries = 0;
        
        debugLog(`Checking stream availability for: ${streamPath}`, 'info');
        updateStatus(`${resolution} ${t('preparing')} (${retries}/${maxRetries})`, 'connecting');
        
        while (retries < maxRetries) {
            try {
                // 簡単なHEADリクエストでストリーム存在確認
                const checkUrl = `http://${window.location.hostname}:8000/live/${streamPath}.flv`;
                debugLog(`Checking URL: ${checkUrl}`, 'info');
                
                const checkResponse = await fetch(checkUrl, { 
                    method: 'HEAD',
                    signal: AbortSignal.timeout(3000) // 3秒タイムアウト
                });
                
                debugLog(`Check response: ${checkResponse.status} ${checkResponse.statusText}`, 'info');
                
                if (checkResponse.ok || checkResponse.status === 200) {
                    debugLog(`Stream is ready: ${streamPath}`, 'success');
                    updateStatus(`${resolution} ${t('ready')}`, 'connected');
                    return true;
                }
            } catch (error) {
                // 接続エラーは期待される（ストリームが準備中）
                debugLog(`Stream not ready yet: ${streamPath} (${retries + 1}/${maxRetries}) - ${error.message}`, 'info');
            }
            
            retries++;
            updateStatus(`${resolution} ${t('preparing')} (${retries}/${maxRetries})`, 'connecting');
            
            // 500ms待機
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        debugLog(`Stream availability check timed out: ${streamPath}`, 'error');
        updateStatus(`${resolution} ${t('error')}`, 'error');
        return false;
        
    } catch (error) {
        debugLog(`Latency mode setup failed: ${error.message}`, 'error');
        return false;
    }
}

// Legacy low latency function removed - replaced with startLatencyModeWithCheck

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
            
            // 自動再生を無効化 - 手動制御のみ
            // if (flvPlayer) {
            //     setTimeout(() => {
            //         playStream();
            //     }, 1000);
            // }
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
    debugLog(`Mode changed to: ${modeSelect.value}`, 'info');
    
    // 適切な切り替え時間
    if (flvPlayer) {
        debugLog('Stopping current stream for mode change', 'info');
        stopStream();
        
        // 適切に停止してから新しいモードで開始
        setTimeout(() => {
            debugLog('Starting new stream after mode change', 'info');
            playStream();
        }, 600); // 適切な待機時間
    } else {
        // プレイヤーがアクティブでない場合は即座に再生開始
        debugLog('No active player, starting immediately', 'info');
        playStream();
    }
}

// Emergency stop function removed for simplicity

// Make functions global for onclick handlers
window.copyRtmpUrl = copyRtmpUrl;
window.playStream = playStream;


// Auto-connect variables (moved from duplicate declaration)
// autoConnectEnabled and lastStreamCount are declared at the top of the file



// シンプルな自動接続（全モード対応）
function checkAndAutoConnect() {
    // 現在の品質設定に関係なく、ストリームがあるかチェック
    const mode = modeSelect ? modeSelect.value : 'original';
    
    fetch('/api/streams')
        .then(response => response.json())
        .then(streams => {
            console.log('Auto-connect check - streams:', streams.length, 'flvPlayer:', !!flvPlayer, 'mode:', mode);
            
            // ストリームがあり、プレイヤーがなく、クールダウン期間を過ぎている場合のみ再生
            const now = Date.now();
            if (streams.length > 0 && !flvPlayer && !isInitializing && 
                (now - autoPlayState.lastAttempt) > autoPlayState.cooldownPeriod) {
                
                console.log(`🎥 Auto-connecting to stream (${mode} mode)...`);
                updateStatus(t('streamDetected'), 'connecting');
                autoPlayState.lastAttempt = now;
                
                // 低遅延モードの場合は少し長めに待つ
                const delay = mode === 'original' ? 1000 : 2000;
                setTimeout(() => {
                    playStream();
                }, delay);
            }
            
            // ストリームがなくなったらプレイヤーを停止
            if (streams.length === 0 && flvPlayer) {
                console.log('❌ No streams available, stopping player');
                stopStream();
                updateStatus(t('streamEnded'), '');
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

// 自動接続の定期チェックを有効化（条件を厳密に）
setInterval(() => {
    updateStreamList();
    checkAndAutoConnect();
}, 5000); // 頻度を2秒から5秒に変更

console.log('Periodic auto-connect checks enabled (5 second interval)');

// Initialize app when DOM is ready (auto-connect disabled)
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing app...');
    console.log('rtmpUrlElement:', rtmpUrlElement);

    fetchServerInfo();
    updateStreamList();
    
    // 自動接続チェックは無効化
    // setTimeout(() => {
    //     checkAndAutoConnect();
    // }, 1000);
    
    console.log('App initialized - manual connection only');
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
    
    // 自動接続チェックは無効化
    // setTimeout(() => {
    //     checkAndAutoConnect();
    // }, 1000);
    
    console.log('App initialized - manual connection only');
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

// ログの定期更新を無効化
// setInterval(updateLogs, 3000);

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

// 初期ログ取得を無効化
// updateLogs();

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
        updateStatus(t('rtmpUrlCopied'), 'connected');
        setTimeout(() => {
            updateStatus(t('disconnected'), '');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy: ', err);
        updateStatus(t('copyFailed'), 'error');
    });
}

// DJI Connection guide button
const djiConnectionBtn = document.getElementById('djiGoggles3Btn');
if (djiConnectionBtn) {
    djiConnectionBtn.addEventListener('click', () => {
        window.open('connection-guide.html', '_blank');
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

// URL パラメータによる自動再生を無効化
// const urlParams = new URLSearchParams(window.location.search);
// const autoPlay = urlParams.get('autoplay');
// if (autoPlay === 'true') {
//     // Wait for flv.js to load before auto-playing
//     setTimeout(() => {
//         if (checkFlvJsAvailability()) {
//             playStream();
//         }
//     }, 1000);
// }