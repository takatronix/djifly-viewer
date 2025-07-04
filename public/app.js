let flvPlayer = null;
const videoElement = document.getElementById('videoPlayer');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
// Removed old latency buttons
const statusElement = document.getElementById('status');
const streamListElement = document.getElementById('streamList');
const streamSelect = document.getElementById('streamSelect');
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
    currentStreamKey = streamSelect.value || 's';
    const mode = modeSelect.value;
    
    let actualStreamKey = currentStreamKey;
    let streamUrl;
    
    // Stop current stream first
    if (flvPlayer) {
        stopStream();
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
        }, 100);
    } else {
        // Parse mode: low_720p, ultra_240p, etc.
        const [latencyType, resolution] = mode.split('_');
        const isUltra = latencyType === 'ultra';
        
        currentResolutionElement.textContent = resolution.toUpperCase();
        latencyModeElement.textContent = isUltra ? '超低遅延' : '低遅延';
        
        // Start latency mode and wait for it to be ready
        await startLatencyMode(currentStreamKey, resolution, isUltra);
        
        // Wait a bit for FFmpeg to start processing
        setTimeout(() => {
            const suffix = isUltra ? '_ultra' : '';
            actualStreamKey = `${currentStreamKey}_${resolution}${suffix}`;
            streamUrl = `http://${window.location.hostname}:8000/live/${actualStreamKey}.flv`;
            startNewStream(streamUrl);
        }, 2000);
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
    updateStatus('停止', '');
}

function updateStreamList() {
    fetch('/api/streams')
        .then(response => response.json())
        .then(streams => {
            streamListElement.innerHTML = '';
            
            // Update stream selector
            const currentValue = streamSelect.value;
            streamSelect.innerHTML = '<option value="s">📡 デフォルトストリーム</option>';
            
            if (streams.length === 0) {
                const li = document.createElement('li');
                li.textContent = 'アクティブなストリームはありません';
                li.style.textAlign = 'center';
                li.style.color = '#666';
                streamListElement.appendChild(li);
            } else {
                streams.forEach(stream => {
                    // Add to selector
                    const option = document.createElement('option');
                    option.value = stream.stream;
                    option.textContent = `📺 ストリーム: ${stream.stream}`;
                    if (stream.stream === currentValue) {
                        option.selected = true;
                    }
                    streamSelect.appendChild(option);
                    
                    // Add to list
                    const li = document.createElement('li');
                    li.innerHTML = `
                        <div class="stream-item">
                            <span>${stream.app}/${stream.stream}</span>
                            <button onclick="document.getElementById('streamSelect').value='${stream.stream}'; playStream()">再生</button>
                        </div>
                        <span class="viewer-count">${stream.viewers} 視聴者</span>
                    `;
                    streamListElement.appendChild(li);
                });
            }
            
            updateRtmpUrl();
        })
        .catch(error => {
            console.error('Failed to fetch streams:', error);
        });
}

playBtn.addEventListener('click', playStream);
stopBtn.addEventListener('click', stopStream);
modeSelect.addEventListener('change', onModeChange);


// Unified latency mode function
async function startLatencyMode(streamKey, resolution, isUltra) {
    try {
        const ultraParam = isUltra ? '?ultra=true' : '';
        const response = await fetch(`/api/stream/low-latency/${streamKey}/${resolution}${ultraParam}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            const mode = isUltra ? '超低遅延' : '低遅延';
            updateStatus(`${mode}モード開始: ${resolution}`, 'connected');
        } else {
            updateStatus(`Error: ${result.error}`, 'error');
        }
    } catch (error) {
        updateStatus(`Error: ${error.message}`, 'error');
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
    if (flvPlayer) {
        // Restart the stream with new mode settings
        playStream();
    }
}

// Make functions global for onclick handlers
window.copyRtmpUrl = copyRtmpUrl;
window.playStream = playStream;


// Auto-connect variables
let autoConnectEnabled = true;
let lastStreamCount = 0;

// Modified update stream list with auto-connect
function checkAndAutoConnect() {
    fetch('/api/streams')
        .then(response => response.json())
        .then(streams => {
            // If we found a new stream and player is not active
            if (streams.length > 0 && !flvPlayer && autoConnectEnabled) {
                console.log('Auto-connecting to stream:', streams[0].stream);
                // Check if stream 's' exists in the list
                const sStream = streams.find(s => s.stream === 's');
                if (sStream) {
                    streamSelect.value = 's';
                } else {
                    streamSelect.value = streams[0].stream;
                }
                // Add delay to ensure stream is ready
                setTimeout(() => {
                    playStream();
                }, 1000);
                autoConnectEnabled = false; // Disable auto-connect after first connection
            }
            
            // Re-enable auto-connect if all streams are gone
            if (streams.length === 0 && lastStreamCount > 0) {
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
        const response = await fetch('/api/server-info');
        serverInfo = await response.json();
        console.log('Server info:', serverInfo);
        updateRtmpUrl(); // Update URL with correct IP
    } catch (error) {
        console.error('Failed to fetch server info:', error);
    }
}

// Update stream list every 5 seconds
setInterval(() => {
    updateStreamList();
    checkAndAutoConnect();
}, 5000);

// Initialize app
fetchServerInfo();
updateStreamList();
checkAndAutoConnect();

// Update RTMP URL display
function updateRtmpUrl() {
    const streamKey = streamSelect.value || 's';
    const hostname = serverInfo ? serverInfo.localIP : window.location.hostname;
    rtmpUrlElement.textContent = `rtmp://${hostname}/live/${streamKey}`;
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