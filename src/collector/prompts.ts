/**
 * Stage1: 情報収集用プロンプト
 * Claude Agent SDKのWebSearch/WebFetchツールを使用して情報を収集するためのプロンプト
 */

import type { SourceConfig, GeneratedQuery, RawArticle } from '../types/index.js';

/**
 * WebFetch用プロンプトを生成する
 */
export function buildWebFetchPrompt(source: SourceConfig): string {
  const basePrompt = `あなたは技術情報収集エージェントです。
以下のURLから最新の記事情報を抽出してください。

## 対象URL
${source.url}

## 出力形式
以下のJSON形式で各記事の情報を抽出してください：

\`\`\`json
{
  "articles": [
    {
      "title": "記事タイトル",
      "url": "記事のURL（完全なURL）",
      "summary": "記事の概要（100-200文字程度、日本語で記述）",
      "publishedAt": "公開日時（ISO 8601形式、取得できない場合はnull）",
      "dateMetaContent": "日付メタタグの内容（article:published_time等、取得できない場合は省略）"
    }
  ]
}
\`\`\`

## 抽出ルール
1. 最新の記事を最大${source.maxArticles ?? 10}件抽出する
2. タイトルとURLは必須
3. 概要は記事の冒頭部分から抽出
4. 公開日時は${getDateExtractionInstruction(source)}
5. 広告や無関係なリンクは除外
6. 記事のURLは完全なURL（httpから始まる）で出力

## ソース情報
- ソースID: ${source.id}
- ソース名: ${source.name}
- Tier: ${source.tier}
`;

  return basePrompt;
}

/**
 * 取得済みレスポンスをJSON形式に整形し直すためのプロンプトを生成する
 */
export function buildStrictJsonRepairPrompt(
  source: SourceConfig,
  rawResponse: string
): string {
  const trimmedResponse = rawResponse.trim().slice(0, 8000);

  return `あなたはJSON整形専用エージェントです。
以下のテキストを元に、記事情報をJSONだけで出力してください。

## 入力テキスト
${trimmedResponse}

## 厳守ルール
1. 説明文や見出しは一切出力しない
2. 必ず1つのJSONオブジェクトだけを出力する
3. JSON形式は以下に厳密一致する
4. 記事は最大${source.maxArticles ?? 10}件まで

\`\`\`json
{
  "articles": [
    {
      "title": "記事タイトル",
      "url": "記事のURL（完全なURL）",
      "summary": "記事の概要（100-200文字程度、日本語で記述）",
      "publishedAt": "公開日時（ISO 8601形式、取得できない場合はnull）",
      "dateMetaContent": "日付メタタグや補足日付情報（取得できない場合は省略）"
    }
  ]
}
\`\`\`
`;
}

/**
 * 日付抽出方法の説明を生成する
 */
function getDateExtractionInstruction(source: SourceConfig): string {
  switch (source.dateMethod) {
    case 'html_meta':
      return `メタタグ（${source.dateSelector ?? 'article:published_time'}）から取得`;
    case 'html_parse':
      return `HTML要素（${source.dateSelector ?? 'time'}）から取得`;
    case 'url_parse':
      return `URLパス内の日付パターン（${source.datePattern ?? 'YYYY/MM/DD'}）から取得`;
    case 'search_result':
      return '検索結果の相対時刻から推定';
    default:
      return 'ページ内から推定（取得できない場合はnull）';
  }
}

/**
 * WebSearch用プロンプトを生成する
 */
export function buildWebSearchPrompt(
  source: SourceConfig,
  queries: GeneratedQuery[],
  dateRestrictionDays?: number | null
): string {
  const queryStrings = queries.map((q) => q.query);
  const dateInstruction = dateRestrictionDays
    ? `過去${dateRestrictionDays}日以内の記事に限定`
    : '最新の記事を優先';

  const basePrompt = `あなたは技術情報収集エージェントです。
以下の検索クエリを使用して最新の記事を検索してください。

## 検索ソース
${source.id === 'twitter' ? 'X (Twitter)' : source.name}

## 検索クエリ
${source.query ? `サイト指定: ${source.query}` : ''}
${queryStrings.length > 0 ? `キーワード: ${queryStrings.join(', ')}` : ''}

## 検索条件
- ${dateInstruction}
- 最大${source.maxArticles ?? 10}件を取得

## 出力形式
以下のJSON形式で各記事の情報を出力してください：

\`\`\`json
{
  "articles": [
    {
      "title": "記事タイトル",
      "url": "記事のURL（完全なURL）",
      "summary": "記事の概要（100-200文字程度、日本語で記述）",
      "publishedAt": "公開日時（ISO 8601形式、推定でも可、不明な場合はnull）",
      "dateMetaContent": "検索結果に表示された日付テキスト（例: '3時間前', '2024年1月15日'）"
    }
  ]
}
\`\`\`

## 抽出ルール
1. 技術的な内容に関連する記事を優先
2. タイトルとURLは必須
3. 概要は検索結果のスニペットから抽出
4. 公開日時は検索結果から推定（「3時間前」→現在時刻から計算）
5. dateMetaContentには検索結果に表示された生の日付テキストを記録
6. 重複URLは除外

## ソース情報
- ソースID: ${source.id}
- ソース名: ${source.name}
- Tier: ${source.tier}
`;

  return basePrompt;
}

/**
 * Twitter (X) 専用プロンプトを生成する
 */
export function buildTwitterSearchPrompt(
  source: SourceConfig,
  queries: GeneratedQuery[]
): string {
  const accounts = source.accounts ?? [];
  const queryStrings = queries.map((q) => q.query);

  const basePrompt = `あなたは技術情報収集エージェントです。
X (Twitter) から最新の技術関連投稿を検索してください。

## 検索対象アカウント
${accounts.map((a) => `@${a}`).join(', ')}

## 検索キーワード
${queryStrings.join(', ')}

## 検索条件
- 過去24時間以内の投稿
- 最大${source.maxArticles ?? 15}件を取得
- リポスト/引用は含めない（オリジナル投稿のみ）

## 出力形式
\`\`\`json
{
  "articles": [
    {
      "title": "投稿本文の先頭50文字...",
      "url": "投稿のURL (https://x.com/...)",
      "summary": "投稿内容の日本語要約（100-200文字程度）",
      "publishedAt": "投稿日時（推定）"
    }
  ]
}
\`\`\`

## 注意事項
- X/Twitterの検索結果は不安定なため、取得できた分のみ出力
- エラーが発生した場合は空の配列を返す
- ソースID: ${source.id}
`;

  return basePrompt;
}

/**
 * パース結果の型
 */
export interface ParseResult {
  articles: RawArticle[];
  parseError?: string;
  rawPreview?: string;
}

/**
 * 収集結果をパースする
 */
export function parseCollectionResult(
  result: string,
  sourceId: string
): ParseResult {
  const candidates = extractJsonCandidates(result);
  let parseError = 'Response does not contain parseable JSON';

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const articlesArray = getArticlesArray(parsed);

      if (!articlesArray) {
        parseError = 'Response does not contain articles array';
        continue;
      }

      const articles = normalizeArticles(articlesArray, sourceId);
      return { articles };
    } catch (error) {
      parseError = error instanceof Error ? error.message : 'Unknown parse error';
    }
  }

  return {
    articles: [],
    parseError,
    rawPreview: buildRawPreview(result),
  };
}

/**
 * JSON候補文字列を抽出する
 */
function extractJsonCandidates(result: string): string[] {
  const candidates: string[] = [];
  const pushCandidate = (value: string | undefined): void => {
    const trimmed = value?.trim();
    if (!trimmed || candidates.includes(trimmed)) return;
    candidates.push(trimmed);
  };

  // 1) ```json fenced blocks
  for (const match of result.matchAll(/```json\s*([\s\S]*?)\s*```/gi)) {
    pushCandidate(match[1]);
  }

  // 2) any fenced blocks that look like JSON
  for (const match of result.matchAll(/```(?:\w+)?\s*([\s\S]*?)\s*```/g)) {
    const block = match[1]?.trim();
    if (block?.startsWith('{') || block?.startsWith('[')) {
      pushCandidate(block);
    }
  }

  // 3) raw response as-is when it looks like JSON
  const trimmed = result.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    pushCandidate(trimmed);
  }

  // 4) broad fallback: first object-like segment
  const firstBrace = result.indexOf('{');
  const lastBrace = result.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    pushCandidate(result.slice(firstBrace, lastBrace + 1));
  }

  return candidates;
}

/**
 * JSONから記事配列を取り出す
 */
function getArticlesArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) {
    return parsed.map((item) => item as unknown);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const maybeArticles = (parsed as { articles?: unknown }).articles;
  return Array.isArray(maybeArticles) ? maybeArticles : null;
}

/**
 * 記事配列をRawArticleへ正規化する
 */
function normalizeArticles(articlesInput: unknown[], sourceId: string): RawArticle[] {
  return articlesInput
    .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
    .map((article) => ({
      title: String(article['title'] ?? ''),
      url: String(article['url'] ?? ''),
      summary: article['summary'] ? String(article['summary']) : undefined,
      publishedAt: article['publishedAt'] ? String(article['publishedAt']) : undefined,
      dateMetaContent: article['dateMetaContent'] ? String(article['dateMetaContent']) : undefined,
      source: sourceId,
      collectedAt: new Date().toISOString(),
    }))
    .filter((a) => a.title && a.url);
}

/**
 * ログ出力用の短縮プレビュー
 */
function buildRawPreview(result: string): string {
  return result.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * 収集エラー時のフォールバックレスポンスを生成する
 */
export function buildErrorResponse(
  sourceId: string,
  errorType: string,
  message: string
): { sourceId: string; errorType: string; message: string; timestamp: string } {
  return {
    sourceId,
    errorType,
    message,
    timestamp: new Date().toISOString(),
  };
}
