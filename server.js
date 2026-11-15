const NodeMediaServer = require('node-media-server');
const express = require('express');
const path = require('path');
const http = require('http');
const { Transform } = require('stream');
const { spawn } = require('child_process');

// Get bundled FFmpeg path
let ffmpegPath = 'ffmpeg'; // fallback to system ffmpeg
try {
  ffmpegPath = require('ffmpeg-static');
  console.log('Using bundled FFmpeg:', ffmpegPath);
  
  // Verify the file exists and is executable
  const fs = require('fs');
  if (!fs.existsSync(ffmpegPath)) {
    throw new Error('FFmpeg binary not found at path: ' + ffmpegPath);
  }
  
  // Get absolute path to ensure it works from any working directory
  ffmpegPath = path.resolve(ffmpegPath);
  console.log('Resolved FFmpeg path:', ffmpegPath);
} catch (error) {
  console.log('Using system FFmpeg (bundled not found):', error.message);
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

// FFmpeg reaches the local server by IP: the static Linux FFmpeg build crashes resolving "localhost".
const LOCAL_RTMP = 'rtmp://127.0.0.1:1935/live';
const LOCAL_HTTP_FLV = 'http://127.0.0.1:8000/live';

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

// Resolution presets for low latency (smaller than original 1024x576)
const RESOLUTION_PRESETS = {
  '480p': { width: 480, height: 270, bitrate: '500k', fps: 30 },
  '720p': { width: 720, height: 404, bitrate: '800k', fps: 30 },
  '360p': { width: 360, height: 202, bitrate: '300k', fps: 30 },
  '240p': { width: 240, height: 134, bitrate: '200k', fps: 30 }
};

// Ultra low latency presets with packet dropping
const ULTRA_LOW_LATENCY_PRESETS = {
  '480p': { width: 480, height: 270, bitrate: '300k', fps: 20, dropThreshold: 50 },
  '720p': { width: 640, height: 360, bitrate: '400k', fps: 20, dropThreshold: 100 }
};

// EXTREME low latency presets - 極限設定
const EXTREME_LOW_LATENCY_PRESETS = {
  '480p': { width: 320, height: 180, bitrate: '150k', fps: 10, dropThreshold: 100 },
  '720p': { width: 480, height: 270, bitrate: '200k', fps: 10, dropThreshold: 200 }
};


// Codec names node-media-server detected for a published stream ('H264', 'H265', 'AAC', ...)
function getSourceCodecs(streamKey) {
  const info = activeStreams.get(streamKey);
  const session = info && nms.getSession(info.id);
  return {
    video: (session && session.videoCodecName) || '',
    audio: (session && session.audioCodecName) || ''
  };
}

// node-media-server 2.x stores H.265 as legacy FLV codec id 12 (it rewrites Enhanced RTMP 'hvc1',
// as sent by e.g. Osmo Pocket 4). The bundled FFmpeg (6.1 on Windows, 7.0 on Linux) cannot open
// codec id 12 but reads Enhanced FLV, so H.265 tags are re-wrapped back to 'hvc1' before FFmpeg sees them.
const FOURCC_HVC1 = Buffer.from('hvc1');

function legacyHevcToEnhanced(data) {
  // legacy: [frameType<<4 | 12][packetType][compositionTime x3][payload]
  const frameType = (data[0] >> 4) & 0x07;
  const packetType = data[1]; // 0 = decoder config, 1 = coded frames, 2 = end of sequence
  if (packetType === 1) {
    // ExVideoTagHeader PacketTypeCodedFrames keeps the composition time
    return Buffer.concat([Buffer.from([0x80 | (frameType << 4) | 1]), FOURCC_HVC1, data.subarray(2)]);
  }
  // PacketTypeSequenceStart / PacketTypeSequenceEnd have no composition time
  return Buffer.concat([Buffer.from([0x80 | (frameType << 4) | packetType]), FOURCC_HVC1, data.subarray(5)]);
}

function createEnhancedHevcRewriter() {
  let pending = Buffer.alloc(0);
  let headerDone = false;
  return new Transform({
    transform(chunk, _encoding, done) {
      let buf = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      if (!headerDone) {
        if (buf.length < 13) { // FLV header + PreviousTagSize0
          pending = buf;
          return done();
        }
        this.push(buf.subarray(0, 13));
        buf = buf.subarray(13);
        headerDone = true;
      }
      while (buf.length >= 11) {
        const dataSize = buf.readUIntBE(1, 3);
        const total = 11 + dataSize + 4;
        if (buf.length < total) break;
        const data = buf.subarray(11, 11 + dataSize);
        if ((buf[0] & 0x1f) === 9 && dataSize >= 5 && (data[0] & 0x8f) === 12) {
          const out = legacyHevcToEnhanced(data);
          const header = Buffer.from(buf.subarray(0, 11));
          header.writeUIntBE(out.length, 1, 3);
          const previousTagSize = Buffer.alloc(4);
          previousTagSize.writeUInt32BE(11 + out.length);
          this.push(Buffer.concat([header, out, previousTagSize]));
        } else {
          this.push(Buffer.from(buf.subarray(0, total)));
        }
        buf = buf.subarray(total);
      }
      pending = Buffer.from(buf);
      done();
    }
  });
}

// FFmpeg input for a published stream: RTMP as before, or re-wrapped HTTP-FLV on stdin for H.265.
function sourceInput(streamKey) {
  if (getSourceCodecs(streamKey).video !== 'H265') {
    return { args: ['-i', `${LOCAL_RTMP}/${streamKey}`], attach() {} };
  }
  return {
    args: ['-f', 'flv', '-i', 'pipe:0'],
    attach(ffmpegProcess) {
      addLog('info', `${streamKey}: H.265 source - feeding FFmpeg as Enhanced FLV`);
      ffmpegProcess.stdin.on('error', () => {}); // EPIPE once FFmpeg exits
      const req = http.get(`${LOCAL_HTTP_FLV}/${streamKey}.flv`, (res) => {
        res.pipe(createEnhancedHevcRewriter()).pipe(ffmpegProcess.stdin);
      });
      req.on('error', (error) => {
        addLog('error', `${streamKey}: H.265 source read failed - ${error.message}`);
        ffmpegProcess.stdin.end();
      });
      ffmpegProcess.on('close', () => req.destroy());
    }
  };
}

// Start low-latency stream with resolution conversion
function startLowLatencyStream(streamKey, resolution, ultraLowLatency = false, extremeMode = false) {
  // Create unique process key to prevent conflicts
  const processKey = `${streamKey}_${resolution}${ultraLowLatency ? '_ultra' : ''}${extremeMode ? '_extreme' : ''}`;
  
  if (resolutionProcesses.has(processKey)) {
    console.log(`Low latency stream already running for: ${processKey}`);
    return;
  }

  let preset;
  if (extremeMode) {
    preset = EXTREME_LOW_LATENCY_PRESETS[resolution];
  } else if (ultraLowLatency) {
    preset = ULTRA_LOW_LATENCY_PRESETS[resolution];
  } else {
    preset = RESOLUTION_PRESETS[resolution];
  }
  
  if (!preset) {
    throw new Error(`Invalid resolution preset: ${resolution}`);
  }

  const input = sourceInput(streamKey);  // DJIとOBS両方に対応
  const outputUrl = `${LOCAL_RTMP}/${processKey}`;

  // Simplified FFmpeg arguments for better compatibility
  const ffmpegArgs = [
    ...input.args,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', '28',
    '-maxrate', preset.bitrate,
    '-bufsize', '1M',
    '-g', '30',
    '-r', preset.fps.toString(),
    '-s', `${preset.width}x${preset.height}`,
    '-pix_fmt', 'yuv420p',  // 10-bit sources would otherwise give High 10, which browsers cannot play
    '-c:a', 'aac',
    '-b:a', '64k',
    '-f', 'flv'
  ];

  ffmpegArgs.push(outputUrl);

  const modeName = extremeMode ? 'EXTREME' : (ultraLowLatency ? 'ULTRA' : 'STANDARD');
  
  // Log detailed FFmpeg settings for debugging
  console.log(`=== ${modeName} MODE SETTINGS ===`);
  console.log(`Process Key: ${processKey}`);
  console.log(`Resolution: ${preset.width}x${preset.height} (${resolution})`);
  console.log(`Bitrate: ${preset.bitrate}`);
  console.log(`FPS: ${preset.fps}`);
  console.log(`CRF: ${extremeMode ? '40' : (ultraLowLatency ? '32' : '25')}`);
  console.log(`Buffer: ${extremeMode ? '100k' : (ultraLowLatency ? '300k' : '1M')}`);
  console.log(`GOP: ${extremeMode ? '8' : (ultraLowLatency ? '12' : '30')}`);
  console.log(`Audio: DISABLED (-an)`);
  console.log(`FFmpeg Command: ${ffmpegPath} ${ffmpegArgs.join(' ')}`);
  console.log(`Starting ${modeName} low latency stream: ${streamKey} → ${resolution}`);
  
  // Debug: Check if ffmpeg path exists before spawning
  const fs = require('fs');
  if (!fs.existsSync(ffmpegPath)) {
    throw new Error(`FFmpeg binary not found at path: ${ffmpegPath}`);
  }
  
  console.log(`FFmpeg path verified: ${ffmpegPath}`);
  console.log(`FFmpeg args: ${JSON.stringify(ffmpegArgs)}`);
  
  const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env
  });
  input.attach(ffmpegProcess);
  
  ffmpegProcess.stdout.on('data', (data) => {
    console.log(`[${processKey}] STDOUT: ${data}`);
    addLog('info', `${processKey}: ${data}`);
  });

  ffmpegProcess.stderr.on('data', (data) => {
    const dataStr = data.toString();
    console.log(`[${processKey}] STDERR: ${dataStr}`);
    addLog('info', `${processKey} stderr: ${dataStr}`);
    
    // FFmpegの成功メッセージを検出
    if (dataStr.includes('Stream mapping:') || dataStr.includes('Output #0')) {
      addLog('success', `${processKey}: FFmpeg処理開始成功`);
    }
    if (dataStr.includes('frame=') && dataStr.includes('fps=')) {
      addLog('info', `${processKey}: 処理中... ${dataStr.trim()}`);
    }
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`Low latency stream ${processKey} stopped with code ${code}`);
    addLog('info', `低遅延ストリーム停止: ${processKey} (code: ${code})`);
    resolutionProcesses.delete(processKey);
  });

  ffmpegProcess.on('error', (error) => {
    console.error(`Low latency stream ${processKey} error:`, error);
    addLog('error', `低遅延ストリームエラー: ${processKey} - ${error.message}`);
    resolutionProcesses.delete(processKey);
  });

  resolutionProcesses.set(processKey, {
    process: ffmpegProcess,
    resolution: resolution,
    outputStream: processKey,
    ultraLowLatency: ultraLowLatency,
    extremeMode: extremeMode,
    streamKey: streamKey
  });
}

// Stop low-latency stream
function stopLowLatencyStream(streamKey) {
  // Stop all processes for this stream key
  const keysToDelete = [];
  
  for (const [processKey, streamData] of resolutionProcesses.entries()) {
    if (streamData.streamKey === streamKey) {
      try {
        streamData.process.kill('SIGKILL');
        keysToDelete.push(processKey);
        console.log(`Stopped low latency stream: ${processKey}`);
      } catch (error) {
        console.error(`Error stopping process ${processKey}:`, error);
      }
    }
  }
  
  // Clean up after a short delay
  setTimeout(() => {
    keysToDelete.forEach(key => resolutionProcesses.delete(key));
  }, 100);
}

app.get('/api/streams', (req, res) => {
  const streams = [];
  
  activeStreams.forEach((info, streamKey) => {
    const codecs = getSourceCodecs(streamKey);
    streams.push({
      app: 'live',
      stream: streamKey,
      viewers: info.viewers || 0,
      videoCodec: codecs.video,
      audioCodec: codecs.audio
    });
  });
  
  res.json(streams);
});

// API endpoint to start low-latency stream with resolution conversion
app.post('/api/stream/low-latency/:streamKey/:resolution', (req, res) => {
  const { streamKey, resolution } = req.params;
  const { ultra = 'false', extreme = 'false' } = req.query; // Default to 'false' if not provided
  
  console.log(`=== 低遅延モード要求 ===`);
  console.log(`StreamKey: ${streamKey}`);
  console.log(`Resolution: ${resolution}`);
  console.log(`Ultra: ${ultra}`);
  console.log(`Extreme: ${extreme}`);
  console.log(`Active streams: ${Array.from(activeStreams.keys())}`);
  addLog('info', `低遅延モード要求: ${streamKey} → ${resolution} (ultra=${ultra}, extreme=${extreme})`);
  
  if (!activeStreams.has(streamKey)) {
    const errorMsg = `Stream not found: ${streamKey}`;
    console.error(`❌ ${errorMsg}`);
    addLog('error', errorMsg);
    return res.status(404).json({ error: errorMsg });
  }
  
  let presets;
  let mode;
  const isUltraMode = ultra === 'true';
  const isExtremeMode = extreme === 'true';
  
  if (isExtremeMode) {
    presets = EXTREME_LOW_LATENCY_PRESETS;
    mode = 'EXTREME low latency';
  } else if (isUltraMode) {
    presets = ULTRA_LOW_LATENCY_PRESETS;
    mode = 'ULTRA low latency';
  } else {
    // For standard low latency mode, use RESOLUTION_PRESETS
    presets = RESOLUTION_PRESETS;
    mode = 'Low latency';
  }
  
  if (!presets[resolution]) {
    const errorMsg = `Invalid resolution preset: ${resolution}`;
    console.error(`❌ ${errorMsg}`);
    addLog('error', errorMsg);
    return res.status(400).json({ error: errorMsg });
  }
  
  try {
    console.log(`✅ 低遅延ストリーム開始: ${streamKey} → ${resolution} (${mode})`);
    addLog('success', `${mode}ストリーム開始: ${streamKey} → ${resolution}`);
    startLowLatencyStream(streamKey, resolution, isUltraMode, isExtremeMode);
    
    // プロセス開始後、少し待ってから状態を確認
    setTimeout(() => {
      const processKey = `${streamKey}_${resolution}${isUltraMode ? '_ultra' : ''}${isExtremeMode ? '_extreme' : ''}`;
      const processInfo = resolutionProcesses.get(processKey);
      if (processInfo) {
        console.log(`✅ FFmpegプロセス確認OK: ${processKey}`);
        addLog('success', `FFmpegプロセス実行中: ${processKey}`);
      } else {
        console.log(`❌ FFmpegプロセス確認失敗: ${processKey}`);
        addLog('error', `FFmpegプロセス見つからず: ${processKey}`);
      }
    }, 2000);
    
    res.json({ 
      success: true, 
      message: `${mode} stream started: ${streamKey} at ${resolution}`,
      processKey: `${streamKey}_${resolution}`,
      ffmpegPath: ffmpegPath,
      preset: presets[resolution]
    });
  } catch (error) {
    const errorMsg = `Failed to start low latency stream: ${error.message}`;
    console.error(`❌ ${errorMsg}`);
    addLog('error', errorMsg);
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

// API endpoint to stop ALL FFmpeg processes (emergency cleanup)
app.post('/api/stream/stop-all', (req, res) => {
  try {
    console.log('Emergency cleanup: Stopping all FFmpeg processes');
    const processCount = resolutionProcesses.size;
    
    for (const [processKey, proc] of resolutionProcesses.entries()) {
      try {
        console.log(`Force killing process: ${processKey}`);
        proc.process.kill('SIGKILL');
      } catch (e) {
        console.error(`Failed to kill process ${processKey}:`, e);
      }
    }
    
    resolutionProcesses.clear();
    addLog('warning', `緊急停止: ${processCount}個のFFmpegプロセスを停止しました`);
    
    res.json({ 
      success: true, 
      message: `Stopped ${processCount} FFmpeg processes`,
      processCount: processCount
    });
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

  const input = sourceInput(streamKey);
  const outputUrl = `${LOCAL_RTMP}/${streamKey}_${resolution}_standard`;

  // Standard quality FFmpeg arguments
  const ffmpegArgs = [
    ...input.args,
    '-c:v', 'libx264',
    '-preset', 'medium',  // Better quality than ultrafast
    '-crf', '20',         // Higher quality than low latency
    '-maxrate', preset.bitrate,
    '-bufsize', '2M',     // Larger buffer for stability
    '-g', '60',           // Standard GOP size
    '-keyint_min', '60',
    '-r', preset.fps.toString(),
    '-s', `${preset.width}x${preset.height}`,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'flv',
    outputUrl
  ];

  console.log(`Starting standard resolution stream: ${streamKey} → ${resolution}`);
  
  const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
  input.attach(ffmpegProcess);
  
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

// H.264 copy of an H.265 source at the source size, for players without an H.265 decoder
function startCompatStream(streamKey) {
  const processKey = `${streamKey}_h264`;

  if (resolutionProcesses.has(processKey)) {
    console.log(`H.264 compat stream already running for: ${streamKey}`);
    return;
  }

  const input = sourceInput(streamKey);
  const ffmpegArgs = [
    ...input.args,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-g', '60',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'flv',
    `${LOCAL_RTMP}/${processKey}`
  ];

  addLog('info', `H.264変換開始: ${streamKey} → ${processKey}`);
  const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
  input.attach(ffmpegProcess);

  ffmpegProcess.stderr.on('data', (data) => {
    console.log(`[${processKey}] STDERR: ${data}`);
  });

  ffmpegProcess.on('close', (code) => {
    addLog(code ? 'error' : 'info', `H.264変換停止: ${processKey} (code: ${code})`);
    resolutionProcesses.delete(processKey);
  });

  ffmpegProcess.on('error', (error) => {
    addLog('error', `H.264変換エラー: ${processKey} - ${error.message}`);
    resolutionProcesses.delete(processKey);
  });

  resolutionProcesses.set(processKey, {
    process: ffmpegProcess,
    resolution: 'source',
    outputStream: processKey,
    streamKey: streamKey,
    type: 'compat'
  });
}

// API endpoint to start the H.264 compat stream (stopped by stop-low-latency like the others)
app.post('/api/stream/compat/:streamKey', (req, res) => {
  const { streamKey } = req.params;

  if (!activeStreams.has(streamKey)) {
    return res.status(404).json({ error: 'Stream not found' });
  }

  try {
    startCompatStream(streamKey);
    res.json({ success: true, outputStream: `${streamKey}_h264` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

function cleanup() {
  console.log('Cleaning up FFmpeg processes...');
  for (const [processKey, proc] of resolutionProcesses.entries()) {
    try {
      console.log(`Killing process: ${processKey}`);
      proc.process.kill('SIGKILL');
    } catch (e) {
      console.error(`Failed to kill ffmpeg process ${processKey}:`, e);
    }
  }
  resolutionProcesses.clear();
  process.exit();
}