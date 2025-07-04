#!/bin/bash

echo "=== RTMP Viewer テストスクリプト ==="
echo ""

# 1. サーバーを停止
echo "1. 既存のサーバーを停止..."
pkill -f "node server.js" 2>/dev/null
lsof -ti:1935,8000,8080 | xargs kill -9 2>/dev/null
sleep 2

# 2. サーバーを起動
echo "2. サーバーを起動..."
npm start &
SERVER_PID=$!
sleep 3

# 3. サーバー状態確認
echo ""
echo "3. サーバー状態:"
echo "   RTMP: rtmp://192.168.1.17:1935/live/stream"
echo "   Web: http://192.168.1.17:8080"
echo ""

# 4. テスト配信
echo "4. テスト配信を開始 (10秒間)..."
ffmpeg -re -f lavfi -i testsrc2=size=640x360:rate=30 -t 10 -c:v libx264 -preset ultrafast -f flv rtmp://192.168.1.17:1935/live/stream -loglevel error &
FFMPEG_PID=$!

echo ""
echo "5. ブラウザで確認:"
echo "   http://192.168.1.17:8080"
echo ""
echo "   配信が自動的に開始されるはずです"
echo ""
echo "Ctrl+C で終了"

# 終了待ち
wait $FFMPEG_PID
kill $SERVER_PID 2>/dev/null