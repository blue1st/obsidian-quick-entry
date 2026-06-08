# Obsidian Quick Entry

システムトレイ（メニューバー）から即座に起動し、Obsidianのデイリーノートや登録した任意のノートへ複数行のメモをすばやく追記できるデスクトップウィジェットです。

Macのメニューバーになじむ半透明（グラスモーフィズム）のプレミアムなデザインを採用し、キーボード操作だけでメモの記述から保存、非表示までを完結させられます。

---

## 主な機能

* **システムトレイ常駐**: メニューバーのアイコンをクリックするだけでウィジェットの表示/非表示を切り替えられます。ウィンドウの外をクリックするか、`Esc`キーを押すことで自動的に非表示になります。
* **複数行テキストエリア**: 改行を含めた長文のメモやアイデアをそのまま入力できます。
* **書き込み先の切り替え**: デフォルトの「デイリーノート」に加え、よく使うファイルをあらかじめ設定に登録し、メニューから切り替えて追記できます。
* **日時の見出し自動挿入**: メモを追記する際、入力した文章の前に `## YYYY-MM-DD HH:mm` の見出しが自動で挿入され、後から振り返りやすくなります。
* **前回の状態の保持**: 最後に選択した書き込み先や、指定したVault（保管庫）の名前を記憶し、起動時に自動で適用します。
* **OS起動時の自動起動**: システムログイン時にウィジェットを自動起動する設定が可能です。

---

## 前提条件

本アプリはObsidian公式の **Command Line Interface (CLI)** を使用して動作します。以下の準備を行ってください：

1. **Obsidianのバージョン確認**: v1.12以上であることを確認してください。
2. **CLIの有効化**:
   * Obsidianの **「設定 (Settings)」→「一般 (General)」** を開きます。
   * **「コマンドラインインターフェース (Command line interface)」** をオンにします。
   * 画面の指示に従い、`obsidian` コマンドのシステムパス（PATH）への登録を完了させます。
3. **Obsidianの起動**: CLIの性質上、書き込み時にObsidian本体が起動している必要があります（起動していない場合、自動的に起動します）。

---

## 導入方法

### 1. Homebrew (macOS) - 推奨

[blue1st/homebrew-taps](https://github.com/blue1st/homebrew-taps) を利用して、以下のコマンドで簡単にインストールできます。
インストール時にゲートキーパー（未確認の開発元警告）を自動で回避する設定（`xattr` の解除）が適用されるため、推奨のインストール方法です。

```bash
# Tapを追加してインストール
brew install --cask blue1st/taps/obsidian-quick-entry
```

### 2. 手動インストール (GitHub Releases)

[GitHub Releases](https://github.com/blue1st/obsidian-quick-entry/releases) から、お使いの環境に対応した最新のインストーラーをダウンロードしてください。

* **macOS**: `Obsidian.Quick.Entry_X.X.X_universal.dmg` (Intel / Apple Silicon 両対応)
  * 手動ダウンロードした場合は、起動時にセキュリティ警告が出る可能性があります。その場合はターミナルを開き、以下のコマンドを実行して実行許可を与えてください：
    ```bash
    xattr -cr "/Applications/Obsidian Quick Entry.app"
    ```
* **Windows**:
  * 一般的なPC: `Obsidian.Quick.Entry_X.X.X_x64-setup.exe` (または `.msi`)
  * ARM版 Windows: `Obsidian.Quick.Entry_X.X.X_arm64-setup.exe` (または `.msi`)
* **Linux**:
  * 一般的なPC: `obsidian-quick-entry_X.X.X_amd64.deb`
  * ARM版 Linux: `obsidian-quick-entry_X.X.X_arm64.deb`

---

## キーボードショートカット

ウィジェット表示時に以下のショートカットを使用できます：

* **`⌘ + Enter` (Windows/Linuxは `Ctrl + Enter`)**: メモを書き込み、ウィジェットを非表示にします。
* **`Escape`**: 入力内容を保持したまま、ウィジェットを非表示にします。

---

## 開発とリリース

### 開発環境での実行

ローカルで開発サーバーを立ち上げ、Tauriアプリをホットリロード有効状態で実行します：

```bash
npm run tauri dev
```

### リリース手順

本プロジェクトは `release-it` および GitHub Actions を使用して、リリースの作成からマルチプラットフォーム（5種類のターゲット）のビルド、Homebrew Tap のアップデートまでを完全に自動化しています。

1. **リリースを開始**:
   ```bash
   npm run release
   ```
   対話プロンプトに従ってリリースバージョンを選択すると、`package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock` のバージョンが同期バンプされ、Gitタグが打たれて GitHub へプッシュされます。

2. **自動ビルド & デプロイ (GitHub Actions)**:
   プッシュされたタグを検知して以下のアーキテクチャ向けのビルドが自動で走り、GitHubのドラフトリリースへ成果物が追加されます。完了後、Homebrew の定義ファイルも自動で書き換わります。
   * macOS (Universal Binary)
   * Windows x64
   * Windows ARM64 (Native Runner)
   * Linux x64
   * Linux ARM64 (Native Runner)
