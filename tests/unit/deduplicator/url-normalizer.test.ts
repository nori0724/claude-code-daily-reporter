import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  extractDomain,
  isSameDomain,
  isValidUrl,
  DEFAULT_NORMALIZATION_OPTIONS,
} from '@/deduplicator/url-normalizer';

describe('normalizeUrl', () => {
  describe('プロトコル正規化', () => {
    it('httpをhttpsに変換する', () => {
      expect(normalizeUrl('http://example.com/path')).toBe('https://example.com/path');
    });

    it('httpsはそのまま維持する', () => {
      expect(normalizeUrl('https://example.com/path')).toBe('https://example.com/path');
    });
  });

  describe('ホスト名正規化', () => {
    it('ホスト名を小文字に変換する', () => {
      expect(normalizeUrl('https://EXAMPLE.COM/path')).toBe('https://example.com/path');
    });

    it('www.を除去する', () => {
      expect(normalizeUrl('https://www.example.com/path')).toBe('https://example.com/path');
    });

    it('WWW.を除去する（大文字）', () => {
      expect(normalizeUrl('https://WWW.EXAMPLE.COM/path')).toBe('https://example.com/path');
    });
  });

  describe('トラッキングパラメータ除去', () => {
    it('utm_*パラメータを除去する', () => {
      const url = 'https://example.com/path?utm_source=twitter&utm_medium=social&foo=bar';
      expect(normalizeUrl(url)).toBe('https://example.com/path?foo=bar');
    });

    it('fbclidを除去する', () => {
      const url = 'https://example.com/path?fbclid=abc123&title=test';
      expect(normalizeUrl(url)).toBe('https://example.com/path?title=test');
    });

    it('gclidを除去する', () => {
      const url = 'https://example.com/path?gclid=xyz789&id=123';
      expect(normalizeUrl(url)).toBe('https://example.com/path?id=123');
    });

    it('_gaと_glを除去する', () => {
      const url = 'https://example.com/path?_ga=123&_gl=456&keep=yes';
      expect(normalizeUrl(url)).toBe('https://example.com/path?keep=yes');
    });

    it('mc_cidとmc_eidを除去する', () => {
      const url = 'https://example.com/path?mc_cid=abc&mc_eid=def&data=value';
      expect(normalizeUrl(url)).toBe('https://example.com/path?data=value');
    });

    it('yclidとmsclkidを除去する', () => {
      const url = 'https://example.com/path?yclid=123&msclkid=456&page=1';
      expect(normalizeUrl(url)).toBe('https://example.com/path?page=1');
    });

    it('refとsourceとviaを除去する', () => {
      const url = 'https://example.com/path?ref=twitter&source=app&via=api&id=1';
      expect(normalizeUrl(url)).toBe('https://example.com/path?id=1');
    });

    it('全てのパラメータが除去された場合、?を含めない', () => {
      const url = 'https://example.com/path?utm_source=twitter';
      expect(normalizeUrl(url)).toBe('https://example.com/path');
    });
  });

  describe('クエリパラメータソート', () => {
    it('クエリパラメータをアルファベット順にソートする', () => {
      const url = 'https://example.com/path?z=3&a=1&m=2';
      expect(normalizeUrl(url)).toBe('https://example.com/path?a=1&m=2&z=3');
    });
  });

  describe('フラグメント除去', () => {
    it('フラグメント（#以降）を除去する', () => {
      expect(normalizeUrl('https://example.com/path#section')).toBe('https://example.com/path');
    });

    it('フラグメントとクエリパラメータが両方ある場合', () => {
      const url = 'https://example.com/path?id=1#section';
      expect(normalizeUrl(url)).toBe('https://example.com/path?id=1');
    });
  });

  describe('パス正規化', () => {
    it('連続するスラッシュを単一にする', () => {
      expect(normalizeUrl('https://example.com//path///to////page')).toBe(
        'https://example.com/path/to/page'
      );
    });

    it('末尾スラッシュを除去する（拡張子なし）', () => {
      expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    });

    it('ルートパスはそのまま維持する', () => {
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('ファイル拡張子がある場合は末尾スラッシュを追加しない', () => {
      expect(normalizeUrl('https://example.com/file.html')).toBe(
        'https://example.com/file.html'
      );
    });
  });

  describe('パーセントエンコーディング', () => {
    it('日本語パスを正規化する', () => {
      const url = 'https://example.com/ブログ/記事';
      const normalized = normalizeUrl(url);
      expect(normalized).toBe('https://example.com/%E3%83%96%E3%83%AD%E3%82%B0/%E8%A8%98%E4%BA%8B');
    });

    it('既にエンコードされたパスを正規化する', () => {
      const url = 'https://example.com/%E3%83%96%E3%83%AD%E3%82%B0';
      const normalized = normalizeUrl(url);
      expect(normalized).toBe('https://example.com/%E3%83%96%E3%83%AD%E3%82%B0');
    });
  });

  describe('エラーハンドリング', () => {
    it('無効なURLでエラーをスローする', () => {
      expect(() => normalizeUrl('not-a-valid-url')).toThrow('Invalid URL');
    });

    it('空文字でエラーをスローする', () => {
      expect(() => normalizeUrl('')).toThrow('Invalid URL');
    });
  });

  describe('カスタムオプション', () => {
    it('カスタムパラメータリストを使用する', () => {
      const url = 'https://example.com/path?custom=remove&keep=yes';
      const options = {
        ...DEFAULT_NORMALIZATION_OPTIONS,
        removeParams: ['custom'],
      };
      expect(normalizeUrl(url, options)).toBe('https://example.com/path?keep=yes');
    });

    it('末尾スラッシュ正規化を無効にする', () => {
      const url = 'https://example.com/path/';
      const options = {
        ...DEFAULT_NORMALIZATION_OPTIONS,
        normalizeTrailingSlash: false,
      };
      expect(normalizeUrl(url, options)).toBe('https://example.com/path/');
    });

    it('ホスト名小文字化オプションはURL APIの仕様により常に小文字になる', () => {
      // 注: URL APIは仕様上ホスト名を自動的に小文字化するため、
      // lowercaseHostオプションは実質的に冗長だが、明示性のため残す
      const url = 'https://EXAMPLE.COM/path';
      const options = {
        ...DEFAULT_NORMALIZATION_OPTIONS,
        lowercaseHost: false,
      };
      // URL APIが自動的に小文字化するため、結果は小文字になる
      expect(normalizeUrl(url, options)).toBe('https://example.com/path');
    });
  });

  describe('実際のサイトURL', () => {
    it('HackerNewsのURLを正規化する', () => {
      const url = 'https://news.ycombinator.com/item?id=12345';
      expect(normalizeUrl(url)).toBe('https://news.ycombinator.com/item?id=12345');
    });

    it('QiitaのURLを正規化する', () => {
      const url = 'https://qiita.com/user/items/abc123?utm_source=twitter';
      expect(normalizeUrl(url)).toBe('https://qiita.com/user/items/abc123');
    });

    it('arXivのURLを正規化する', () => {
      const url = 'https://arxiv.org/abs/2401.12345';
      expect(normalizeUrl(url)).toBe('https://arxiv.org/abs/2401.12345');
    });

    it('TechCrunchのURLを正規化する', () => {
      const url =
        'https://techcrunch.com/2024/01/15/article-title/?utm_source=feed&utm_medium=rss';
      expect(normalizeUrl(url)).toBe('https://techcrunch.com/2024/01/15/article-title');
    });

    it('ZennのURLを正規化する', () => {
      const url = 'https://zenn.dev/user/articles/abc123#comments';
      expect(normalizeUrl(url)).toBe('https://zenn.dev/user/articles/abc123');
    });

    it('AnthropicブログのURLを正規化する', () => {
      const url = 'https://www.anthropic.com/news/claude-4?ref=homepage';
      expect(normalizeUrl(url)).toBe('https://anthropic.com/news/claude-4');
    });
  });
});

describe('extractDomain', () => {
  it('標準的なURLからドメインを抽出する', () => {
    expect(extractDomain('https://example.com/path')).toBe('example.com');
  });

  it('www.を除去したドメインを返す', () => {
    expect(extractDomain('https://www.example.com/path')).toBe('example.com');
  });

  it('小文字に変換したドメインを返す', () => {
    expect(extractDomain('https://EXAMPLE.COM/path')).toBe('example.com');
  });

  it('サブドメインを含むドメインを返す', () => {
    expect(extractDomain('https://blog.example.com/path')).toBe('blog.example.com');
  });

  it('無効なURLでエラーをスローする', () => {
    expect(() => extractDomain('not-a-url')).toThrow('Invalid URL');
  });
});

describe('isSameDomain', () => {
  it('同じドメインの場合trueを返す', () => {
    expect(isSameDomain('https://example.com/path1', 'https://example.com/path2')).toBe(true);
  });

  it('www.の有無に関係なく同一ドメインと判定する', () => {
    expect(isSameDomain('https://www.example.com/path', 'https://example.com/path')).toBe(true);
  });

  it('大文字小文字に関係なく同一ドメインと判定する', () => {
    expect(isSameDomain('https://EXAMPLE.COM/path', 'https://example.com/path')).toBe(true);
  });

  it('異なるドメインの場合falseを返す', () => {
    expect(isSameDomain('https://example.com/path', 'https://other.com/path')).toBe(false);
  });

  it('サブドメインが異なる場合falseを返す', () => {
    expect(isSameDomain('https://blog.example.com', 'https://api.example.com')).toBe(false);
  });

  it('無効なURLの場合falseを返す', () => {
    expect(isSameDomain('not-a-url', 'https://example.com')).toBe(false);
    expect(isSameDomain('https://example.com', 'not-a-url')).toBe(false);
  });
});

describe('isValidUrl', () => {
  it('有効なhttps URLでtrueを返す', () => {
    expect(isValidUrl('https://example.com/path')).toBe(true);
  });

  it('有効なhttp URLでtrueを返す', () => {
    expect(isValidUrl('http://example.com/path')).toBe(true);
  });

  it('無効なURLでfalseを返す', () => {
    expect(isValidUrl('not-a-url')).toBe(false);
  });

  it('空文字でfalseを返す', () => {
    expect(isValidUrl('')).toBe(false);
  });

  it('ftpプロトコルでfalseを返す', () => {
    expect(isValidUrl('ftp://example.com/file')).toBe(false);
  });

  it('file://プロトコルでfalseを返す', () => {
    expect(isValidUrl('file:///path/to/file')).toBe(false);
  });

  it('mailto:プロトコルでfalseを返す', () => {
    expect(isValidUrl('mailto:user@example.com')).toBe(false);
  });
});
