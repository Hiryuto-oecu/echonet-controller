# ECHONET Lite Web Controller

ECHONETプロトコルに対応したスマートホーム機器をWebブラウザから制御できるNode.jsアプリケーションです。

## 概要

このプロジェクトは、ECHONET Lite プロトコルを使用してスマートホーム機器（特にエアコン）をネットワーク経由で発見し、Webインターフェースから制御することができます。

## 機能

- **機器自動発見**: ネットワーク上のECHONET Lite対応機器を自動的にスキャン
- **Webインターフェース**: ブラウザからアクセス可能な直感的な操作画面
- **リアルタイム制御**: Socket.IOを使用したリアルタイム通信
- **エアコン制御**: 温度設定、運転モード、風量調整など

## システム要件

- Node.js (v14以上)
- npm
- ECHONET Lite対応のスマートホーム機器

## インストール

1. リポジトリをクローン:
```bash
git clone https://github.com/Hiryuto-oecu/echonet-controller.git
cd echonet-controller
```

2. 依存関係をインストール:
```bash
npm install
```

## 使用方法

1. サーバーを起動:
```bash
npm start
```

2. ブラウザで以下のURLにアクセス:
```
http://localhost:3000
```

3. 「端末スキャン開始」ボタンをクリックして機器を検出

4. 検出されたエアコンをクリックして制御画面にアクセス

## プロジェクト構成

```
echonet-controller/
├── server.js           # メインサーバーファイル
├── package.json        # プロジェクト設定
├── README.md          # このファイル
└── public/            # Webクライアント
    ├── index.html     # メインページ
    ├── client.js      # クライアントサイドJS
    ├── control.html   # 機器制御ページ
    └── control.js     # 制御機能JS
```

## 技術仕様

- **バックエンド**: Node.js, Express.js
- **リアルタイム通信**: Socket.IO
- **プロトコル**: ECHONET Lite over UDP
- **フロントエンド**: HTML5, CSS3, JavaScript

## 対応機器

現在、以下の機器種別に対応しています：
- エアコン (0x0130)
- その他のECHONET Lite対応機器（表示のみ）

## ライセンス

MIT License

## 貢献

プルリクエストやIssueの投稿を歓迎します。

## 注意事項

- 本ソフトウェアはローカルネットワーク内での使用を前提としています
- セキュリティ機能は実装されていないため、外部ネットワークからのアクセスは推奨しません
