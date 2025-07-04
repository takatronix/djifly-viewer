const NodeMediaServer = require('node-media-server');
const express = require('express');
const path = require('path');
const { spawn } = require('child_process');

// Get bundled FFmpeg path
let ffmpegPath = 'ffmpeg'; // fallback to system ffmpeg
try {
  ffmpegPath = require('ffmpeg-static');
  console.log('Using bundled FFmpeg:', ffmpegPath);
} catch (error) {
  console.log('Using system FFmpeg (bundled not found)');
}


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
    mediaroot: './media'
  }
};

const nms = new NodeMediaServer(config);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/live', express.static(path.join(__dirname, 'media/live')));

// Store active streams
const activeStreams = new Map();

// Store resolution conversion processes
const resolutionProcesses = new Map();

// Store logs
const logs = [];
const MAX_LOGS = 1000;

// Log helper function
function addLog(type, message) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type: type,
    message: message
  };
  
  logs.push(logEntry);
  
  // Keep only recent logs
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
  
  // Also log to console
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// Resolution presets for low latency
const RESOLUTION_PRESETS = {
  '480p': { width: 854, height: 480, bitrate: '1M', fps: 30 },
  '720p': { width: 1280, height: 720, bitrate: '2M', fps: 30 },
  '1080p': { width: 1920, height: 1080, bitrate: '4M', fps: 30 },
  '360p': { width: 640, height: 360, bitrate: '500k', fps: 30 },
  '240p': { width: 426, height: 240, bitrate: '300k', fps: 30 }
};

// Ultra low latency presets with packet dropping
const ULTRA_LOW_LATENCY_PRESETS = {
  '480p': { width: 854, height: 480, bitrate: '800k', fps: 30, dropThreshold: 50 },
  '720p': { width: 1280, height: 720, bitrate: '1.5M', fps: 30, dropThreshold: 100 },
  '360p': { width: 640, height: 360, bitrate: '400k', fps: 30, dropThreshold: 30 },
  '240p': { width: 426, height: 240, bitrate: '200k', fps: 30, dropThreshold: 20 }
};


// Start low-latency stream with resolution conversion
function startLowLatencyStream(streamKey, resolution, ultraLowLatency = false) {
  if (resolutionProcesses.has(streamKey)) {
    console.log(`Low latency stream already running for: ${streamKey}`);
    return;
  }

  const preset = ultraLowLatency ? ULTRA_LOW_LATENCY_PRESETS[resolution] : RESOLUTION_PRESETS[resolution];
  if (!preset) {
    throw new Error(`Invalid resolution preset: ${resolution}`);
  }

  const inputUrl = `rtmp://localhost:1935/live/${streamKey}`;
  const outputUrl = `rtmp://localhost:1935/live/${streamKey}_${resolution}${ultraLowLatency ? '_ultra' : ''}`;

  // Ultra low latency FFmpeg arguments with packet dropping
  const ffmpegArgs = [
    '-i', inputUrl,
    '-c:v', 'libx264',
    '-preset', ultraLowLatency ? 'superfast' : 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', ultraLowLatency ? '28' : '23',
    '-maxrate', preset.bitrate,
    '-bufsize', ultraLowLatency ? '500k' : '1M',
    '-g', ultraLowLatency ? '15' : '30', // Smaller GOP for ultra low latency
    '-keyint_min', ultraLowLatency ? '15' : '30',
    '-r', preset.fps.toString(),
    '-s', `${preset.width}x${preset.height}`,
    '-c:a', 'aac',
    '-b:a', ultraLowLatency ? '64k' : '128k',
    '-ar', '44100',
    '-f', 'flv'
  ];

  // Add ultra low latency specific options
  if (ultraLowLatency) {
    ffmpegArgs.push(
      '-fflags', '+nobuffer+fastseek+flush_packets',
      '-flags', '+low_delay',
      '-strict', 'experimental',
      '-avoid_negative_ts', 'disabled',
      '-flush_packets', '1',
      '-max_delay', '0'
    );
  }

  ffmpegArgs.push(outputUrl);

  console.log(`Starting ${ultraLowLatency ? 'ULTRA' : ''} low latency stream: ${streamKey} → ${resolution}`);
  
  const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
  
  ffmpegProcess.stdout.on('data', (data) => {
    console.log(`Low latency ${streamKey}: ${data}`);
  });

  ffmpegProcess.stderr.on('data', (data) => {
    console.log(`Low latency ${streamKey} stderr: ${data}`);
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`Low latency stream ${streamKey} stopped with code ${code}`);
    resolutionProcesses.delete(streamKey);
  });

  ffmpegProcess.on('error', (error) => {
    console.error(`Low latency stream ${streamKey} error:`, error);
    resolutionProcesses.delete(streamKey);
  });

  resolutionProcesses.set(streamKey, {
    process: ffmpegProcess,
    resolution: resolution,
    outputStream: `${streamKey}_${resolution}${ultraLowLatency ? '_ultra' : ''}`,
    ultraLowLatency: ultraLowLatency
  });
}

// Stop low-latency stream
function stopLowLatencyStream(streamKey) {
  const streamData = resolutionProcesses.get(streamKey);
  if (streamData) {
    // Force kill the process to ensure it stops
    streamData.process.kill('SIGKILL');
    
    // Wait a bit then delete from map
    setTimeout(() => {
      resolutionProcesses.delete(streamKey);
    }, 100);
    
    console.log(`Stopped low latency stream: ${streamKey}`);
  }
}

app.get('/api/streams', (req, res) => {
  const streams = [];
  
  activeStreams.forEach((info, streamKey) => {
    streams.push({
      app: 'live',
      stream: streamKey,
      viewers: info.viewers || 0
    });
  });
  
  res.json(streams);
});

// API endpoint to start low-latency stream with resolution conversion
app.post('/api/stream/low-latency/:streamKey/:resolution', (req, res) => {
  const { streamKey, resolution } = req.params;
  const { ultra } = req.query; // ?ultra=true for ultra low latency
  
  console.log(`Low latency request: streamKey=${streamKey}, resolution=${resolution}, ultra=${ultra}`);
  console.log('Active streams:', Array.from(activeStreams.keys()));
  
  if (!activeStreams.has(streamKey)) {
    return res.status(404).json({ error: 'Stream not found' });
  }
  
  const presets = ultra === 'true' ? ULTRA_LOW_LATENCY_PRESETS : RESOLUTION_PRESETS;
  if (!presets[resolution]) {
    return res.status(400).json({ error: 'Invalid resolution preset' });
  }
  
  try {
    startLowLatencyStream(streamKey, resolution, ultra === 'true');
    const mode = ultra === 'true' ? 'ULTRA low latency' : 'Low latency';
    res.json({ success: true, message: `${mode} stream started: ${streamKey} at ${resolution}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to stop low-latency stream
app.post('/api/stream/stop-low-latency/:streamKey', (req, res) => {
  const { streamKey } = req.params;
  
  try {
    stopLowLatencyStream(streamKey);
    res.json({ success: true, message: `Low latency stream stopped: ${streamKey}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint for standard resolution conversion
app.post('/api/stream/standard-resolution/:streamKey/:resolution', (req, res) => {
  const { streamKey, resolution } = req.params;
  
  if (!activeStreams.has(streamKey)) {
    return res.status(404).json({ error: 'Stream not found' });
  }
  
  if (!RESOLUTION_PRESETS[resolution]) {
    return res.status(400).json({ error: 'Invalid resolution preset' });
  }
  
  try {
    // Use standard quality settings (higher quality than low latency)
    startStandardResolutionStream(streamKey, resolution);
    res.json({ success: true, message: `Standard resolution stream started: ${streamKey} at ${resolution}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start standard resolution stream (higher quality than low latency)
function startStandardResolutionStream(streamKey, resolution) {
  const processKey = `${streamKey}_standard`;
  
  if (resolutionProcesses.has(processKey)) {
    console.log(`Standard resolution stream already running for: ${streamKey}`);
    return;
  }

  const preset = RESOLUTION_PRESETS[resolution];
  if (!preset) {
    throw new Error(`Invalid resolution preset: ${resolution}`);
  }

  const inputUrl = `rtmp://localhost:1935/live/${streamKey}`;
  const outputUrl = `rtmp://localhost:1935/live/${streamKey}_${resolution}_standard`;

  // Standard quality FFmpeg arguments
  const ffmpegArgs = [
    '-i', inputUrl,
    '-c:v', 'libx264',
    '-preset', 'medium',  // Better quality than ultrafast
    '-crf', '20',         // Higher quality than low latency
    '-maxrate', preset.bitrate,
    '-bufsize', '2M',     // Larger buffer for stability
    '-g', '60',           // Standard GOP size
    '-keyint_min', '60',
    '-r', preset.fps.toString(),
    '-s', `${preset.width}x${preset.height}`,
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'flv',
    outputUrl
  ];

  console.log(`Starting standard resolution stream: ${streamKey} → ${resolution}`);
  
  const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
  
  ffmpegProcess.stdout.on('data', (data) => {
    console.log(`Standard ${streamKey}: ${data}`);
  });

  ffmpegProcess.stderr.on('data', (data) => {
    console.log(`Standard ${streamKey} stderr: ${data}`);
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`Standard resolution stream ${streamKey} stopped with code ${code}`);
    resolutionProcesses.delete(processKey);
  });

  ffmpegProcess.on('error', (error) => {
    console.error(`Standard resolution stream ${streamKey} error:`, error);
    resolutionProcesses.delete(processKey);
  });

  resolutionProcesses.set(processKey, {
    process: ffmpegProcess,
    resolution: resolution,
    outputStream: `${streamKey}_${resolution}_standard`,
    type: 'standard'
  });
}

// Get available resolution presets
app.get('/api/resolutions', (req, res) => {
  res.json(Object.keys(RESOLUTION_PRESETS));
});

const webPort = 8081;

// Get server info including local IP
app.get('/api/server-info', (req, res) => {
  res.json({
    localIP: localIP,
    rtmpPort: 1935,
    webPort: webPort,
    httpPort: 8000
  });
});

// Get logs API
app.get('/api/logs', (req, res) => {
  const since = req.query.since;
  if (since) {
    // Return logs after specific timestamp
    const filteredLogs = logs.filter(log => log.timestamp > since);
    res.json(filteredLogs);
  } else {
    // Return all logs
    res.json(logs);
  }
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

app.listen(webPort, '0.0.0.0', () => {
  addLog('success', `Webサーバー起動: http://${localIP}:${webPort}`);
  addLog('info', `ローカルアクセス: http://localhost:${webPort}`);
  console.log(`Web server running at http://${localIP}:${webPort}`);
  console.log(`Also accessible at http://localhost:${webPort}`);
});

nms.on('preConnect', (id, args) => {
  console.log('[NodeEvent on preConnect]', `id=${id} args=${JSON.stringify(args)}`);
});

nms.on('postConnect', (id, args) => {
  console.log('[NodeEvent on postConnect]', `id=${id} args=${JSON.stringify(args)}`);
});

nms.on('doneConnect', (id, args) => {
  console.log('[NodeEvent on doneConnect]', `id=${id} args=${JSON.stringify(args)}`);
});

nms.on('prePublish', (id, StreamPath, args) => {
  addLog('info', `[RTMP] 配信準備中: id=${id} StreamPath=${StreamPath}`);
});

nms.on('postPublish', (id, StreamPath, args) => {
  addLog('success', `[RTMP] 配信開始: id=${id} StreamPath=${StreamPath}`);
  // Extract stream key from path - support multiple formats
  let match = /\/live\/(.+)/.exec(StreamPath);
  if (!match) {
    match = /\/(.+)\//.exec(StreamPath);  // Match /xxx/
  }
  if (!match) {
    match = /\/(.+)/.exec(StreamPath);    // Match /xxx
  }
  
  // Debug log to see what we're getting
  addLog('info', `[DEBUG] StreamPath="${StreamPath}", match=${match ? match[1] : 'null'}`);
  
  // Handle specific cases where stream key might be incorrect
  if (match && match[1] === 'lives') {
    addLog('warning', 'Converting "lives" to "s" for compatibility');
    match[1] = 's';
  }
  if (match) {
    const streamKey = match[1];
    addLog('success', `[RTMP] ストリームキー登録: ${streamKey}`);
    activeStreams.set(streamKey, { id, viewers: 0 });
  }
});

nms.on('donePublish', (id, StreamPath, args) => {
  console.log('[NodeEvent on donePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
  // Remove stream when done - support multiple formats  
  let match = /\/live\/(.+)/.exec(StreamPath);
  if (!match) {
    match = /\/(.+)\//.exec(StreamPath);  // Match /xxx/
  }
  if (!match) {
    match = /\/(.+)/.exec(StreamPath);    // Match /xxx
  }
  
  // Handle specific cases where stream key might be incorrect
  if (match && match[1] === 'lives') {
    console.log('Converting "lives" to "s" for cleanup');
    match[1] = 's';
  }
  if (match) {
    const streamKey = match[1];
    console.log(`Removing stream key: ${streamKey} from path: ${StreamPath}`);
    activeStreams.delete(streamKey);
  }
});

nms.on('prePlay', (id, StreamPath, args) => {
  console.log('[NodeEvent on prePlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('postPlay', (id, StreamPath, args) => {
  console.log('[NodeEvent on postPlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('donePlay', (id, StreamPath, args) => {
  console.log('[NodeEvent on donePlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.run();

addLog('success', 'RTMPサーバー起動: ポート1935');
addLog('success', 'HTTP-FLV/HLS/DASHサーバー起動: ポート8000');
addLog('info', `配信URL: rtmp://${localIP}/live/STREAM_KEY`);

console.log('RTMP Server running on port 1935');
console.log('HTTP-FLV/HLS/DASH Server running on port 8000');
console.log(`Stream with: rtmp://${localIP}/live/STREAM_KEY`);

process.on('SIGINT', () => {
  console.log('\nShutting down servers...');
  nms.stop();
  process.exit(0);
});