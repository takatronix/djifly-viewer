# DJI Fly Stream Viewer

DJI ドローンのライブストリーミングをPCで受信・視聴するためのアプリケーションです。
DJI FlyアプリからRTMP配信を受信し、低遅延で視聴できます。DJIとついていますが、RTMP配信を受信するだけのアプリなので、OBSや他の配信ソフトウェアから配信することも可能です。


![DJI Fly Stream Viewer](https://img.shields.io/badge/DJI-Fly%20Stream%20Viewer-blue?style=for-the-badge&logo=dji)

## 🎯 主な機能

- **📡 RTMP配信受信**: DJI FlyアプリやOBSなどからの配信を受信
- **🎥 低遅延視聴**: 複数の遅延モードで最適な視聴体験
- **📱 DJI Goggles3対応**: 詳細な接続ガイド付き
- **🌐 Web UI**: 使いやすい日本語インターフェース
- **⚡ 解像度変換**: リアルタイムで解像度を変更可能

## 🚀 クイックスタート

### 1. アプリの起動

#### DMGファイルから（推奨）
#### DMGファイルから（推奨）
1. [リリースページ](https://github.com/yourusername/dji-fly-stream-viewer/releases)から最新の`.dmg`ファイルをダウンロード
2. ダウンロードした`.dmg`ファイルをダブルクリック
3. 表示されたウィンドウで「DJI Fly Stream Viewer」アイコンをApplicationsフォルダにドラッグ
4. アプリケーションフォルダから「DJI Fly Stream Viewer」を起動

#### Windows
1. [リリースページ](https://github.com/yourusername/dji-fly-stream-viewer/releases)から最新の`.exe`インストーラーをダウンロード
2. ダウンロードした`.exe`ファイルをダブルクリック
3. インストールウィザードの指示に従ってインストール
4. デスクトップまたはスタートメニューから「DJI Fly Stream Viewer」を起動


### 2. DJI Flyアプリでの設定

1. DJI Flyアプリを開く
2. 設定 → ライブストリーミング
3. 「カスタムRTMP」を選択
4. DJIゴーグルと、DJI Flyを接続
5. DJI FlyでRTMP URLを入力: `rtmp://[表示されたIPアドレス]/live/s`
6. 「GO LIVE」で配信開始

### 3. 視聴開始

アプリの「配信再生」ボタンを押すとライブ映像が表示されます。

## 📋 詳細な使い方

### RTMP配信の設定

| 項目 | 推奨値 |
|------|--------|
| 解像度 | 1080p (高品質) / 720p (安定性重視) |
| ビットレート | 2-4 Mbps |
| フレームレート | 30fps |
| コーデック | H.264 |

### 遅延モードの選択

- **標準モード**: 高画質・安定性重視
- **低遅延モード**: 遅延を抑えたい場合
- **超低遅延モード**: 最小遅延（画質とのトレードオフ）

### 解像度プリセット

| 解像度 | 用途 |
|--------|------|
| オリジナル | 配信元の品質をそのまま |
| 1080p | 高画質視聴 |
| 720p | バランス型 |
| 480p | 低帯域環境 |
| 360p | 最小データ量 |
| 240p | 超低遅延専用 |

## 🛠️ システム要件

### 最小要件
- **OS**: macOS 10.14 以降
- **CPU**: Intel Core i3 / Apple M1 以降
- **メモリ**: 4GB RAM
- **ネットワーク**: 有線LAN推奨

### 推奨要件
- **OS**: macOS 12.0 以降
- **CPU**: Intel Core i5 / Apple M1 Pro 以降
- **メモリ**: 8GB RAM
- **ネットワーク**: ギガビット有線LAN

## 📱 対応デバイス

### DJI ドローン
- DJI Mini 3 / Mini 3 Pro
- DJI Air 2S / Air 3
- DJI Mavic 3シリーズ
- DJI FPVシリーズ

### DJI Goggles
- DJI Goggles 3
- DJI Goggles 2
- DJI FPV Goggles

### 配信ソフト
- DJI Flyアプリ
- OBS Studio
- Streamlabs OBS

## 🔧 トラブルシューティング

#### 配信が接続できない
1. ファイアウォールの設定を確認
2. ポート1935, 8000, 8080が開放されているか確認
3. 同一ネットワーク内にいるか確認

#### 映像が途切れる・カクつく
1. Wi-Fiの場合は有線LANに変更
2. 解像度を下げる（720p → 480p）
3. 超低遅延モードを無効にする

#### 音声が出ない
1. ブラウザの音声設定を確認
2. DJI Flyアプリの音声設定を確認
3. システムの音量設定を確認

### ポート使用状況の確認
```bash
# 使用中のポートを確認
lsof -i :1935 -i :8000 -i :8080
```

### ログの確認
```bash
# アプリのログを確認（開発モード）
npm run electron
# コンソールでエラーメッセージを確認
```

## 🏗️ 開発情報

### プロジェクト構成
```
dji-fly-viewer/
├── electron/          # Electronメインプロセス
│   └── main.js
├── public/            # Webフロントエンド
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── dji-goggles3-guide.html
├── server.js          # Node.jsサーバー
├── package.json       # 依存関係・ビルド設定
└── dist/             # ビルド済みアプリ
```

### 主要な依存関係
- **node-media-server**: RTMPサーバー
- **express**: Webサーバー
- **electron**: デスクトップアプリ化
- **ffmpeg-static**: 動画変換エンジン

### 開発コマンド
```bash
# 依存関係のインストール
npm install

# 開発モードで起動
npm run electron

# サーバーのみ起動
npm start

# DMGビルド
npm run build-mac

# 全プラットフォームビルド
npm run build-all
```

### APIエンドポイント
```
GET  /api/streams        # アクティブストリーム一覧
GET  /api/server-info    # サーバー情報（IP等）
POST /api/stream/low-latency/:streamKey/:resolution
POST /api/stream/stop-low-latency/:streamKey
```

## 📄 ライセンス

MIT License

## 🤝 コントリビューション

1. このリポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

## 📞 サポート

### 問題の報告
- [GitHub Issues](https://github.com/your-username/dji-fly-viewer/issues)で問題を報告
- バグレポートには以下の情報を含めてください：
  - OS・バージョン
  - 使用しているDJIドローン・Goggles
  - エラーメッセージ
  - 再現手順

### 機能要望
- [GitHub Discussions](https://github.com/your-username/dji-fly-viewer/discussions)で機能要望を投稿

## 🔗 関連リンク

- [DJI公式サイト](https://www.dji.com/)
- [DJI Flyアプリ](https://www.dji.com/jp/downloads/djiapp/dji-fly)
- [FFmpeg公式サイト](https://ffmpeg.org/)
- [Node Media Server](https://github.com/illuspas/Node-Media-Server)

---

**🚁 Enjoy your drone streaming with DJI Fly Stream Viewer!**