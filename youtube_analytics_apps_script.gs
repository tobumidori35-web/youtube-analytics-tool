/**
 * 失敗漫画館 YouTubeアナリティクス自動取得スクリプト
 * 取得元: YouTube Data API v3 + YouTube Analytics API
 * 出力先: Googleスプレッドシート（このファイルが所属するもの）
 *
 * ============================================================
 * 【セットアップ手順】（一度きり・所要30分）
 * ============================================================
 *
 * ▼ステップ1: 新規スプレッドシートを作成
 *   1. https://docs.google.com/spreadsheets/ で「+ 空白」→ 新規スプレッドシート
 *   2. 名前を「fmkk_analytics」などに変更
 *   3. メニュー「拡張機能」→「Apps Script」を開く
 *
 * ▼ステップ2: このコードを貼り付け
 *   1. Apps Scriptエディタの「コード.gs」を全消去
 *   2. このファイルの内容をすべて貼り付け
 *   3. 上部の保存アイコン（💾）をクリック
 *
 * ▼ステップ3: 必要なAPIサービスを追加
 *   1. 左メニュー「サービス」横の「+」をクリック
 *   2. 「YouTube Data API v3」を選択 → 識別子はそのまま「YouTube」→ 追加
 *   3. もう一度「+」→「YouTube Analytics API」を選択 → 識別子「YouTubeAnalytics」→ 追加
 *
 * ▼ステップ4: 初回実行＆認証
 *   1. エディタ上部のドロップダウンで「dailyUpdate」を選択
 *   2. 「実行」ボタンをクリック
 *   3. 認証画面が出る → 失敗漫画館チャンネルの管理Googleアカウントで承認
 *      ※「このアプリは確認されていません」と出たら「詳細」→「（プロジェクト名）に移動」→ 許可
 *   4. 完了後、スプレッドシートに6つのシート（動画一覧・日次推移・…）が自動生成される
 *
 * ▼ステップ5: 自動実行を設定
 *   1. 左メニューの時計アイコン「トリガー」をクリック
 *   2. 右下「+ トリガーを追加」
 *   3. 設定: 関数=dailyUpdate / イベントのソース=時間主導型 / 時間ベース=日タイマー / 時刻=午前6〜7時
 *   4. 保存
 *      → 毎朝自動でデータ更新されます（PCがOFFでもOK）
 *
 * ▼ステップ6: ウェブアプリとして公開（HTMLツールから読むため）
 *   1. 右上の「デプロイ」→「新しいデプロイ」
 *   2. 歯車アイコン → 「ウェブアプリ」を選択
 *   3. 設定:
 *      - 説明: fmkk dashboard
 *      - 実行ユーザー: 自分
 *      - アクセス権: 自分のみ
 *   4. 「デプロイ」→ 認証許可 → 完了画面で「ウェブアプリのURL」が表示される
 *   5. そのURLをコピー → HTMLダッシュボードツールに貼り付け
 *
 * ============================================================
 */

// ==================== 設定 ====================
const LOOKBACK_DAYS = 180;  // 過去何日のデータを取得するか
const SHEET_NAMES = {
  channel: 'チャンネル概要',
  videos: '動画一覧',
  daily: '日次推移',
  age: '視聴者層_年齢',
  gender: '視聴者層_性別',
  traffic: 'トラフィックソース',
  comments: 'コメント',
  replyExamples: '返信スタイル例',
  log: '取得ログ',
};

// セキュリティトークン（HTMLからの返信投稿時に検証）
// ↓この文字列を自分で書き換えてください（例：適当な英数字16文字以上）
const REPLY_TOKEN = 'CHANGE_ME_TO_RANDOM_TOKEN_xyz123abc456';

// ==================== メイン ====================
function dailyUpdate() {
  const start = new Date();
  try {
    const today = formatDate(new Date());
    const startDate = formatDate(new Date(Date.now() - LOOKBACK_DAYS * 86400e3));

    log('▶ 開始', `期間 ${startDate} 〜 ${today}`);
    const videoIds = listMyVideos();
    log('📋 動画一覧取得', `${videoIds.length}本`);

    updateChannelStats();
    updateVideoList(videoIds, startDate, today);
    updateDailyTotals(startDate, today);
    updateDemographics(startDate, today);
    updateTrafficSources(startDate, today);
    updateComments();
    ensureReplyExamplesSheet();

    const sec = Math.round((new Date() - start) / 1000);
    log('✅ 成功', `${videoIds.length}本 / ${sec}秒`);
  } catch (e) {
    log('❌ エラー', e.message + '\n' + (e.stack || ''));
    throw e;
  }
}

// ==================== 動画一覧取得 ====================
function listMyVideos() {
  const ch = YouTube.Channels.list('contentDetails', {mine: true});
  if (!ch.items || !ch.items.length) throw new Error('チャンネル情報が取得できません');
  const playlistId = ch.items[0].contentDetails.relatedPlaylists.uploads;

  const ids = [];
  let pageToken;
  do {
    const res = YouTube.PlaylistItems.list('contentDetails', {
      playlistId, maxResults: 50, pageToken,
    });
    res.items.forEach(it => ids.push(it.contentDetails.videoId));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return ids;
}

// ==================== チャンネル概要（現在値） ====================
function updateChannelStats() {
  const ch = YouTube.Channels.list('snippet,statistics', {mine: true}).items[0];
  const s = ch.statistics;
  const rows = [
    ['項目', '値'],
    ['チャンネル名', ch.snippet.title],
    ['チャンネルID', ch.id],
    ['現在の総登録者数', parseInt(s.subscriberCount) || 0],
    ['現在の総再生回数（チャンネル累計）', parseInt(s.viewCount) || 0],
    ['現在の総動画数', parseInt(s.videoCount) || 0],
    ['取得日時', new Date()],
  ];
  writeSheet(SHEET_NAMES.channel, rows);
}

// ==================== 動画別メトリクス ====================
function updateVideoList(videoIds, startDate, endDate) {
  // メタデータ（タイトル・公開日・尺）を50件ずつ取得
  const meta = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const res = YouTube.Videos.list('snippet,contentDetails,statistics', {id: batch.join(',')});
    res.items.forEach(v => {
      meta[v.id] = {
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        duration: parseDuration(v.contentDetails.duration),
        viewCountTotal: parseInt(v.statistics.viewCount) || 0,
      };
    });
  }

  // 動画別の主要メトリクス（インプレッション・CTRも同一呼び出しに統合）
  const mainMap = {};
  try {
    const main = YouTubeAnalytics.Reports.query({
      ids: 'channel==MINE',
      startDate, endDate,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,estimatedRevenue,impressions,impressionsClickThroughRate',
      dimensions: 'video',
      maxResults: 200,
      sort: '-views',
      currency: 'JPY',
    });
    (main.rows || []).forEach(r => {
      mainMap[r[0]] = {
        views: r[1], minutes: r[2], avgDur: r[3], retention: r[4],
        subs: r[5], revenue: r[6], imp: r[7], ctr: r[8],
      };
    });
    log('📊 動画メトリクス', `${main.rows ? main.rows.length : 0}件取得`);
  } catch (e) {
    log('⚠️ 統合呼び出し失敗→分離リトライ', e.message);
    // 分離フォールバック
    const main = YouTubeAnalytics.Reports.query({
      ids: 'channel==MINE', startDate, endDate,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,estimatedRevenue',
      dimensions: 'video', maxResults: 200, sort: '-views',
      currency: 'JPY',
    });
    (main.rows || []).forEach(r => {
      mainMap[r[0]] = {views: r[1], minutes: r[2], avgDur: r[3], retention: r[4], subs: r[5], revenue: r[6], imp: 0, ctr: 0};
    });
    try {
      const imp = YouTubeAnalytics.Reports.query({
        ids: 'channel==MINE', startDate, endDate,
        metrics: 'impressions,impressionsClickThroughRate',
        dimensions: 'video', maxResults: 200,
      });
      (imp.rows || []).forEach(r => {
        if (mainMap[r[0]]) { mainMap[r[0]].imp = r[1]; mainMap[r[0]].ctr = r[2]; }
      });
    } catch (e2) {
      log('⚠️ インプレッション取得失敗', e2.message);
    }
  }

  // YouTube Studio CSVと同じ列構成で出力
  const headers = [
    'コンテンツ', '動画のタイトル', '動画公開時刻', '長さ', 'エンゲージ ビュー',
    '平均視聴時間', '平均視聴率 (%)', '視聴回数', '総再生時間（単位: 時間）',
    'チャンネル登録者', '推定収益 (JPY)', 'インプレッション数', 'インプレッションのクリック率 (%)',
    '取得日時'
  ];
  const now = new Date();
  const rows = [headers];

  Object.keys(meta).forEach(id => {
    const a = mainMap[id] || {};
    const m = meta[id];
    rows.push([
      id,
      m.title,
      formatPubDate(m.publishedAt),
      m.duration,
      a.views || 0,
      a.avgDur ? Math.round(a.avgDur) : 0,
      a.retention ? Number(a.retention).toFixed(2) : 0,
      a.views || 0,
      a.minutes ? (a.minutes / 60).toFixed(4) : 0,
      a.subs || 0,
      a.revenue ? Number(a.revenue).toFixed(3) : 0,
      a.imp || 0,
      a.ctr ? (Number(a.ctr) * 100).toFixed(2) : 0,
      now,
    ]);
  });

  // 視聴回数の多い順にソート
  const sorted = [headers].concat(rows.slice(1).sort((a, b) => (b[7] || 0) - (a[7] || 0)));
  writeSheet(SHEET_NAMES.videos, sorted);
}

// ==================== 日次合計 ====================
function updateDailyTotals(startDate, endDate) {
  const res = YouTubeAnalytics.Reports.query({
    ids: 'channel==MINE', startDate, endDate,
    metrics: 'views,estimatedMinutesWatched,subscribersGained,estimatedRevenue',
    dimensions: 'day', sort: 'day',
    currency: 'JPY',
  });
  const rows = [['日付', 'エンゲージ ビュー', '再生時間(分)', '登録者増', '収益(JPY)']];
  (res.rows || []).forEach(r => rows.push([r[0], r[1], r[2], r[3], r[4]]));
  writeSheet(SHEET_NAMES.daily, rows);
}

// ==================== 視聴者層 ====================
function updateDemographics(startDate, endDate) {
  // 年齢
  try {
    const age = YouTubeAnalytics.Reports.query({
      ids: 'channel==MINE', startDate, endDate,
      metrics: 'viewerPercentage', dimensions: 'ageGroup',
    });
    const rows = [['視聴者の年齢', '視聴者割合(%)']];
    (age.rows || []).forEach(r => rows.push([r[0].replace('age', ''), r[1]]));
    writeSheet(SHEET_NAMES.age, rows);
  } catch (e) {
    log('⚠️ 注意', '年齢層取得失敗: ' + e.message);
  }

  // 性別
  try {
    const gen = YouTubeAnalytics.Reports.query({
      ids: 'channel==MINE', startDate, endDate,
      metrics: 'viewerPercentage', dimensions: 'gender',
    });
    const rows = [['視聴者の性別', '視聴者割合(%)']];
    (gen.rows || []).forEach(r => rows.push([translateGender(r[0]), r[1]]));
    writeSheet(SHEET_NAMES.gender, rows);
  } catch (e) {
    log('⚠️ 注意', '性別取得失敗: ' + e.message);
  }
}

// ==================== トラフィックソース ====================
function updateTrafficSources(startDate, endDate) {
  try {
    const res = YouTubeAnalytics.Reports.query({
      ids: 'channel==MINE', startDate, endDate,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration',
      dimensions: 'insightTrafficSourceType', sort: '-views',
    });
    const rows = [['トラフィックソース', '視聴回数', '再生時間(分)', '平均視聴時間(秒)']];
    (res.rows || []).forEach(r => rows.push([translateTrafficSource(r[0]), r[1], r[2], r[3]]));
    writeSheet(SHEET_NAMES.traffic, rows);
  } catch (e) {
    log('⚠️ 注意', 'トラフィックソース取得失敗: ' + e.message);
  }
}

// ==================== コメント取得 ====================
function updateComments() {
  try {
    const all = [];
    // 動画一覧シートから動画IDを取得
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const videosSheet = ss.getSheetByName(SHEET_NAMES.videos);
    if (!videosSheet) return;
    const videoData = videosSheet.getDataRange().getValues();
    const headers = videoData[0];
    const idIdx = headers.indexOf('コンテンツ');
    const titleIdx = headers.indexOf('動画のタイトル');
    if (idIdx < 0) return;
    const videos = videoData.slice(1).map(r => ({id: r[idIdx], title: r[titleIdx]})); // 全動画を対象（旧30本制限を撤廃）

    videos.forEach(v => {
      try {
        let pageToken;
        let pages = 0;
        do {
          const res = YouTube.CommentThreads.list('snippet,replies', {
            videoId: v.id, maxResults: 100, pageToken, order: 'time',
          });
          (res.items || []).forEach(thread => {
            const tc = thread.snippet.topLevelComment.snippet;
            // 自分（チャンネルオーナー）が既に返信しているか判定
            const myReplies = (thread.replies?.comments || []).filter(c =>
              c.snippet.authorChannelId?.value === tc.videoOwnerChannelId
            );
            all.push({
              commentId: thread.snippet.topLevelComment.id,
              threadId: thread.id,
              videoId: v.id,
              videoTitle: v.title,
              author: tc.authorDisplayName,
              authorChannelId: tc.authorChannelId?.value || '',
              text: tc.textOriginal,
              likeCount: tc.likeCount,
              publishedAt: tc.publishedAt,
              hasReplied: myReplies.length > 0,
              replyCount: thread.snippet.totalReplyCount,
              myReply: myReplies[0]?.snippet.textOriginal || '',
            });
          });
          pageToken = res.nextPageToken;
          pages++;
        } while (pageToken && pages < 5); // 1動画あたり最大500件
      } catch (e) {
        // 動画ごとのエラーは無視（コメント無効化されている動画など）
      }
    });

    // 公開日新しい順にソート
    all.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));

    const headers2 = ['コメントID', 'スレッドID', '動画ID', '動画タイトル', 'コメント主', '著者ID', '本文', 'いいね数', '投稿日時', '返信済み', '返信数', '自分の返信', 'コメントURL'];
    const rows = [headers2];
    all.slice(0, 500).forEach(c => {
      rows.push([
        c.commentId, c.threadId, c.videoId, c.videoTitle,
        c.author, c.authorChannelId, c.text, c.likeCount, c.publishedAt,
        c.hasReplied ? '済' : '未',
        c.replyCount, c.myReply,
        `https://studio.youtube.com/video/${c.videoId}/comments/inbox?searchQuery=${encodeURIComponent(c.author)}`,
      ]);
    });
    writeSheet(SHEET_NAMES.comments, rows);
    log('💬 コメント取得', `${all.length}件（未返信: ${all.filter(c => !c.hasReplied).length}件）`);
  } catch (e) {
    log('⚠️ コメント取得失敗', e.message);
  }
}

// ==================== 返信スタイル例シートの初期化 ====================
function ensureReplyExamplesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.replyExamples);
  if (sheet) return; // 既にあれば何もしない
  sheet = ss.insertSheet(SHEET_NAMES.replyExamples);
  const rows = [
    ['コメント本文', '返信文', 'メモ（任意）'],
    ['（例）面白かったです！', '（例）ご視聴ありがとうございます！次回もぜひお楽しみに。', '基本パターン'],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
  ];
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange('A1:C1').setBackground('#8b0000').setFontColor('#ffffff').setFontWeight('bold');
  sheet.autoResizeColumns(1, 3);
}

// ==================== 返信投稿 ====================
function postCommentReply(threadId, replyText) {
  const reply = YouTube.Comments.insert(
    {snippet: {parentId: threadId, textOriginal: replyText}},
    'snippet'
  );
  return {success: true, replyId: reply.id};
}

// ==================== シート書き込み ====================
function writeSheet(name, rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.clear();
  if (rows.length) {
    sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, rows[0].length);
  }
}

function log(status, msg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.log);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.log);
    sheet.appendRow(['日時', 'ステータス', 'メッセージ']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([new Date(), status, msg]);
  // 古いログ（500行超）を削除
  if (sheet.getLastRow() > 501) {
    sheet.deleteRows(2, sheet.getLastRow() - 501);
  }
}

// ==================== ユーティリティ ====================
function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1]) || 0) * 3600 + (parseInt(m[2]) || 0) * 60 + (parseInt(m[3]) || 0);
}

function formatDate(d) {
  return Utilities.formatDate(d, 'GMT', 'yyyy-MM-dd');
}

function formatPubDate(iso) {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatHMS(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function translateGender(g) {
  return {
    male: '男性',
    female: '女性',
    user_specified: 'その他',
    genderMale: '男性',
    genderFemale: '女性',
    genderUserSpecified: 'その他',
  }[g] || g;
}

function translateTrafficSource(t) {
  return {
    YT_SEARCH: 'YouTube検索',
    EXT_URL: '外部',
    SUBSCRIBER: '登録チャンネル',
    YT_CHANNEL: 'チャンネルページ',
    RELATED_VIDEO: '関連動画',
    BROWSE: 'ブラウジング機能',
    SHORTS: 'Shortsフィード',
    PLAYLIST: '再生リスト',
    DIRECT_OR_UNKNOWN: '直接 or 不明',
    NOTIFICATION: '通知',
    ADVERTISING: '広告',
    YT_OTHER_PAGE: 'その他YouTube',
    NO_LINK_OTHER: 'リンクなし',
  }[t] || t;
}

// ==================== ウェブアプリAPI ====================
function doGet(e) {
  const action = e?.parameter?.action;
  // 返信投稿アクション
  if (action === 'reply') {
    return handleReplyRequest(e);
  }
  // それ以外はデータ取得
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = {};
  Object.entries(SHEET_NAMES).forEach(([key, name]) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() === 0) return;
    data[key] = sheet.getDataRange().getValues();
  });
  data.fetchedAt = new Date().toISOString();
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  return handleReplyRequest(e);
}

function handleReplyRequest(e) {
  try {
    const token = e?.parameter?.token;
    if (token !== REPLY_TOKEN) {
      return jsonOut({error: 'invalid_token'});
    }
    const threadId = e.parameter.threadId;
    const text = e.parameter.text;
    if (!threadId || !text) {
      return jsonOut({error: 'missing_params'});
    }
    const result = postCommentReply(threadId, text);
    log('📤 返信投稿', `${threadId}: ${text.slice(0, 40)}...`);
    return jsonOut(result);
  } catch (err) {
    log('⚠️ 返信投稿失敗', err.message);
    return jsonOut({error: err.message});
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
