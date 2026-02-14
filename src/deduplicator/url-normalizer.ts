/**
 * URL正規化モジュール
 * Layer 1重複排除の基盤となるURL正規化を提供
 */

export interface UrlNormalizationOptions {
  /** 除去するクエリパラメータ */
  removeParams: string[];
  /** 末尾スラッシュを正規化するか */
  normalizeTrailingSlash: boolean;
  /** ホスト名を小文字にするか */
  lowercaseHost: boolean;
}

/** デフォルトの正規化オプション */
export const DEFAULT_NORMALIZATION_OPTIONS: UrlNormalizationOptions = {
  removeParams: [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'ref',
    'source',
    'via',
    'fbclid',
    'gclid',
    'mc_cid',
    'mc_eid',
    '_ga',
    '_gl',
    'yclid',
    'msclkid',
  ],
  normalizeTrailingSlash: true,
  lowercaseHost: true,
};

/**
 * URLを正規化する
 * @param url - 正規化するURL
 * @param options - 正規化オプション
 * @returns 正規化されたURL
 * @throws 無効なURLの場合はエラー
 */
export function normalizeUrl(
  url: string,
  options: UrlNormalizationOptions = DEFAULT_NORMALIZATION_OPTIONS
): string {
  // URLをパース
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // プロトコルをhttpsに統一（httpの場合）
  if (parsedUrl.protocol === 'http:') {
    parsedUrl.protocol = 'https:';
  }

  // ホスト名を小文字に
  if (options.lowercaseHost) {
    parsedUrl.hostname = parsedUrl.hostname.toLowerCase();
  }

  // www.を除去
  if (parsedUrl.hostname.startsWith('www.')) {
    parsedUrl.hostname = parsedUrl.hostname.slice(4);
  }

  // トラッキングパラメータを除去
  const searchParams = new URLSearchParams(parsedUrl.search);
  for (const param of options.removeParams) {
    searchParams.delete(param);
  }

  // パラメータをソートして一貫性を保つ
  const sortedParams = new URLSearchParams([...searchParams.entries()].sort());
  parsedUrl.search = sortedParams.toString();

  // フラグメント（ハッシュ）を除去
  parsedUrl.hash = '';

  // パスの正規化
  let normalizedPath = parsedUrl.pathname;

  // 連続するスラッシュを単一に
  normalizedPath = normalizedPath.replace(/\/+/g, '/');

  // パスのパーセントエンコーディングを正規化（小文字に統一）
  normalizedPath = decodeAndReencode(normalizedPath);

  // 末尾スラッシュの正規化
  if (options.normalizeTrailingSlash) {
    // ファイル拡張子がある場合は末尾スラッシュを追加しない
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(normalizedPath);
    if (hasExtension) {
      normalizedPath = normalizedPath.replace(/\/+$/, '');
    } else if (normalizedPath !== '/') {
      // 拡張子がなく、ルートでない場合は末尾スラッシュを除去
      normalizedPath = normalizedPath.replace(/\/+$/, '');
    }
  }

  parsedUrl.pathname = normalizedPath;

  // 最終的なURL文字列を生成
  let result = parsedUrl.toString();

  // 末尾の?を除去（パラメータが空の場合）
  if (result.endsWith('?')) {
    result = result.slice(0, -1);
  }

  return result;
}

/**
 * パーセントエンコーディングを正規化する
 * デコード可能な文字はデコードし、必要な文字のみ再エンコード
 */
function decodeAndReencode(path: string): string {
  try {
    // まずデコード
    const decoded = decodeURIComponent(path);
    // 必要な文字のみ再エンコード（スラッシュは除く）
    return decoded
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  } catch {
    // デコードに失敗した場合は元のパスを返す
    return path;
  }
}

/**
 * URLからドメイン（ホスト名）を抽出する
 * @param url - URL文字列
 * @returns ドメイン名（小文字、www.除去済み）
 */
export function extractDomain(url: string): string {
  try {
    const parsedUrl = new URL(url);
    let hostname = parsedUrl.hostname.toLowerCase();
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }
    return hostname;
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
}

/**
 * 2つのURLが同一ドメインかどうかを判定する
 * @param url1 - 比較するURL1
 * @param url2 - 比較するURL2
 * @returns 同一ドメインならtrue
 */
export function isSameDomain(url1: string, url2: string): boolean {
  try {
    return extractDomain(url1) === extractDomain(url2);
  } catch {
    return false;
  }
}

/**
 * URLが有効かどうかを検証する
 * @param url - 検証するURL
 * @returns 有効ならtrue
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}
