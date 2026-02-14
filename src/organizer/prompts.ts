/**
 * Stage2: AI整理用プロンプト
 * 収集した記事をカテゴリ化・要約・ランキングする
 */

import type { FilteredArticle, QueryGroup } from '../types/index.js';

/**
 * カテゴリ化結果
 */
export interface CategorizedArticle {
  /** 元の記事 */
  article: FilteredArticle;
  /** 割り当てられたカテゴリID */
  categoryId: string;
  /** カテゴリ名 */
  categoryName: string;
  /** 関連度スコア（1-5） */
  relevanceScore: number;
  /** AI生成の概要 */
  aiSummary: string;
  /** 抽出されたタグ */
  tags: string[];
}

/**
 * 整理結果
 */
export interface OrganizedResult {
  /** カテゴリ別の記事 */
  categorizedArticles: Map<string, CategorizedArticle[]>;
  /** カテゴリ別の記事数 */
  categoryStats: Map<string, number>;
  /** 処理統計 */
  stats: {
    totalArticles: number;
    categorizedArticles: number;
    uncategorizedArticles: number;
    avgRelevanceScore: number;
  };
}

/**
 * カテゴリ化用プロンプトを生成する
 */
export function buildCategorizationPrompt(
  articles: FilteredArticle[],
  queryGroups: QueryGroup[]
): string {
  const articlesJson = JSON.stringify(
    articles.map((a, index) => ({
      id: index,
      title: a.title,
      summary: a.summary ?? '',
      url: a.url,
      source: a.source,
    })),
    null,
    2
  );

  const categoriesJson = JSON.stringify(
    queryGroups.map((g) => ({
      id: g.id,
      name: g.name,
      keywords: g.keywords,
    })),
    null,
    2
  );

  return `あなたは技術記事の分類エキスパートです。
以下の記事をカテゴリに分類し、各記事の概要と関連度を評価してください。

## 記事一覧
${articlesJson}

## カテゴリ一覧
${categoriesJson}

## 出力形式
以下のJSON形式で出力してください：

\`\`\`json
{
  "categorized": [
    {
      "articleId": 0,
      "categoryId": "llm",
      "relevanceScore": 5,
      "aiSummary": "Claude 4 Opusが発表され、従来モデルを大幅に上回る性能を実現。特にコーディング能力と推論能力が向上。",
      "tags": ["LLM", "Claude", "Anthropic"]
    }
  ]
}
\`\`\`

## 分類ルール
1. 各記事は最も適切な1つのカテゴリに分類
2. 複数カテゴリに該当する場合は最も関連度の高いものを選択
3. どのカテゴリにも該当しない場合は \`categoryId: "other"\` を使用
4. 関連度スコアは1（低）〜5（高）で評価
5. aiSummaryは50-100文字程度で記事の要点を簡潔に記述
6. tagsは記事から抽出した3-5個のキーワード

## 関連度スコアの基準
- 5: カテゴリのコアトピックに直接関連
- 4: カテゴリに強く関連
- 3: カテゴリに関連
- 2: カテゴリに弱く関連
- 1: カテゴリに間接的に関連

## 注意事項
- 技術的な内容を優先
- 広告や無関係なコンテンツは関連度を下げる
- 日本語と英語の両方の記事を適切に処理
`;
}

/**
 * 要約生成用プロンプトを生成する
 */
export function buildSummaryPrompt(
  categorizedArticles: CategorizedArticle[],
  categoryName: string
): string {
  const articlesJson = JSON.stringify(
    categorizedArticles.map((ca) => ({
      title: ca.article.title,
      summary: ca.aiSummary,
      relevanceScore: ca.relevanceScore,
      tags: ca.tags,
    })),
    null,
    2
  );

  return `あなたは技術レポートのライターです。
以下の「${categoryName}」カテゴリの記事をまとめて、カテゴリ全体の概要を作成してください。

## 記事一覧
${articlesJson}

## 出力形式
\`\`\`json
{
  "categorySummary": "本日の${categoryName}関連では、〇〇に関する発表が目立ちました。特に△△は注目に値します。",
  "highlights": [
    "ハイライト1: 〇〇の発表",
    "ハイライト2: △△の動向"
  ],
  "trendKeywords": ["キーワード1", "キーワード2", "キーワード3"]
}
\`\`\`

## 作成ルール
1. categorySummaryは100-200文字程度
2. highlightsは最大3つ
3. trendKeywordsは3-5個
4. 関連度スコアの高い記事を優先
5. 読者にとって有益な情報を強調
`;
}

/**
 * ランキング生成用プロンプトを生成する
 */
export function buildRankingPrompt(
  allCategorized: CategorizedArticle[]
): string {
  const articlesJson = JSON.stringify(
    allCategorized.map((ca, index) => ({
      id: index,
      title: ca.article.title,
      category: ca.categoryName,
      relevanceScore: ca.relevanceScore,
      source: ca.article.source,
    })),
    null,
    2
  );

  return `あなたは技術ニュースのキュレーターです。
以下の記事から、今日の注目記事TOP5を選出してください。

## 記事一覧
${articlesJson}

## 出力形式
\`\`\`json
{
  "topArticles": [
    {
      "articleId": 0,
      "rank": 1,
      "reason": "業界に大きな影響を与える可能性がある発表のため"
    }
  ]
}
\`\`\`

## 選出基準
1. 技術的なインパクト
2. 業界への影響度
3. 新規性・独自性
4. 情報の信頼性（ソースの信頼度）
5. 関連度スコア

## 注意事項
- 異なるカテゴリからバランスよく選出
- 関連度スコアが3以上の記事を優先
- reasonは簡潔に（20-40文字程度）
`;
}

/**
 * カテゴリ化結果をパースする
 */
export function parseCategorizationResult(
  result: string,
  articles: FilteredArticle[],
  queryGroups: QueryGroup[]
): CategorizedArticle[] {
  try {
    const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch?.[1] ?? result;
    const parsed = JSON.parse(jsonStr) as {
      categorized?: Array<{
        articleId: number;
        categoryId: string;
        relevanceScore: number;
        aiSummary: string;
        tags: string[];
      }>;
    };

    if (!Array.isArray(parsed.categorized)) {
      return [];
    }

    return parsed.categorized
      .map((item) => {
        const article = articles[item.articleId];
        const category = queryGroups.find((g) => g.id === item.categoryId);

        if (!article) return null;

        return {
          article,
          categoryId: item.categoryId,
          categoryName: category?.name ?? 'その他',
          relevanceScore: Math.max(1, Math.min(5, item.relevanceScore)),
          aiSummary: item.aiSummary,
          tags: item.tags ?? [],
        };
      })
      .filter((item): item is CategorizedArticle => item !== null);
  } catch {
    return [];
  }
}

/**
 * カテゴリ別にグループ化する
 */
export function groupByCategory(
  categorizedArticles: CategorizedArticle[]
): Map<string, CategorizedArticle[]> {
  const grouped = new Map<string, CategorizedArticle[]>();

  for (const ca of categorizedArticles) {
    const existing = grouped.get(ca.categoryId) ?? [];
    existing.push(ca);
    grouped.set(ca.categoryId, existing);
  }

  // 各カテゴリ内で関連度スコア順にソート
  for (const [categoryId, articles] of grouped) {
    articles.sort((a, b) => b.relevanceScore - a.relevanceScore);
    grouped.set(categoryId, articles);
  }

  return grouped;
}

/**
 * 記事をMarkdownフォーマットに変換する
 */
export function formatArticleMarkdown(
  ca: CategorizedArticle,
  rank?: number
): string {
  const stars = '★'.repeat(ca.relevanceScore) + '☆'.repeat(5 - ca.relevanceScore);
  const rankPrefix = rank ? `${rank}. ` : '';

  return `### ${rankPrefix}[${ca.article.title}](${ca.article.url})
**Source:** ${ca.article.source} | **Relevance:** ${stars}

${ca.aiSummary}

\`Tags: ${ca.tags.join(', ')}\`

---
`;
}

/**
 * カテゴリセクションをMarkdownフォーマットに変換する
 */
export function formatCategorySectionMarkdown(
  categoryName: string,
  articles: CategorizedArticle[]
): string {
  const count = articles.length;
  let markdown = `## ${categoryName} (${count} articles)\n\n`;

  for (const ca of articles) {
    markdown += formatArticleMarkdown(ca);
  }

  return markdown;
}
